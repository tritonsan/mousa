// Painted skins: the layers a drawing is cut into, the blueprint sheet, the cut of a painted sheet back onto the bones,
// the skin's format, the painter's brief, the paint tool's order and the dry run's publication. No Codex request is made.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCharacter } from '../src/format.js';
import { exactBounds } from '../harness/raster.mjs';
import { encodePng, keyOut } from '../harness/cutout.mjs';
import { decodePng } from '../../src/image-colors.mjs';
import { paintLayers, skinPieces, blueprintSheet, cutSheet, skinFromCut, paintBrief, pieceLabel, paintCharacter, TECHNIQUES, SHEET } from '../harness/skin.mjs';
import { createArmSession } from '../harness/session.mjs';
import { connect } from '../harness/mcp-client.mjs';
import { GAME_DOMAINS, fixtureProfile, fixtureAssumption, fixtureDna, fixturePainter } from '../harness/fixtures.mjs';
import { prepareArm, loadWorld, runPair, ARMS } from '../harness/run-pair.mjs';
import { makeCharacterPrompt } from '../harness/prompt.mjs';
import { measureCharacter } from '../harness/measure.mjs';
import { normalizeCharacterAssumption, deltaE } from '../harness/protocol.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fss.readFileSync(path.join(root, file), 'utf8'));
const canon = read('world/canon.json');
const [ashRaw, emberRaw, mannequinRaw] = ['samples/sample-a.json', 'samples/sample-b.json', 'harness/mannequin.json'].map(read);
const [ash, ember, mannequin] = [ashRaw, emberRaw, mannequinRaw].map(raw => normalizeCharacter(raw, {}));
const brief = { name: 'Test', brief: 'A test brief long enough to pass the brief loader in this suite.', references: [{ name: 'Fixture reference one', role: 'audience' }], knownNames: [] };

/** The sheet as RGBA, to paint test variations of it. */
function pixels(bytes) {
  const image = decodePng(bytes), rgba = Buffer.alloc(image.width * image.height * 4);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) rgba.set(image.pixel(x, y), (y * image.width + x) * 4);
  return { width: image.width, height: image.height, rgba };
}
const fill = (sheet, x, y, w, h, color) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) sheet.rgba.set(color, (j * sheet.width + i) * 4); };

test('a drawing becomes one layer a bone and place in the order, split only where another part covers it', () => {
  const layers = paintLayers(mannequin);
  assert.deepEqual(layers.map(layer => `${layer.bone}:${layer.parts.map(part => part.id).join('+')}`),
    ['thigh:thigh', 'shin:shin', 'foot:shoe', 'torso:neck+torso+torso-shade', 'pelvis:belt', 'upperArm:upper-arm', 'forearm:forearm', 'hand:hand', 'head:head+cap+eye+nose']);
  // A collar drawn over the head's neck cannot join the coat beneath the head; its rim, a line without a fill, joins the collar.
  const head = exactBounds(mannequin.parts.find(part => part.id === 'head').d);
  const y = head.maxY - 6, x = head.minX - 2;
  const collared = normalizeCharacter({ ...mannequinRaw, parts: [...mannequinRaw.parts,
    { id: 'collar', bone: 'torso', z: 13, shape: 'path', d: `M${x} ${y} L${x + 16} ${y} L${x + 16} ${y + 12} L${x} ${y + 12} Z`, fill: '#5d626c' },
    { id: 'collar-rim', bone: 'torso', z: 14, shape: 'path', d: `M${x} ${y} L${x + 16} ${y}`, fill: 'none', stroke: '#24262b', strokeWidth: 1 }] }, {});
  const split = paintLayers(collared).filter(layer => layer.bone === 'torso');
  assert.deepEqual(split.map(layer => layer.parts.map(part => part.id)), [['neck', 'torso', 'torso-shade'], ['collar', 'collar-rim']]);
  // Long cloth chains become strips and tips their own pieces; a lantern's thin cord stays a vector.
  assert.deepEqual(skinPieces(ash).filter(piece => piece.kind !== 'layer').map(piece => piece.id), ['strip-cloak-tail', 'strip-scarf', 'tip-lantern-rope']);
  assert.ok(!skinPieces(ash).some(piece => piece.id === 'strip-lantern-rope'));
});

test('the blueprint sheet keeps every piece apart, inside its margins and clear of the standing figure', () => {
  const { png, layout } = blueprintSheet(ember, { figure: true });
  const sheet = decodePng(png);
  assert.deepEqual([sheet.width, sheet.height], [SHEET.width, SHEET.height]);
  assert.equal(layout.pieces.length, skinPieces(ember).length);
  const boxes = [...layout.pieces, layout.figure];
  for (const box of boxes) {
    assert.ok(box.x >= SHEET.margin && box.y >= SHEET.margin && box.x + box.w <= SHEET.width - SHEET.margin && box.y + box.h <= SHEET.height - SHEET.margin, JSON.stringify(box));
  }
  for (const [index, a] of boxes.entries()) for (const b of boxes.slice(index + 1)) {
    const apart = a.x + a.w + SHEET.gap <= b.x || b.x + b.w + SHEET.gap <= a.x || a.y + a.h + SHEET.gap <= b.y || b.y + b.h + SHEET.gap <= a.y;
    assert.ok(apart, `${a.id || 'figure'} and ${b.id || 'figure'} keep a gap`);
  }
  // Reading order for the brief: rows from the top, then left to right.
  for (let i = 1; i < layout.pieces.length; i++) {
    const [a, b] = [layout.pieces[i - 1], layout.pieces[i]];
    assert.ok(a.row < b.row || (a.row === b.row && a.x < b.x));
  }
  // The background is the flat key colour and the pieces are drawn in their own colours.
  assert.deepEqual(sheet.pixel(2, 2), [255, 0, 255, 255]);
  const head = layout.pieces.find(piece => piece.bone === 'head');
  const centre = sheet.pixel(Math.round(head.content.x + head.content.w / 2), Math.round(head.content.y + head.content.h / 2));
  assert.notDeepEqual(centre.slice(0, 3), [255, 0, 255]);
});

test('a sheet painted in place cuts back onto the bind-pose boxes its blueprint came from', () => {
  const { png, layout } = blueprintSheet(ember, { figure: true });
  const cut = cutSheet(png, layout);
  assert.equal(cut.key, '#ff00ff');
  assert.ok(cut.figure && cut.figure.height > cut.figure.width);
  for (const piece of cut.pieces) {
    const plan = layout.pieces.find(item => item.id === piece.id);
    // The cut keeps a soft edge and a clear pixel around each piece, so a small piece overlaps its box a little less.
    assert.ok(!piece.missing && !piece.moved && piece.registration > 0.8, `${piece.id} ${piece.registration}`);
    // The painted box maps back to the drawn shape's own box within a pixel or two of the sheet's scale.
    const tolerance = 3 / layout.scale;
    const content = [plan.bounds.minX + (plan.content.x - plan.x) / layout.scale, plan.bounds.minY + (plan.content.y - plan.y) / layout.scale];
    assert.ok(Math.abs(piece.rect[0] - content[0]) <= tolerance && Math.abs(piece.rect[1] - content[1]) <= tolerance, `${piece.id} ${piece.rect} ${content}`);
  }
  const skin = skinFromCut(layout, cut, id => `runs/test-pair/qloo-on-skin-${id}.png`);
  assert.equal(skin.images.length, paintLayers(ember).length);
  assert.deepEqual(skin.tips.map(tip => tip.chain), ['belt-lantern']);
  const skinned = normalizeCharacter({ ...emberRaw, skin }, {});
  assert.equal(skinned.skin.images[0].src, 'runs/test-pair/qloo-on-skin-layer-1.png');
});

test('the cut keeps what the painter grew, moves back only what drifted, and keeps a transparent sheet\'s alpha', () => {
  const { png, layout } = blueprintSheet(ember, { figure: true });
  const sheet = pixels(png);
  const hand = layout.pieces.find(piece => piece.bone === 'hand'), belt = layout.pieces.find(piece => piece.bone === 'pelvis');
  // The belt's knotted ends hang far below its box, beyond half a gap; they still belong to the belt.
  fill(sheet, belt.content.x + 4, belt.content.y + belt.content.h - 2, 12, Math.round(SHEET.gap * 0.9), [58, 29, 28, 255]);
  // The hand drifted half its width to the right of its place.
  const shift = Math.round(hand.content.w * 0.6), copy = Buffer.from(sheet.rgba);
  fill(sheet, hand.x, hand.y, hand.w, hand.h, [255, 0, 255, 255]);
  for (let y = hand.y; y < hand.y + hand.h; y++) for (let x = hand.x; x < hand.x + hand.w; x++) sheet.rgba.set(copy.subarray((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4), (y * sheet.width + x + shift) * 4);
  const cut = cutSheet(encodePng(sheet.width, sheet.height, sheet.rgba), layout);
  const [beltCut, handCut] = [belt, hand].map(plan => cut.pieces.find(piece => piece.id === plan.id));
  assert.ok(beltCut.height >= belt.content.h + SHEET.gap * 0.85, `the belt keeps its long ends: ${beltCut.height}`);
  assert.equal(beltCut.moved, false);
  assert.equal(handCut.moved, true);
  const reference = cutSheet(png, layout).pieces.find(piece => piece.id === hand.id);
  assert.ok(Math.abs(handCut.rect[0] - reference.rect[0]) < 2 / layout.scale, 'the drifted hand returns to its joint');
  // A painter that returns a transparent background keeps its own alpha: no colour is keyed out.
  const clear = { width: 24, height: 24, rgba: Buffer.alloc(24 * 24 * 4) };
  fill(clear, 6, 6, 10, 10, [20, 20, 20, 255]);
  const keyed = keyOut(encodePng(24, 24, clear.rgba));
  assert.equal(keyed.key, 'transparent');
  assert.equal(keyed.rgba[(10 * 24 + 10) * 4 + 3], 255);
  assert.equal(keyed.rgba[3], 0);
});

test('pixels next to a magenta key lose its cast, and pixels inside keep their colour', () => {
  const sheet = { width: 30, height: 30, rgba: Buffer.alloc(30 * 30 * 4) };
  fill(sheet, 0, 0, 30, 30, [255, 0, 255, 255]);
  fill(sheet, 5, 5, 20, 20, [120, 30, 120, 255]);
  const keyed = keyOut(encodePng(30, 30, sheet.rgba));
  const at = (x, y) => [...keyed.rgba.subarray((y * 30 + x) * 4, (y * 30 + x) * 4 + 4)];
  assert.deepEqual(at(5, 15), [30, 30, 30, 255], 'the edge is despilled');
  assert.deepEqual(at(15, 15), [120, 30, 120, 255], 'the inside keeps its own purple');
  assert.equal(at(2, 2)[3], 0);
});

test('the skin format names this pair\'s pictures and the chains they paint, and nothing else', () => {
  const tip = chain => ({ chain, src: 'runs/test-pair/qloo-on-skin-tip.png', rect: [-4, 0, 8, 10] });
  const base = { images: [{ bone: 'torso', src: 'runs/test-pair/qloo-on-skin-layer-1.png', rect: [-10, -120, 20, 40] }] };
  const rejects = (skin, pattern) => assert.throws(() => normalizeCharacter({ ...emberRaw, skin }, {}), pattern);
  rejects({ ...base, images: [{ ...base.images[0], src: 'https://example.com/a.png' }] }, /skin\.images\[0\]\.src/u);
  rejects({ ...base, images: [{ ...base.images[0], src: 'runs/test-pair/../x.png' }] }, /skin\.images\[0\]\.src/u);
  rejects({ ...base, images: [{ ...base.images[0], side: 'front' }] }, /skin\.images\[0\]\.side/u);
  rejects({ ...base, tips: [tip('no-such-chain')] }, /no cloth chain/u);
  rejects({ ...base, tips: [tip('belt-lantern'), tip('belt-lantern')] }, /has a picture already/u);
  rejects({ ...base, cloth: [{ chain: 'belt-lantern', src: 'runs/test-pair/a.png' }] }, /skin\.cloth\[0\]\.rect/u);
  const ok = normalizeCharacter({ ...emberRaw, skin: { ...base, tips: [tip('belt-lantern')] } }, {});
  assert.deepEqual(ok.skin.tips[0].rect, [-4, 0, 8, 10]);
  assert.equal(ok.skin.images[0].side, 'center');
  const ashSkin = normalizeCharacter({ ...ashRaw, skin: { ...base, tips: [] } }, {});
  assert.deepEqual(ashSkin.skin.cloth, []);
  assert.throws(() => normalizeCharacter({ ...ashRaw, skin: { ...base, tips: [tip('scarf')] } }, {}), /has no tip to paint/u);
});

test('the painter\'s brief carries the technique, the figure, every piece in reading order and the cutting rules', () => {
  const pieces = skinPieces(ember);
  const { layout } = blueprintSheet(ember, { pieces, figure: true });
  const labels = Object.fromEntries(pieces.map(piece => [piece.id, pieceLabel(piece)]));
  const brief = paintBrief({ layout, style: `${TECHNIQUES.ink}. Quilted mustard nylon with scuffed brass.`, labels, refine: true });
  assert.match(brief, /edit the attached picture, blueprint\.png/u);
  assert.match(brief, /On the left the whole character stands/u);
  assert.match(brief, /ink and wash on warm paper/u);
  assert.match(brief, /Design the character properly/u);
  assert.match(brief, /flat pure magenta \(#FF00FF\)/u);
  let last = -1;
  for (const [index, piece] of layout.pieces.entries()) {
    const at = brief.indexOf(`${index + 1}. ${labels[piece.id]}`);
    assert.ok(at > last, `${piece.id} in order`);
    last = at;
  }
  assert.match(labels['layer-10'], /^the head piece \(hair back, head, ear/u);
  assert.match(labels['tip-belt-lantern'], /^the belt lantern hanging at the end of its cord/u);
  const exact = paintBrief({ layout: { ...layout, figure: undefined }, style: 'A test style sentence for the brief.', labels, refine: false });
  assert.match(exact, /must keep its exact place, size and outline/u);
  assert.doesNotMatch(exact, /standing figure/u);
});

test('painting refuses a skin with a hole and writes every piece when all of them come back', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-paint-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = id => `runs/test-pair/qloo-on-skin-${id}.png`;
  const painted = await paintCharacter({ character: ember, style: 'A test style sentence for the painter.', generate: options => fixturePainter().generate(options), dir: path.join(dir, 'ok'), source });
  assert.equal(painted.ok, true);
  assert.equal(painted.report.technique, 'ink');
  assert.match(painted.report.prompt, /A test style sentence for the painter\./u);
  for (const { file } of painted.files) assert.ok(fss.existsSync(path.join(dir, 'ok', file)), file);
  assert.ok(fss.existsSync(path.join(dir, 'ok', 'figure.png')));
  assert.equal(painted.skin.images.length + (painted.skin.tips?.length || 0) + (painted.skin.cloth?.length || 0), painted.files.length);
  // A painter that leaves out the head leaves a hole in the figure, so nothing is skinned.
  const lossy = { async generate(options) {
    const result = await fixturePainter().generate(options);
    const file = path.join(options.directory, `${options.name}.png`), sheet = pixels(await fs.readFile(file));
    const layout = JSON.parse(await fs.readFile(path.join(options.directory, 'layout.json'), 'utf8'));
    const head = layout.pieces.find(piece => piece.bone === 'head');
    fill(sheet, head.x, head.y, head.w, head.h, [255, 0, 255, 255]);
    await fs.writeFile(file, encodePng(sheet.width, sheet.height, sheet.rgba));
    return result;
  } };
  const holed = await paintCharacter({ character: ember, style: 'A test style sentence for the painter.', generate: options => lossy.generate(options), dir: path.join(dir, 'holed'), source });
  assert.equal(holed.ok, false);
  assert.match(holed.report.error, /left out the piece layer-10/u);
});

test('pixel art is painted on the blueprint\'s own grid and comes back one picture pixel a cell', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-pixel-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const pixelEmber = normalizeCharacter({ ...emberRaw, render: { preset: 'pixel' } }, {});
  const painted = await paintCharacter({ character: pixelEmber, style: 'A test style sentence for the painter.', generate: options => fixturePainter().generate(options), dir, source: id => `runs/test-pair/qloo-on-skin-${id}.png` });
  assert.equal(painted.ok, true);
  assert.equal(painted.skin.pixel, true);
  assert.match(painted.report.prompt, /Paint on the attached sheet's pixel grid: every pixel is one of its square blocks, \d+ sheet pixels wide/u);
  const layout = JSON.parse(await fs.readFile(path.join(dir, 'layout.json'), 'utf8'));
  // The fixture hands the gridded blueprint back, so the cut finds the blueprint's grid from the sheet's corner.
  assert.equal(painted.report.grid.phaseX, 0);
  assert.equal(painted.report.grid.phaseY, 0);
  assert.ok(painted.report.grid.strength >= 1.8);
  assert.ok(painted.report.palette <= 32);
  const head = layout.pieces.find(piece => piece.bone === 'head');
  const picture = decodePng(await fs.readFile(path.join(dir, `${head.id}.png`)));
  assert.ok(picture.width <= Math.ceil(head.w / painted.report.grid.size) + 2, `${picture.width} cells across`);
  assert.ok(normalizeCharacter({ ...emberRaw, render: { preset: 'pixel' }, skin: painted.skin }, {}).skin.pixel);
});

async function paintedArm(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-painted-arm-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await prepareArm({ dir, arm: ARMS.find(arm => arm.mode === 'qloo'), brief, world: await loadWorld(), domains: GAME_DOMAINS, profile: await fixtureProfile(),
    paint: { perRun: 2, fixture: true }, pairId: 'test-pair' });
  return dir;
}

test('the paint tool follows the last check, refuses taste names and unknown pieces, then freezes the figure it painted', async t => {
  const dir = await paintedArm(t);
  const session = await createArmSession({ dir, painter: fixturePainter() });
  const call = (name, args = {}) => session.handle(name, args);
  assert.ok(session.definitions.some(tool => tool.name === 'game_paint_character'));
  assert.ok(!(await call('game_write_file', { path: 'game-assumption.json', content: fixtureAssumption() })).isError);
  const taste = (await call('game_get_taste')).structuredContent;
  const sketch = normalizeCharacterAssumption(fixtureAssumption(), { domains: GAME_DOMAINS }).characterSketch;
  const dna = fixtureDna({ input: taste, character: ember, measures: measureCharacter(ember), measured: true, sketch, deltaE });
  assert.ok(!(await call('game_write_file', { path: 'game-dna.json', content: dna })).isError);
  const forged = { ...emberRaw, skin: { images: [{ bone: 'head', src: 'runs/test-pair/qloo-off-skin-layer-1.png', rect: [-10, -20, 20, 20] }] } };
  assert.match((await call('game_write_file', { path: 'character.json', content: JSON.stringify(forged) })).content[0].text, /skin: leave it out/u, 'only the host writes a skin');
  assert.ok(!(await call('game_write_file', { path: 'character.json', content: JSON.stringify(emberRaw) })).isError);
  const style = 'Quilted mustard nylon with scuffed brass fittings, ink lines and warm wash.';
  assert.match((await call('game_paint_character', { style })).content[0].text, /Check the saved character\.json/u, 'painting waits for a check');
  const check = (await call('game_check_character')).content[0].text;
  assert.match(check, /PAINTABLE PIECES for game_paint_character \(11; the "ink" render preset/u);
  assert.match(check, /- layer-10: head, gathers hair-back, head, ear/u);
  const entity = taste.entities.find(item => item.source === 'qloo' && item.domain === 'movie');
  assert.match((await call('game_paint_character', { style: `${style} Like ${entity.name}.` })).content[0].text, /without naming taste entities/u);
  assert.match((await call('game_paint_character', { style, pieces: [{ id: 'layer-99', description: 'A piece that does not exist.' }] })).content[0].text, /not a piece of this drawing/u);
  assert.match((await call('game_paint_character', { style: 'Painted by Codex in a hurry, please.' })).content[0].text, /not the tools/u);
  const painted = await call('game_paint_character', { style, pieces: [{ id: 'layer-10', description: 'A round face with rosy cheeks under a teal knitted beanie.' }] });
  assert.equal(painted.structuredContent.status, 'painted', painted.content[0].text);
  assert.equal(painted.structuredContent.pieces, 11);
  assert.match(painted.structuredContent.use, /its scene, light, effects, motion, clips, lines and music can still be repaired/u);
  // The painting freezes the figure it was cut from; the moment around it can still be repaired.
  const write = value => call('game_write_file', { path: 'character.json', content: JSON.stringify(value) });
  const repaired = { ...emberRaw, scene: { ...emberRaw.scene, sky: ['#1b2f48', '#f09468'], weather: { kind: 'embers', density: 0.8 } }, light: { ...emberRaw.light, intensity: 1.3 } };
  assert.ok(!(await write(repaired)).isError, 'the sky, the weather and the light change after the painting');
  const frozen = /character\.json is frozen where the painting was cut from it: keep its skeleton, parts, cloth, style and render as painted/u;
  assert.match((await write({ ...repaired, palette: { ...emberRaw.palette, jacket: '#c4502e' } })).content[0].text, frozen, 'a palette colour the painted parts use stays');
  assert.match((await write({ ...repaired, parts: emberRaw.parts.map(part => (part.id === 'thigh' ? { ...part, r1: 7 } : part)) })).content[0].text, frozen, 'a painted part stays');
  assert.match((await write({ ...repaired, render: { preset: 'cel' } })).content[0].text, frozen, 'the technique the pieces were painted in stays');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'files', 'character.json'), 'utf8')).scene.weather.density, 0.8);
  assert.match((await call('game_check_character')).content[0].text, /PAINTED: 11 pieces in the ink technique/u);
  assert.match((await call('game_paint_character', { style })).content[0].text, /painted already/u);
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'host', 'skin.json'), 'utf8'));
  assert.equal(saved.folder, 'skin/paint-1');
  assert.ok(saved.skin.images.every(image => image.src.startsWith('runs/test-pair/qloo-on-skin-layer-')));
  const record = JSON.parse(await fs.readFile(path.join(dir, 'host', 'session.json'), 'utf8'));
  assert.equal(record.paint[0].status, 'painted');
  assert.match(record.paint[0].drawing, /^[0-9a-f]{16}$/u);
  assert.match(record.paint[0].prompt, /A round face with rosy cheeks under a teal knitted beanie\./u);
});

test('the design server lists the paint tool only in a painted arm', async t => {
  const dir = await paintedArm(t);
  const client = await connect({ dir });
  try { assert.ok((await client.tools()).some(tool => tool.name === 'game_paint_character')); } finally { await client.close(); }
});

test('the prompt offers a second painting only when the limit allows one', () => {
  const make = paint => makeCharacterPrompt({ brief, canon, mode: 'qloo', domains: GAME_DOMAINS, paint });
  const [once, twice, none] = [make({ perRun: 1 }), make({ perRun: 2 }), make(null)];
  assert.match(once, /leaves out a piece the tool says so and the character keeps its vector parts\./u);
  assert.doesNotMatch(once, /call it once more/u);
  assert.match(twice, /leaves out a piece the tool says so, and you may call it once more\./u);
  assert.doesNotMatch(none, /game_paint_character/u);
});

test('a painted dry run publishes each arm\'s pieces, figure and skinned character beside the pair record', async t => {
  const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-painted-runs-'));
  t.after(() => fs.rm(runsRoot, { recursive: true, force: true }));
  const record = await runPair({ brief, mode: 'dry-run', pairId: 'painted-pair', runsRoot, paintPerArm: 1 });
  assert.equal(record.status, 'completed', record.error);
  assert.equal(record.protocol.paintPerArm, 1);
  for (const arm of record.arms) {
    assert.equal(arm.paint.status, 'painted');
    assert.equal(arm.paint.provider, 'fixture');
    assert.equal(arm.paint.figure, `runs/painted-pair/${arm.key}-figure.png`);
    const character = JSON.parse(await fs.readFile(path.join(runsRoot, 'painted-pair', `${arm.key}.json`), 'utf8'));
    assert.ok(character.skin.images.length >= 8);
    for (const item of [...character.skin.images, ...(character.skin.cloth || []), ...(character.skin.tips || [])]) {
      assert.ok(fss.existsSync(path.join(runsRoot, item.src.replace(/^runs\//u, ''))), item.src);
    }
    assert.ok(fss.existsSync(path.join(runsRoot, 'painted-pair', `${arm.key}-figure.png`)));
  }
  assert.deepEqual(record.arms.map(arm => arm.paint.technique), ['watercolor', 'ink']);
});
