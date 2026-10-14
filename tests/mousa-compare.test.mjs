import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createMousaServer, inHostTerms } from '../plugin/server/mcp/mousa.mjs';
import { resolveTasteRefs } from '../plugin/server/design/tools.mjs';
import { createConnectionStore, plainProtector } from '../plugin/server/connections/store.mjs';
import { qlooFixture, prediction, parse, exists, designFor, siteFiles, byName, baselineDesign } from './helpers/mousa-fixtures.mjs';

const QLOO = 'compare/with-qloo', OWN = 'compare/without-qloo';
const PLAN = { dryRun: true, medium: 'web', references: [{ name: 'Paterson' }, { name: 'Nujabes' }] };

function server(project, config, fetchImpl) {
  return createMousaServer({ env: { MOUSA_PROJECT_DIR: project, QLOO_API_KEY: 'fixture-key-123', MOUSA_HOST: 'claude-code' }, fetchImpl,
    store: createConnectionStore({ env: { MOUSA_CONFIG_DIR: config }, protector: plainProtector }),
    inspect: { browser: async () => ({ available: false, reason: 'Not in tests.' }), codex: async () => ({ available: false, reason: 'Not in tests.' }) } });
}

test('two workspaces keep two designs apart, one measured with Qloo and one from the same prediction alone', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-compare-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-compare-config-'));
  const { fetchImpl, requests } = qlooFixture();
  const mousa = server(project, config, fetchImpl);
  const call = async (name, args) => parse(await mousa.callTool(name, args));
  try {
    for (const workspace of [QLOO, OWN]) {
      assert.equal((await call('taste_profile', { ...PLAN, workspace })).status, 'planned');
      assert.equal((await call('design_validate', { stage: 'prediction', artifact: prediction(), workspace })).status, 'frozen');
    }
    assert.ok(await exists(path.join(project, 'compare', 'with-qloo', '.mousa', 'taste', 'prediction.json')));
    assert.ok(!(await exists(path.join(project, '.mousa', 'taste', 'prediction.json'))), 'the project folder itself keeps no record of either arm');

    const measured = await call('taste_profile', { workspace: QLOO });
    assert.equal(measured.status, 'ok');
    const sent = requests.length;
    assert.ok(sent > 0);

    const own = await call('taste_profile', { baseline: true, workspace: OWN });
    assert.equal(own.status, 'baseline');
    assert.equal(own.measured.requests, 0);
    assert.equal(requests.length, sent, 'the baseline arm makes no Qloo request');
    assert.deepEqual(own.qualities, ['nostalgic', 'everyday poetry', 'gentle']);
    assert.ok(own.requiredAnchors.some(anchor => anchor.name === 'nostalgic' && anchor.is === 'predicted quality'));
    assert.match(own.rules, /never claim measured affinity/u);
    for (const [name, args] of [['taste_ask', { question: 'shortlist', decision: 'Which artist plays in the shop?', candidates: ['Khruangbin', 'Tom Misch'] }],
      ['qloo_query', { kind: 'search', query: 'Paterson' }], ['taste_profile', {}]]) {
      const refused = await call(name, { ...args, workspace: OWN });
      assert.equal(refused.error.code, 'BASELINE_SESSION', name);
    }
    assert.equal(requests.length, sent, 'nothing reached Qloo from the baseline workspace');
    assert.equal((await call('taste_profile', { baseline: true, workspace: QLOO })).error.code, 'SESSION_MEASURED');

    // The measured arm writes its reading and DNA by the names the brief lists, never by opaque IDs.
    const input = JSON.parse(await readFile(path.join(project, 'compare', 'with-qloo', '.mousa', 'taste', 'input.json'), 'utf8'));
    const { reading, dna } = designFor(input);
    const unknown = await call('design_validate', { stage: 'reading', artifact: { ...byName(reading, input), clusters: [{ ...byName(reading, input).clusters[0], refs: ['Atmospherik', 'Perfect Days'] }, ...byName(reading, input).clusters.slice(1)] }, workspace: QLOO });
    assert.match(unknown.error.message, /Atmospherik is not a name in this session's taste input\. Use a name as the Taste Brief lists it/u);
    const read = await call('design_validate', { stage: 'reading', artifact: byName(reading, input), workspace: QLOO });
    assert.equal(read.status, 'valid', JSON.stringify(read));
    const saved = JSON.parse(await readFile(path.join(project, 'compare', 'with-qloo', '.mousa', 'design', 'reading.json'), 'utf8'));
    assert.deepEqual(saved.reading.clusters[0].refs, reading.clusters[0].refs, 'names are saved as their refs');
    const wrongFont = byName(dna, input);
    wrongFont.devices[1] = { ...wrongFont.devices[1], tokens: { fonts: ['Comic Neue'] } };
    const refusedFont = await call('design_validate', { stage: 'dna', artifact: wrongFont, workspace: QLOO });
    assert.match(refusedFont.error.message, /Comic Neue is not in the Moûsa font library \(materials find\)/u);
    assert.doesNotMatch(refusedFont.error.message, /culture-|project_get_taste/u);
    assert.equal((await call('design_validate', { stage: 'dna', artifact: byName(dna, input), workspace: QLOO })).status, 'valid');

    // The baseline arm follows the same stages from its own prediction.
    const ownInput = JSON.parse(await readFile(path.join(project, 'compare', 'without-qloo', '.mousa', 'taste', 'input.json'), 'utf8'));
    assert.equal(ownInput.source, 'model-assumption');
    const baseline = baselineDesign(ownInput);
    assert.equal((await call('design_validate', { stage: 'reading', artifact: baseline.reading, workspace: OWN })).status, 'valid');
    const ownDna = await call('design_validate', { stage: 'dna', artifact: baseline.dna, workspace: OWN });
    assert.equal(ownDna.status, 'valid', JSON.stringify(ownDna));

    const fonts = ["@font-face{font-family:'Jost';src:url('fonts/jost-400.woff2')}"];
    for (const [name, content] of Object.entries(siteFiles(fonts))) await writeFile(path.join(project, 'compare', 'with-qloo', name), content);
    await writeFile(path.join(project, 'compare', 'without-qloo', 'index.html'), '<!doctype html><html><head><style>:root{--paper:#f3ead8;--rust:#b5653a}body{background:var(--paper);color:var(--rust);font-family:Literata,serif}</style></head><body><main><section id="week-loop"></section></main></body></html>');
    const compared = await call('design_compare', { a: QLOO, b: OWN });
    assert.ok(compared.distance.overall > 0);
    assert.equal(compared.samePrediction, true, 'both arms started from the same frozen prediction');
    assert.equal(compared.arms.a.taste, 'qloo');
    assert.equal(compared.arms.b.taste, 'own prediction');
    assert.match(compared.arms.a.headline, /^\d+ of 6 devices rest on what the prediction did not contain\.$/u);
    assert.equal(compared.arms.b.surpriseAnchoredDevices, undefined);

    const status = await call('mousa_status', { workspace: OWN });
    assert.equal(status.workspace, OWN);
    assert.equal(status.stage, 'specified');
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('a design started from another prediction is reported as such', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-compare-diff-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-compare-diff-config-'));
  const { fetchImpl } = qlooFixture();
  const mousa = server(project, config, fetchImpl);
  const call = async (name, args) => parse(await mousa.callTool(name, args));
  try {
    for (const [workspace, fonts] of [[QLOO, ['Literata', 'Courier Prime']], [OWN, ['Jost']]]) {
      await call('taste_profile', { ...PLAN, workspace });
      await call('design_validate', { stage: 'prediction', artifact: prediction(fonts), workspace });
      await call('taste_profile', { baseline: true, workspace });
      await writeFile(path.join(project, ...workspace.split('/'), 'index.html'), `<style>body{color:${workspace === QLOO ? '#111' : '#eee'}}</style>`);
    }
    const compared = await call('design_compare', { a: QLOO, b: OWN });
    assert.equal(compared.samePrediction, false);
    assert.match(compared.limitation, /did not start from the same frozen prediction/u);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('names resolve to refs, a measured entity first, and a name two entities share asks for the ref', () => {
  const input = { entities: [
    { ref: 'quality:look:atmospheric', name: 'Atmospheric', domain: 'qualities', source: 'qloo' },
    { ref: 'M30', name: 'atmospheric', domain: 'qualities', source: 'model-assumption' },
    { ref: 'F-movie-quiet', name: 'Quiet', domain: 'movie', source: 'qloo' },
    { ref: 'urn:tag:style:qloo:quiet', name: 'Quiet', domain: 'style', source: 'qloo' },
  ] };
  const reading = resolveTasteRefs('reading', { clusters: [{ refs: ['Atmospheric (new)', 'urn:tag:style:qloo:quiet'] }], setAside: [{ ref: 'F-movie-quiet', reason: 'x' }] }, input);
  assert.deepEqual(reading.clusters[0].refs, ['quality:look:atmospheric', 'urn:tag:style:qloo:quiet']);
  assert.equal(reading.setAside[0].ref, 'F-movie-quiet');
  assert.throws(() => resolveTasteRefs('dna', { devices: [{ anchors: ['Quiet'] }] }, input), /dna\.devices\[0\]\.anchors\[0\]: Quiet names 2 entries of the taste input: F-movie-quiet \(movie\), urn:tag:style:qloo:quiet \(style\)\. Give the ref you mean\./u);
  assert.equal(resolveTasteRefs('plan', { steps: [] }, input).steps.length, 0, 'other stages pass through');
});

test('messages from the shared validators name this surface\'s own tools', () => {
  assert.equal(inHostTerms('dna.devices[0].anchors[0]: Use a ref exactly as returned by project_get_taste.'), 'dna.devices[0].anchors[0]: Use a ref as the Taste Brief names it.');
  assert.match(inHostTerms('dna.devices[1].tokens.fonts[0]: Comic Neue is not in culture-fonts.json, so most visitors would see a fallback font.'), /the Moûsa font library \(materials find\)/u);
  assert.equal(inHostTerms('x: Use a photo ID or path listed in culture-library.json, such as library/olive-oil-1.jpg, or a picture generated for this device, such as generated/dna5-1.png.'),
    'x: List only pictures made for this device with the image tool, such as generated/dna5-1.png.');
  assert.match(inHostTerms('x: This run has no host photo library, so a device cannot list photos. Use original SVG or CSS imagery instead.'), /list only pictures made with the image tool/u);
  assert.equal(inHostTerms('device: use the ID of an imagery device in your saved culture-dna.json (dna4).'), 'device: use the ID of an imagery device in your saved Design DNA (dna4).');
});
