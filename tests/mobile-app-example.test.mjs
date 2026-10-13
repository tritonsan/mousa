// The mobile app example: the starter the portable plugin redesigns outside the Studio. Its tokens agree across files,
// an app-ui DNA built on it passes conformance through the standalone tools, the tools capture it in a real browser
// when one is installed, and its Kiro agent stays inside its folder. Every run works on a copy; nothing is written into
// the example. No model, Qloo or Codex request is made.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rootDir } from '../src/config.mjs';
import { designTokens } from '../plugin/server/production/media.mjs';
import { inspectBrowser, verifyBrowser } from '../plugin/server/production/capture.mjs';
import { decodePng } from '../plugin/server/production/image-files.mjs';
import { createToolHandler, getToolDefinitions } from '../plugin/server/mcp/server.mjs';

const example = path.join(rootDir, 'examples', 'mobile-app');
const read = file => fs.readFile(path.join(example, ...file.split('/')), 'utf8');
const SCREENS = ['screen-welcome', 'screen-walks', 'screen-detail', 'screen-walk'];
const PATHS = ['index.html', 'styles.css', 'tokens/tokens.css', 'tokens/tokens.json', 'app.js'];

async function copy(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-ramble-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(example, root, { recursive: true });
  return root;
}
// The plugin's standalone tools on the copy, with the image generator reported off so the list does not depend on this machine.
function tools(root) {
  const handler = createToolHandler({ includeQlooTools: false, production: { env: { MOUSA_PROJECT_DIR: root, MOUSA_LIBRARY_ROOT: rootDir },
    inspect: { image: async () => ({ available: false, reason: 'Test-only: no image generator is offered here.' }) } } });
  return async (name, args = {}) => {
    const reply = await handler(name, args);
    assert.ok(!reply.isError, JSON.stringify(reply.structuredContent?.error || reply.content));
    return reply.structuredContent;
  };
}
const declarations = css => new Map([...css.matchAll(/--([A-Za-z0-9_-]+)\s*:\s*([^;]+);/gu)].map(match => [match[1].toLowerCase(), match[2].trim()]));

test('the starter keeps every value in its design tokens, declared once and used through var()', async () => {
  const tokens = designTokens(JSON.parse(await read('tokens/tokens.json')));
  const declared = declarations(await read('tokens/tokens.css'));
  assert.deepEqual([...declared.keys()].sort(), [...tokens.keys()].sort());
  for (const [name, value] of tokens) assert.equal(declared.get(name), value, name);
  const styles = await read('styles.css');
  const used = new Set([...styles.matchAll(/var\(\s*--([A-Za-z0-9_-]+)/gu)].map(match => match[1].toLowerCase()));
  assert.deepEqual([...used].filter(name => !tokens.has(name)), [], 'styles.css uses only tokens');
  assert.deepEqual([...tokens.keys()].filter(name => !used.has(name)), [], 'every token is used');
  assert.equal(/#[0-9a-f]{3,8}\b/iu.test(styles), false, 'styles.css writes no color of its own');
  assert.deepEqual([...styles.matchAll(/font-family\s*:\s*([^;]+);/gu)].map(match => match[1].trim()).filter(value => !/^var\(--font-[a-z-]+\)$/u.test(value)), []);
  const html = await read('index.html');
  for (const id of SCREENS) assert.match(html, new RegExp(`<section class="screen" id="${id}"`, 'u'));
  assert.ok(html.indexOf('tokens/tokens.css') < html.indexOf('styles.css'), 'the tokens load before the styles that read them');
  const data = JSON.parse(await read('data/walks.json'));
  assert.equal(data.walks.length, 4);
  assert.equal(new Set(data.walks.map(walk => walk.id)).size, 4);
  for (const walk of data.walks) {
    assert.ok(walk.name && walk.district && walk.summary && walk.distanceKm > 0 && walk.minutes > 0 && typeof walk.stepFree === 'boolean', walk.id);
    assert.ok(walk.stops.length >= 5 && walk.stops.every(stop => stop.name && stop.note), walk.id);
    assert.equal(walk.start, walk.stops[0].name, walk.id);
  }
  assert.match(await read('app.js'), /fetch\('data\/walks\.json'\)/u);
});

test('an app-ui DNA built on the starter passes conformance through the standalone tools, and a value outside the tokens is named', async t => {
  const root = await copy(t);
  const call = tools(root);
  const listed = await call('culture_list_capabilities', { medium: 'app-ui' });
  assert.deepEqual(listed.medium.views, [{ id: 'phone', width: 390, height: 844 }, { id: 'board', width: 1440, height: 900 }]);
  assert.ok(listed.capabilities.methods.some(item => item.id === 'design-tokens' && item.available));
  assert.deepEqual(listed.capabilities.methods.find(item => item.id === 'generated-image'), { id: 'generated-image', kind: 'generator', layers: ['imagery'],
    description: listed.capabilities.methods.find(item => item.id === 'generated-image').description, generator: 'image', available: false, reason: 'Test-only: no image generator is offered here.' });
  const dna = { devices: [
    { id: 'dna1', layer: 'palette', device: 'Harbour ink and signal blue', tokens: { colors: ['#1d232b', '#2563c9'] } },
    { id: 'dna2', layer: 'voice', device: 'A plain walking guide', tokens: { copy: ['Walk the city at your own pace', 'A short note at every stop'] } },
    { id: 'dna3', layer: 'palette', device: 'A color the tokens do not hold', tokens: { colors: ['#abcdef'] } },
  ] };
  const report = await call('culture_check_dna_conformance', { dna, paths: PATHS, medium: 'app-ui' });
  assert.deepEqual(report.devices.map(device => `${device.id}:${device.status}`), ['dna1:present', 'dna2:present', 'dna3:missing']);
  assert.ok(report.devices[2].missing.some(item => item.kind === 'token' && /no token in tokens\/tokens\.json has the value #abcdef/u.test(item.detail)));
  assert.deepEqual(report.tokens, { file: 'tokens/tokens.json', count: 24, used: 24 });
});

test('the standalone tools capture the starter at the phone and board views, rendered from its data and tokens', async t => {
  const browser = await verifyBrowser(await inspectBrowser());
  if (!browser.available) { t.skip(browser.reason); return; }
  const root = await copy(t);
  const call = tools(root);
  const first = await call('culture_capture', { medium: 'app-ui' });
  assert.deepEqual(first.captures.map(shot => [shot.id, shot.width, shot.height, shot.path]), [['r1-phone', 390, 844, '.mousa/captures/r1-phone.png'], ['r1-board', 1440, 900, '.mousa/captures/r1-board.png']]);
  const walks = await call('culture_capture', { medium: 'app-ui', views: ['phone'], target: 'screen-walks' });
  assert.deepEqual(walks.captures.map(shot => shot.id), ['r1-phone-screen-walks']);
  const pixels = async (file, [r, g, b]) => {
    const image = decodePng(await fs.readFile(path.join(root, ...file.split('/'))));
    let count = 0;
    for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) { const [pr, pg, pb] = image.pixel(x, y); if (pr === r && pg === g && pb === b) count += 1; }
    return count;
  };
  // The accent token fills the primary buttons, and the badge token the step-free badges app.js renders from the data.
  assert.ok(await pixels('.mousa/captures/r1-phone.png', [0x25, 0x63, 0xc9]) > 5000);
  assert.ok(await pixels('.mousa/captures/r1-board.png', [0x25, 0x63, 0xc9]) > 10000);
  assert.ok(await pixels('.mousa/captures/r1-phone-screen-walks.png', [0xe3, 0xec, 0xfa]) > 500);
  const issued = JSON.parse(await fs.readFile(path.join(root, '.mousa', 'captures.json'), 'utf8')).captures;
  assert.deepEqual(issued.map(shot => shot.id).sort(), ['r1-board', 'r1-phone', 'r1-phone-screen-walks']);
  await assert.rejects(fs.access(path.join(example, '.mousa')), 'the example itself stays as shipped');
});

test('the Kiro agent wires the plugin from the example folder and keeps its own tools inside it', async () => {
  const agent = JSON.parse(await read('.kiro/agents/mousa-designer.json'));
  const server = agent.mcpServers.mousa;
  assert.equal(server.command, 'node');
  assert.equal(path.resolve(example, server.args[0]), path.join(rootDir, 'plugin', 'server', 'index.mjs'));
  assert.deepEqual(server.env, { MOUSA_PROJECT_DIR: '.' });
  // The prompt and resources resolve from the agent file's own folder.
  const agents = path.join(example, '.kiro', 'agents');
  const local = uri => path.resolve(agents, uri.replace(/^file:\/\//u, ''));
  const prompt = await fs.readFile(local(agent.prompt), 'utf8');
  assert.deepEqual(agent.resources.map(local), ['SKILL.md', 'policy.md', 'taste-policy.md', 'production-policy.md'].map(file => path.join(rootDir, 'plugin', 'skills', 'culture-grounded-design', file)));
  for (const resource of agent.resources) await fs.access(local(resource));
  assert.deepEqual([agent.tools, agent.allowedTools], [['@mousa', 'read', 'write'], ['@mousa']]);
  assert.deepEqual(agent.toolsSettings.read.allowedPaths, ['./**']);
  assert.deepEqual(agent.toolsSettings.write.allowedPaths, ['./**']);
  for (const denied of ['**/.env', '**/.env.*', '.kiro/**']) assert.ok(agent.toolsSettings.read.deniedPaths.includes(denied), denied);
  for (const denied of ['**/.env', '.kiro/**', '.mousa/**', 'data/**']) assert.ok(agent.toolsSettings.write.deniedPaths.includes(denied), denied);
  assert.equal(agent.includeMcpJson, false);
  // Every plugin tool the prompt names exists, with the arguments it passes.
  const definitions = getToolDefinitions();
  for (const name of new Set(prompt.match(/\b(?:culture|qloo)_[a-z_]+\b/gu))) assert.ok(definitions.some(tool => tool.name === name), name);
  for (const [, name, body] of prompt.matchAll(/\b((?:culture|qloo)_[a-z_]+)\(\{([^}]*)\}\)/gu)) {
    const properties = definitions.find(tool => tool.name === name).inputSchema.properties;
    for (const key of body.replace(/\[[^\]]*\]/gu, '').replace(/'[^']*'/gu, '').split(',').map(part => part.split(':')[0].trim()).filter(Boolean)) assert.ok(Object.hasOwn(properties, key), `${name}.${key}`);
  }
  // No credential is written anywhere in the example.
  const files = (await fs.readdir(example, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());
  for (const entry of files) {
    const text = await fs.readFile(path.join(entry.parentPath, entry.name), 'utf8');
    assert.equal(/(?:QLOO|KIRO)_API_KEY\s*[=:]\s*\S|ksk_[A-Za-z0-9]/u.test(text), false, entry.name);
  }
});
