import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../src/config.mjs';
import { compareCharacterFingerprints, deltaE } from '../game/harness/protocol.mjs';
import { MOTION_RANGES } from '../game/src/format.js';

// Offline analysis of repeated game character pairs: every character against every other, as
// scripts/analyze-taste-difference.mjs does for sites. Qloo off characters from different pairs of the same brief
// measure baseline-to-baseline variance, and an exact permutation test asks how often a random choice of "Qloo on"
// characters separates as well as the real one. It also compares the frozen blind sketches, which both arms make
// before any taste data. It reads pair records and makes no model, Qloo or Codex request.
//
//   node scripts/analyze-character-pairs.mjs <Studio job ID or prefix | game/runs/<pair-id>> [...]
//
// --matrix lists every character of the given pairs, swap pairs included, with its moment and the distances to every
// other character, and runs no test: pairs of different conditions compare cell by cell, not as two groups.
const config = getConfig();
const matrixMode = process.argv.includes('--matrix');
const sources = process.argv.slice(2).filter(item => !item.startsWith('--'));
if (sources.length < (matrixMode ? 1 : 2)) {
  console.log('Usage: node scripts/analyze-character-pairs.mjs [--matrix] <job id or prefix | game/runs/<pair-id>> [...]. Needs two or more completed pairs of one brief, or one or more with --matrix; makes no request.');
  process.exit(1);
}

async function readPair(source) {
  const local = path.resolve(config.rootDir, source);
  const folder = await fs.stat(path.join(local, 'pair.json')).then(() => local, async () => {
    const matches = (await fs.readdir(config.dataDir)).filter(name => name.startsWith(source));
    if (matches.length !== 1) throw new Error(`${source} matches ${matches.length} Studio jobs and is not a pair folder.`);
    const meta = JSON.parse(await fs.readFile(path.join(config.dataDir, matches[0], 'meta.json'), 'utf8'));
    if (meta.kind !== 'character') throw new Error(`Job ${meta.id} is not a character pair.`);
    return path.join(config.dataDir, meta.id, meta.pairId);
  });
  const pair = JSON.parse(await fs.readFile(path.join(folder, 'pair.json'), 'utf8'));
  if (pair.status !== 'completed' || !pair.comparison?.fingerprints) throw new Error(`${source} holds no completed pair with fingerprints.`);
  // A swap pair compares two measured profiles, not Qloo off with Qloo on, so it does not belong in this test.
  if (pair.protocol?.swap && !matrixMode) throw new Error(`${source} is a swap pair (Qloo on against the profile of ${pair.protocol.swap.from}); compare it with --matrix or on its own page.`);
  // Pairs queued in one second before October 5, 2026 share a pair ID, so the source names the record.
  return { ...pair, source };
}

const pairs = [];
for (const source of sources) pairs.push(await readPair(source));
const briefs = new Set(pairs.map(pair => pair.brief.brief));
// The protocol a pair ran under: before shared qualities, with them, or with the moment's art direction too, and
// whether the departure rule was on. Distances of different protocols measure different surfaces.
const protocolOf = pair => [pair.protocol?.artDirection ? 'art direction' : (pair.protocol?.domains || []).includes('qualities') ? 'qualities' : 'earlier',
  pair.protocol?.departure === false ? 'no departure rule' : null].filter(Boolean).join(', ');
const protocols = new Set(pairs.map(protocolOf));

// The comparison's baseline is a pair's first arm and its qloo side the second: Qloo off and on, or Qloo on and the
// swapped profile.
const characters = pairs.flatMap((pair, index) => ['baseline', 'qloo'].map((group, side) => {
  const arm = pair.arms[side];
  const short = { 'qloo-off': 'off', 'qloo-on': 'on', 'qloo-swap': 'swap' }[arm?.key] || group;
  return { id: matrixMode ? `${index + 1}.${short}` : `${group === 'qloo' ? 'Q' : 'P'}${index + 1}`, group, label: arm?.label || group, source: pair.source, pairId: pair.pairId,
    fingerprint: pair.comparison.fingerprints[group], world: pair.comparison.world?.[group] || null, music: arm?.music || null,
    sketch: arm?.sketch || null, sketchMoved: arm?.divergence?.score ?? null, momentMoved: arm?.divergence?.world?.score ?? null, thesis: arm?.dna?.thesis || '' };
}));

// The frozen sketches name a palette, a figure height and head share, planned element IDs, a gait and a light colour.
const sketchPalette = (a, b) => {
  const directed = (from, to) => from.reduce((sum, hex) => sum + Math.min(...to.map(other => deltaE(hex, other))), 0) / from.length;
  return Math.min(1, (directed(a, b) + directed(b, a)) / 2 / 50);
};
function sketchDistance(a, b) {
  const palette = sketchPalette(a.palette, b.palette);
  const proportions = (Math.min(1, Math.abs(a.height - b.height) / ((a.height + b.height) / 2) / 0.4) + Math.min(1, Math.abs(a.headShare - b.headShare) / 0.2)) / 2;
  const union = new Set([...a.elements, ...b.elements]);
  const elements = union.size ? 1 - a.elements.filter(id => b.elements.includes(id)).length / union.size : 0;
  const gait = (['cadence', 'bounciness', 'lean', 'armSwing'].reduce((sum, key) => sum + Math.abs(a.gait[key] - b.gait[key]) / (MOTION_RANGES.walk[key][1] - MOTION_RANGES.walk[key][0]), 0)
    + (a.gait.turnStyle === b.gait.turnStyle ? 0 : 1)) / 5;
  const light = Math.min(1, deltaE(a.light, b.light) / 50);
  const round = value => Number(value.toFixed(3));
  // The sketched moment, when both runs sketched one: scene colours 40%, weather 15%, beacons 15%, render style 20%, track 10%.
  const moment = a.scene && b.scene ? round(0.4 * sketchPalette([...a.scene.sky, ...a.scene.palette], [...b.scene.sky, ...b.scene.palette]) + 0.15 * Number(a.scene.weather !== b.scene.weather)
    + 0.15 * Number(a.scene.towers !== b.scene.towers) + 0.2 * Number(a.render !== b.render) + 0.1 * Number((a.music || null) !== (b.music || null))) : null;
  return { overall: round(0.3 * palette + 0.15 * proportions + 0.15 * elements + 0.3 * gait + 0.1 * light), palette: round(palette), proportions: round(proportions),
    elements: round(elements), gait: round(gait), light: round(light), ...(moment !== null ? { moment } : {}) };
}

const mean = values => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : null;
const indexPairs = [];
for (let i = 0; i < characters.length; i++) for (let j = i + 1; j < characters.length; j++) indexPairs.push([i, j]);
function groupMeans(isQloo, matrix, key) {
  const between = [], qloo = [], baseline = [];
  for (const [i, j] of indexPairs) {
    const value = matrix[i][j]?.[key];
    if (value === undefined || value === null) continue;
    (isQloo[i] !== isQloo[j] ? between : isQloo[i] ? qloo : baseline).push(value);
  }
  return { between: mean(between), withinQloo: mean(qloo), withinBaseline: mean(baseline), separation: Number((mean(between) - mean([...qloo, ...baseline])).toFixed(3)) };
}
// Every way to call k of the n characters "Qloo on"; the p-value is the share that separate at least as well.
function* choose(n, k, start = 0, picked = []) {
  if (picked.length === k) { yield picked; return; }
  for (let i = start; i <= n - (k - picked.length); i++) yield* choose(n, k, i + 1, [...picked, i]);
}
// The smallest reachable p is the share of labelings tied with the best one; with equal groups a labeling and its
// complement always tie, so it is at least two in the total.
function permutation(matrix, key) {
  const actual = characters.map(item => item.group === 'qloo');
  const observed = groupMeans(actual, matrix, key).separation;
  const separations = [];
  for (const picked of choose(characters.length, actual.filter(Boolean).length)) separations.push(groupMeans(characters.map((_, index) => picked.includes(index)), matrix, key).separation);
  const best = Math.max(...separations), share = test => Number((separations.filter(test).length / separations.length).toFixed(4));
  return { observed, p: share(value => value >= observed - 1e-9), labelings: separations.length, minimumP: share(value => value >= best - 1e-9) };
}

const matrix = characters.map(a => characters.map(b => compareCharacterFingerprints(a.fingerprint, b.fingerprint)));
// With art direction the overall distance adds the moment; the character's own part and the moment are kept apart too.
const moments = matrix.every(row => row.every(cell => cell.world !== undefined));

if (matrixMode) {
  const round = value => (value === undefined || value === null ? null : Number(value.toFixed(3)));
  const cells = key => Object.fromEntries(characters.map((a, i) => [a.id, Object.fromEntries(characters.map((b, j) => [b.id, round(matrix[i][j][key])]))]));
  const report = {
    createdAt: new Date().toISOString(), mode: 'matrix',
    method: 'Saved pair records only; no model, Qloo or Codex request. Every character against every other with the harness distance: with art direction, 65% the character and 35% the moment. No test is run, because the pairs ran under different conditions.',
    pairs: pairs.map((pair, index) => ({ id: index + 1, source: pair.source, pairId: pair.pairId, name: pair.brief.name, model: pair.model, protocol: protocolOf(pair), swap: pair.protocol?.swap || null,
      audience: pair.protocol?.audience || null, labels: pair.comparison.labels || null, distance: pair.comparison.distance })),
    characters: characters.map(({ id, label, source, sketchMoved, momentMoved, world, music, fingerprint: f, thesis }) => ({ id, label, source, sketchMoved, momentMoved,
      moment: world ? { render: world.render, weather: world.weather?.kind ?? world.weather ?? null, towers: world.towers ?? null, sky: world.sky ?? null } : null, track: music ? `${music.title} by ${music.artist}` : null,
      figureHeight: f.silhouette.figureHeight, headShare: f.silhouette.headShare, topColors: f.palette.slice(0, 3).map(item => item.hex), light: f.light?.color ?? null,
      walk: { cadence: f.motion.walk.cadence, bounciness: f.motion.walk.bounciness }, kindleLine: f.lines?.kindle ?? null, thesis })),
    overall: cells('overall'), ...(moments ? { character: cells('character'), moment: cells('world') } : {}),
  };
  const file = path.join(config.rootDir, 'output', `character-pairs-matrix-${report.createdAt.replace(/[:.]/gu, '-')}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(report, null, 2));
  for (const item of report.characters) {
    console.log(`${item.id.padEnd(7)} ${item.label.padEnd(16)} ${item.moment ? `${item.moment.render}, ${item.moment.weather}, ${item.moment.towers}` : 'no moment'}; ${item.track || 'no track'}; height ${item.figureHeight}, head ${item.headShare}, light ${item.light}, colours ${item.topColors.join(' ')}; moved ${item.sketchMoved} (moment ${item.momentMoved})`);
  }
  const ids = characters.map(item => item.id);
  for (const key of ['overall', ...(moments ? ['character', 'moment'] : [])]) {
    console.log(`\n${key}\n${''.padEnd(8)}${ids.map(id => id.padStart(8)).join('')}`);
    for (const a of ids) console.log(`${a.padEnd(8)}${ids.map(b => (a === b ? '' : String(report[key][a][b])).padStart(8)).join('')}`);
  }
  console.log(file);
  process.exit(0);
}
const dimensions = ['overall', ...(moments ? ['character', 'world'] : []), 'palette', 'silhouette', 'motion', 'signature', 'voice', 'light'];
const sketches = characters.every(item => item.sketch) ? characters.map(a => characters.map(b => sketchDistance(a.sketch, b.sketch))) : null;
const sketchKeys = ['overall', 'palette', 'proportions', 'elements', 'gait', 'light', ...(characters.every(item => item.sketch?.scene) ? ['moment'] : [])];
const report = {
  createdAt: new Date().toISOString(),
  method: 'Saved pair records only; no model, Qloo or Codex request. Character distance is the harness heuristic (palette CIE76, outline and proportions, gait, idle and turn parameters, signature clip, line words, light). Sketch distance compares the frozen blind sketches: palette 30%, figure 15%, planned element IDs 15%, gait 30%, light 10%. The permutation test labels every choice of as many characters as there are Qloo on runs as "Qloo on" and counts the labelings that separate at least as well; a labeling and its complement count separately.',
  sameBrief: briefs.size === 1, protocols: [...protocols],
  pairs: pairs.map((pair, index) => ({ id: index + 1, source: pair.source, pairId: pair.pairId, model: pair.model, protocol: protocolOf(pair), distance: pair.comparison.distance.overall,
    sketchMoved: { baseline: characters[index * 2].sketchMoved, qloo: characters[index * 2 + 1].sketchMoved } })),
  // A few raw values per character, so a reader can see what the distances summarise.
  characters: characters.map(({ id, group, source, pairId, sketchMoved, thesis, fingerprint: f }) => ({ id, group, source, pairId, sketchMoved, thesis,
    figureHeight: f.silhouette.figureHeight, headShare: f.silhouette.headShare, topColors: f.palette.slice(0, 3).map(item => item.hex), light: f.light?.color ?? null,
    walk: { speed: f.motion.walk.speed, cadence: f.motion.walk.cadence, bounciness: f.motion.walk.bounciness, lean: f.motion.walk.lean, armSwing: f.motion.walk.armSwing },
    signatureSeconds: f.signature?.duration ?? null, kindleLine: f.lines?.kindle ?? null })),
  characterDistance: Object.fromEntries(dimensions.map(key => [key, { ...groupMeans(characters.map(item => item.group === 'qloo'), matrix, key), test: permutation(matrix, key) }])),
  sketchDistance: sketches ? Object.fromEntries(sketchKeys.map(key => [key, { ...groupMeans(characters.map(item => item.group === 'qloo'), sketches, key), test: permutation(sketches, key) }])) : null,
  matrix: Object.fromEntries(characters.map((a, i) => [a.id, Object.fromEntries(characters.map((b, j) => [b.id, matrix[i][j].overall]))])),
  sketchMatrix: sketches ? Object.fromEntries(characters.map((a, i) => [a.id, Object.fromEntries(characters.map((b, j) => [b.id, sketches[i][j].overall]))])) : null,
};

const file = path.join(config.rootDir, 'output', `character-pairs-analysis-${report.createdAt.replace(/[:.]/gu, '-')}.json`);
await fs.mkdir(path.dirname(file), { recursive: true });
await fs.writeFile(file, JSON.stringify(report, null, 2));
if (!report.sameBrief) console.log('Note: the pairs use different briefs, so Qloo off-to-Qloo off distances also include the brief change.');
if (protocols.size > 1) console.log(`Note: the pairs mix protocols (${[...protocols].join('; ')}), so their distances measure different surfaces.`);
const row = (label, stats) => `${label.padEnd(11)} between ${String(stats.between).padEnd(6)} within on ${String(stats.withinQloo).padEnd(6)} within off ${String(stats.withinBaseline).padEnd(6)} separation ${String(stats.separation).padEnd(7)} p = ${stats.test.p} (minimum ${stats.test.minimumP})`;
console.log(`${characters.length} characters from ${pairs.length} pairs\nFinished characters:`);
for (const [key, stats] of Object.entries(report.characterDistance)) console.log(`  ${row(key, stats)}`);
if (report.sketchDistance) {
  console.log('Blind sketches:');
  for (const [key, stats] of Object.entries(report.sketchDistance)) console.log(`  ${row(key, stats)}`);
}
console.log(`Moved from own sketch: Qloo off ${report.pairs.map(pair => pair.sketchMoved.baseline).join(', ')}; Qloo on ${report.pairs.map(pair => pair.sketchMoved.qloo).join(', ')}`);
for (const item of report.characters) {
  console.log(`  ${item.id.padEnd(3)} height ${item.figureHeight}, head ${item.headShare}, walk speed ${item.walk.speed}, cadence ${item.walk.cadence}, light ${item.light}, colours ${item.topColors.join(' ')}`);
}
console.log(file);
