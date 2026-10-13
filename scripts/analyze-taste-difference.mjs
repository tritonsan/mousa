import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDotEnv, getConfig, redact } from '../src/config.mjs';
import { designFingerprint, compareDesignFingerprints, sketchFingerprint } from '../plugin/server/culture/taste.mjs';

// Offline analysis of a verify-taste-difference report: every generated design against every other.
// It reads saved sites and job records from the running local Studio and makes no model or Qloo request.
// Pairwise summaries reuse each baseline only once; the full matrix uses all of them, and an exact
// permutation test asks how often a random choice of "Qloo" designs separates as well as the real one.
loadDotEnv();
const config = getConfig();
const origin = process.env.STUDIO_URL || `http://127.0.0.1:${config.port}`;
const option = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const outputDir = path.join(config.rootDir, 'output');
const reportPath = option('report') || path.join(outputDir, (await fs.readdir(outputDir)).filter(name => /^taste-difference-\d{4}-.*\.json$/u.test(name)).sort().at(-1) || '');
const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));

async function api(pathname) {
  const response = await fetch(origin + pathname, { headers: config.accessToken ? { 'X-Demo-Token': config.accessToken } : {} });
  const result = await response.json();
  if (!response.ok) throw new Error(`Studio ${response.status}: ${result.error || 'request failed'}`);
  return result;
}
const designs = [];
for (const [index, item] of report.comparisons.entries()) {
  designs.push({ id: `Q${index + 1}`, group: 'qloo', jobId: item.jobId, mode: 'qloo' });
  designs.push({ id: `P${index + 1}`, group: 'baseline', jobId: item.jobId, mode: 'baseline' });
}
for (const [index, item] of report.baselines.entries()) item.jobIds.forEach((jobId, arm) => designs.push({ id: `V${index + 1}${'ab'[arm]}`, group: 'baseline', jobId, mode: 'baseline' }));
// Concept words come from the binding DNA's thesis and device names (what was specified and conformance-checked),
// not from translations, which name the anchor entities and would differ by construction.
const STOPWORDS = new Set('the and for with that this from into over under each every one two its their your our like reads gather site page small quiet'.split(' '));
const conceptWords = dna => new Set([dna?.thesis, ...(dna?.devices || []).map(device => device.device)].join(' ').toLowerCase()
  .split(/[^a-z]+/u).map(word => word.replace(/s$/u, '')).filter(word => word.length > 2 && !STOPWORDS.has(word)));
for (const design of designs) {
  const site = (await api(`/api/jobs/${design.jobId}/runs/${design.mode}/download`)).files;
  design.fingerprint = designFingerprint(site);
  design.concepts = conceptWords(JSON.parse(site['culture-dna.json'] || '{}'));
  // The frozen sketch and its divergence are host records; reports from before the sketch protocol have neither.
  const taste = (await api(`/api/jobs/${design.jobId}`)).runs?.find(run => run.mode === design.mode)?.taste;
  design.sketch = taste?.assumption?.designSketch || null;
  design.sketchDivergence = taste?.sketchDivergence || null;
}
const conceptDistance = (a, b) => {
  const shared = [...a].filter(word => b.has(word)).length, union = new Set([...a, ...b]).size;
  return union ? Number((1 - shared / union).toFixed(3)) : 0;
};

const dimensions = ['overall', 'palette', 'typography', 'structure', 'features', 'concept'];
const distance = designs.map(a => designs.map(b => ({ ...compareDesignFingerprints(a.fingerprint, b.fingerprint), concept: conceptDistance(a.concepts, b.concepts) })));
const mean = values => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : null;
const pairs = [];
for (let i = 0; i < designs.length; i++) for (let j = i + 1; j < designs.length; j++) pairs.push([i, j]);
const groupMeans = (isQloo, key = 'overall', matrix = distance) => {
  const between = [], qloo = [], baseline = [];
  for (const [i, j] of pairs) (isQloo[i] !== isQloo[j] ? between : isQloo[i] ? qloo : baseline).push(matrix[i][j][key]);
  return { between: mean(between), withinQloo: mean(qloo), withinBaseline: mean(baseline), separation: Number((mean(between) - mean([...qloo, ...baseline])).toFixed(3)), counts: { between: between.length, withinQloo: qloo.length, withinBaseline: baseline.length } };
};
const actual = designs.map(design => design.group === 'qloo');
const byDimension = Object.fromEntries(dimensions.map(key => [key, groupMeans(actual, key)]));

// Exact permutation test over every way to label the same number of designs as Qloo.
const qlooCount = actual.filter(Boolean).length;
const labelings = [];
const choose = (start, chosen) => {
  if (chosen.length === qlooCount) { labelings.push(designs.map((_, index) => chosen.includes(index))); return; }
  for (let index = start; index < designs.length; index++) choose(index + 1, [...chosen, index]);
};
choose(0, []);
const exact = statistic => {
  const observed = statistic(actual);
  const atLeast = labelings.filter(labels => statistic(labels) >= observed - 1e-9).length;
  return { observed, labelings: labelings.length, atLeastAsSeparated: atLeast, p: Number((atLeast / labelings.length).toFixed(3)) };
};
const permutation = Object.fromEntries(dimensions.map(key => [key, exact(labels => groupMeans(labels, key).separation)]));
const nearest = designs.map((design, i) => Object.fromEntries([['id', design.id], ...['overall', 'concept'].map(key => {
  const [j] = designs.map((_, index) => index).filter(index => index !== i).sort((a, b) => distance[i][a][key] - distance[i][b][key]);
  return [key, { nearest: designs[j].id, distance: distance[i][j][key], sameGroup: designs[j].group === design.group }];
})]));

// Each run's own counterfactual: how far its saved site moved from the design it froze before any taste data,
// and whether the two arms' blind sketches already differed. Only computed when every design has both records.
let sketches = null;
if (designs.every(design => design.sketch && Number.isFinite(design.sketchDivergence?.score))) {
  const moved = key => {
    const values = designs.map(design => design.sketchDivergence[key]);
    const gap = labels => mean(values.filter((_, index) => labels[index])) - mean(values.filter((_, index) => !labels[index]));
    return { qloo: mean(values.filter((_, index) => actual[index])), baseline: mean(values.filter((_, index) => !actual[index])), test: exact(labels => Number(gap(labels).toFixed(3))) };
  };
  const blind = designs.map(a => designs.map(b => compareDesignFingerprints(sketchFingerprint(a.sketch), sketchFingerprint(b.sketch))));
  sketches = {
    moved: Object.fromEntries(['score', 'typography', 'palette', 'structure'].map(key => [key, moved(key)])),
    blindSketchDistance: Object.fromEntries(['palette', 'typography', 'structure'].map(key => [key, { ...groupMeans(actual, key, blind), test: exact(labels => groupMeans(labels, key, blind).separation) }])),
    perDesign: designs.map(({ id, group, sketch, sketchDivergence: d }) => ({ id, group, sketch: { fonts: sketch.fonts, palette: sketch.palette, sections: sketch.sections, motifs: sketch.motifs },
      moved: { score: d.score, typography: d.typography, palette: d.palette, structure: d.structure }, newFonts: d.fonts?.new || [], keptFonts: d.fonts?.kept || [], newSections: d.sections?.new || [] })),
    interpretation: 'moved is the share of the saved site’s font families, top colors and landmark sections that are new against the run’s own frozen sketch; test.p is the exact permutation p for the Qloo-minus-baseline mean. The protocol requires surprise-anchored DNA devices to depart from the sketch, so a Qloo-side lead is expected by design: the test checks that the required departure reached the saved site and that baseline runs did not move on their own. blindSketchDistance compares the sketches themselves, frozen before any taste data in both arms; a separation near zero means the arms started from comparable designs, so later site differences follow the taste input rather than the starting sketch.',
  };
}

// Library photos each site shows. Both arms read the same library, so a separation means they chose different photos.
let photos = null;
if (designs.some(design => design.fingerprint.images?.length)) {
  const photoDistance = (a, b) => { const x = new Set(a), y = new Set(b), union = new Set([...x, ...y]); return union.size ? Number((1 - [...x].filter(item => y.has(item)).length / union.size).toFixed(3)) : 0; };
  const matrix = designs.map(a => designs.map(b => ({ photos: photoDistance(a.fingerprint.images || [], b.fingerprint.images || []) })));
  photos = { ...groupMeans(actual, 'photos', matrix), test: exact(labels => groupMeans(labels, 'photos', matrix).separation),
    perDesign: designs.map(({ id, group, fingerprint }) => ({ id, group, images: fingerprint.images || [] })),
    interpretation: 'Photo-set distance is one minus the Jaccard overlap of the library photos two sites reference; two sites without photos have distance 0. test.p is the exact permutation p of the separation. It shows whether the arms chose different photos from the same library, not whether the choice is better.' };
}

const analysis = {
  schemaVersion: '1.2', report: path.relative(config.rootDir, reportPath), analyzedAt: new Date().toISOString(), origin,
  designs: designs.map(({ id, group, jobId, mode }) => ({ id, group, jobId, mode })),
  overall: byDimension.overall, byDimension, permutation, nearest, sketches, photos,
  matrix: designs.map((design, i) => ({ id: design.id, distances: Object.fromEntries(designs.map((other, j) => [other.id, distance[i][j].overall])) })),
  concepts: Object.fromEntries(designs.map(design => [design.id, [...design.concepts].sort()])),
  interpretation: 'Separation is the mean Qloo-to-baseline distance minus the mean within-group distance. p is the share of all equally sized labelings that separate at least as well; with few designs the smallest possible p is 1 / labelings. Palette, typography, structure and features are bounded token heuristics over the saved site files. Concept is word overlap in the binding DNA thesis and device names, so it describes the specification the agent wrote and the host checked, not the rendered page. None is a perceptual or quality measure.',
};
const outPath = path.join(outputDir, `taste-difference-analysis-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`);
await fs.writeFile(outPath, redact(JSON.stringify(analysis, null, 2), config));
console.log(JSON.stringify({ outPath, overall: analysis.overall, permutation: Object.fromEntries(Object.entries(permutation).map(([key, value]) => [key, value.p])),
  concept: byDimension.concept, nearest: Object.fromEntries(['overall', 'concept'].map(key => [key, nearest.map(item => `${item.id}->${item[key].nearest}`).join(' ')])),
  sketches: sketches && { moved: Object.fromEntries(Object.entries(sketches.moved).map(([key, value]) => [key, { qloo: value.qloo, baseline: value.baseline, p: value.test.p }])),
    blindSketchDistance: Object.fromEntries(Object.entries(sketches.blindSketchDistance).map(([key, value]) => [key, { between: value.between, separation: value.separation, p: value.test.p }])) },
  photos: photos && { between: photos.between, separation: photos.separation, p: photos.test.p } }, null, 2));
