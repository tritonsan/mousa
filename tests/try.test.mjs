// The live try's parts and its pages: the request a juror can send, the agent file each kind of session runs, what a
// Kiro stream's lines say, the access code's signed cookie, and the pages and files a Studio serves for a try, with no
// script, behind the code, and the designs only from the preview origin by the run's token. Kiro is a fake and Qloo a
// fixture; no model, Qloo or browser request is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getConfig } from '../src/config.mjs';
import { createStudio } from '../src/server.mjs';
import { SHOWCASE_APP_CSP } from '../src/showcase.mjs';
import { checkTryInput, tryBrief, tryPlan, STARTERS } from '../src/try/starters.mjs';
import { tryAgent, sessionArgs, sessionEnvironment, callTool, refusalCode, sessionResources, stopProcess } from '../src/try/kiro.mjs';
import { createTryAccess, ACCESS_COOKIE, addressKey } from '../src/try/access.mjs';
import { qlooFixture } from './helpers/mousa-fixtures.mjs';
import { fakeKiro, predictScript, qlooArmScript, baselineArmScript } from './helpers/fake-kiro.mjs';

const CODE = 'a-test-only-access-code';
const readyKiro = async () => ({ available: true, authenticated: true, version: 'kiro-cli 2.24.0', defaultModel: 'fixed-test-model' });

test('a juror\'s request is checked, and set into its starter\'s own words', () => {
  const input = checkTryInput({ starter: 'blank-site', references: 'Paterson\n Nujabes ,Paterson', place: ' Moda ', ages: ['25_to_29'] });
  assert.deepEqual(input, { starter: 'blank-site', references: ['Paterson', 'Nujabes'], place: 'Moda', ages: ['25_to_29'] });
  assert.match(tryBrief(input), /It is for people who love Paterson and Nujabes, in Moda\. Use the Moûsa plugin/u);
  assert.match(tryBrief(input), /Moda Caddesi 42/u, 'the starter\'s facts stay in the request');
  assert.deepEqual(tryPlan(input), { dryRun: true, medium: 'web', references: [{ name: 'Paterson', role: 'audience', origin: 'user-provided' }, { name: 'Nujabes', role: 'audience', origin: 'user-provided' }], location: 'Moda', ages: ['25_to_29'] });
  for (const [body, words] of [[{ starter: 'other', references: 'Paterson' }, /Choose a starter/u], [{ starter: 'ramble' }, /Name one to 8/u], [{ starter: 'ramble', references: Array.from({ length: 9 }, (_, i) => `Film ${i}`) }, /Name one to 8/u],
    [{ starter: 'ramble', references: ['<img src=x>'] }, /plain names/u], [{ starter: 'ramble', references: ['x'.repeat(121)] }, /plain names/u], [{ starter: 'ramble', references: ['Paterson'], place: '{{city}}' }, /plain city/u],
    [{ starter: 'ramble', references: ['Paterson'], ages: ['13_to_17'] }, /age bands/u], [{ starter: 'constructor', references: ['Paterson'] }, /Choose a starter/u]]) {
    assert.throws(() => checkTryInput(body), error => error.status === 400 && words.test(error.message), JSON.stringify(body));
  }
  assert.deepEqual(Object.keys(STARTERS), ['blank-site', 'ramble', 'long-dusk']);
  assert.deepEqual(STARTERS['long-dusk'].writable, ['characters/ilo.json', 'generated/**']);
});

test('each kind of session runs Moûsa\'s server with its own tools, and only the arm with Qloo holds the key', () => {
  const common = { model: 'fixed-test-model', rootDir: '/srv/mousa', home: '/data/try/abc/kiro/x', project: '/data/try/abc/project', qloo: { key: 'fixture-key-123', baseUrl: 'https://qloo.test' }, platform: 'linux', execPath: '/usr/bin/node' };
  const predict = tryAgent({ ...common, kind: 'predict', starter: STARTERS.ramble });
  const outside = [{ folder: '/data/try/abc/project/.mousa' }, { folder: '/data/try/abc/project/compare/without-qloo' }, { file: '/data/try/abc/meta.json' }];
  const qloo = tryAgent({ ...common, kind: 'qloo', starter: STARTERS['long-dusk'], project: '/data/try/abc/project/compare/with-qloo', capture: { browser: '/usr/bin/chromium' },
    usageFile: '/data/try/abc/project/.mousa/usage.json', outside });
  const own = tryAgent({ ...common, kind: 'baseline', starter: STARTERS.ramble, project: '/data/try/abc/project/compare/without-qloo' });
  assert.equal(qloo.mcpServers.mousa.env.MOUSA_QLOO_USAGE_FILE, '/data/try/abc/project/.mousa/usage.json', 'the arm counts its requests in the try\'s one file');
  assert.equal(own.mcpServers.mousa.env.MOUSA_QLOO_USAGE_FILE, undefined);
  for (const denied of ['/data/try/abc/project/.mousa/**', '/data/try/abc/project/compare/without-qloo/**', '/data/try/abc/meta.json']) {
    assert.ok(qloo.toolsSettings.read.deniedPaths.includes(denied) && qloo.toolsSettings.write.deniedPaths.includes(denied), denied);
  }
  // The refusals come before what is allowed, so they hold however the engine orders its rules.
  for (const agent of [predict, qloo, own]) {
    const rules = agent.permissions.rules, firstAllow = rules.findIndex(rule => rule.effect === 'allow');
    assert.ok(rules.slice(firstAllow).every(rule => rule.effect === 'allow'), 'no refusal after an allowance');
  }
  assert.deepEqual(predict.tools, ['@mousa']);
  assert.equal(predict.toolsSettings, undefined);
  assert.ok(predict.permissions.rules.some(rule => rule.capability === 'fs_write' && rule.effect === 'deny' && rule.match.includes('**')));
  assert.deepEqual(qloo.mcpServers.mousa.args, ['/srv/mousa/plugin/server/mousa.mjs']);
  assert.equal(qloo.mcpServers.mousa.command, '/usr/bin/node');
  assert.equal(qloo.mcpServers.mousa.env.QLOO_API_KEY, 'fixture-key-123');
  assert.equal(qloo.mcpServers.mousa.env.MOUSA_BROWSER, '/usr/bin/chromium');
  assert.equal(own.mcpServers.mousa.env.QLOO_API_KEY, undefined);
  assert.equal(predict.mcpServers.mousa.env.QLOO_API_KEY, undefined);
  assert.deepEqual(qloo.toolsSettings.write.allowedPaths, ['characters/ilo.json', 'generated/**']);
  assert.ok(own.toolsSettings.write.deniedPaths.includes('data/**') && own.toolsSettings.write.deniedPaths.includes('**/.mousa/**'));
  for (const agent of [predict, qloo, own]) {
    assert.equal(agent.mcpServers.mousa.env.MOUSA_ENVIRONMENT, 'hosted');
    assert.equal(agent.mcpServers.mousa.env.MOUSA_IMAGES, 'off');
    assert.equal(agent.mcpServers.mousa.env.MOUSA_QLOO_BUDGET, '24');
    assert.equal(agent.includePowers, false);
    assert.ok(agent.permissions.rules.some(rule => rule.capability === 'shell' && rule.effect === 'deny'));
    assert.ok(agent.resources.every(resource => resource.startsWith('file:///srv/mousa/plugin/skills/')), agent.resources[0]);
  }
  assert.ok(sessionResources('qloo', 'game').includes('design/references/medium-game.md'));
  assert.ok(!sessionResources('baseline', 'web').some(file => file.startsWith('taste-brief/')), 'the arm without Qloo reads no measurement skill');
  assert.deepEqual(sessionArgs({ model: 'm', effort: 'low' }), ['chat', '--agent', 'mousa-try', '--agent-engine', 'v2', '--model', 'm', '--effort', 'low', '--no-interactive', '--output-format', 'stream-json', '--require-mcp-startup']);

  const config = { kiroApiKey: 'ksk_test_only', qlooKey: 'fixture-key-123', qlooBaseUrl: 'https://qloo.test' };
  const base = { PATH: '/usr/bin', HOME: '/root', QLOO_API_KEY: 'from-the-server', DEMO_ACCESS_TOKEN: 'never', SITE_SECRET: 'never' };
  const qlooEnv = sessionEnvironment({ config, home: '/h', kind: 'qloo', base, nodeDir: '/opt/node' });
  const ownEnv = sessionEnvironment({ config, home: '/h', kind: 'baseline', base, nodeDir: '/opt/node' });
  assert.equal(qlooEnv.QLOO_API_KEY, 'fixture-key-123');
  assert.equal(ownEnv.QLOO_API_KEY, undefined, 'the server\'s own key does not pass through');
  assert.equal(ownEnv.DEMO_ACCESS_TOKEN, undefined);
  assert.equal(ownEnv.SITE_SECRET, undefined);
  assert.equal(ownEnv.KIRO_API_KEY, 'ksk_test_only');
  assert.equal(ownEnv.KIRO_HOME, '/h');
  assert.match(ownEnv.PATH, /^\/opt\/node/u);
});

test('a Kiro stream line says which tool ran and whether Moûsa refused it, never what it read or wrote', () => {
  const mousa = { sessionUpdate: 'tool_call_update', toolCallId: 't1', kind: 'other', status: 'completed', title: 'Running: @mousa/design_validate', _meta: { kiro: { toolName: 'design_validate', mcpServerName: 'mousa' } },
    rawOutput: { items: [{ Json: { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: { code: 'TASTE_PROTOCOL_INVALID', message: 'Repair the DNA.' } }) }] } }] } };
  assert.equal(callTool(mousa), 'mousa:design_validate');
  assert.equal(refusalCode(mousa), 'TASTE_PROTOCOL_INVALID');
  assert.equal(callTool({ title: 'Reading image C:\\Users\\someone\\shot.png', kind: 'read', _meta: { kiro: { toolName: 'read' } } }), 'read');
  assert.equal(callTool({ title: 'Writing index.html', kind: 'edit' }), 'write');
  assert.equal(callTool({ title: 'Running: @other/tool', _meta: { kiro: { toolName: 'tool', mcpServerName: 'other' } } }), 'other tool');
  assert.equal(refusalCode({ rawOutput: { items: [{ Json: { content: [{ type: 'text', text: 'Saved.' }] } }] } }), null);
});

test('stopping a session ends its whole process tree, and an address is limited by what one subscriber holds', () => {
  const started = [];
  const fakeSpawn = (command, args) => { started.push([command, ...args]); return { on: () => {} }; };
  stopProcess({ pid: 4242, kill: () => started.push(['kill']) }, { platform: 'win32', spawnImpl: fakeSpawn });
  assert.deepEqual(started, [['taskkill', '/pid', '4242', '/T', '/F']]);
  let killed = 0;
  stopProcess({ kill: () => { killed++; } }, { platform: 'linux', spawnImpl: fakeSpawn });
  assert.equal(killed, 1, 'a process without a pid is killed as it is');
  assert.equal(addressKey('203.0.113.7'), '203.0.113.7');
  assert.equal(addressKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(addressKey('2001:db8:aa:bb:1:2:3:4'), '2001:db8:aa:bb::/64');
  assert.equal(addressKey('2001:0db8:00aa::5'), '2001:db8:aa:0::/64', 'one /64 for every address in it');
  assert.equal(addressKey('2001:db8:aa:0:ffff::9'), addressKey('2001:db8:aa::1'));
  assert.equal(addressKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
});

test('the access code opens a signed cookie for twelve hours; a wrong code is limited and a new code ends earlier access', () => {
  let clock = Date.parse('2026-10-20T10:00:00Z');
  const access = createTryAccess({ code: CODE, secret: 'test-only-site-secret', now: () => clock });
  const header = access.enter(CODE, { address: 'a', secure: true });
  assert.match(header, new RegExp(`^${ACCESS_COOKIE}=\\d+\\.[A-Za-z0-9_-]+; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure$`, 'u'));
  const request = cookie => ({ headers: { cookie } });
  const value = header.split(';')[0];
  assert.equal(access.granted(request(`other=1; ${value}`)), true);
  assert.equal(access.granted(request(value.replace(/.$/u, char => (char === 'A' ? 'B' : 'A')))), false, 'a changed signature');
  assert.equal(access.granted(request(`${ACCESS_COOKIE}=99999999999999.x`)), false);
  assert.equal(createTryAccess({ code: 'another-test-only-code', secret: 'test-only-site-secret', now: () => clock }).granted(request(value)), false, 'a new code ends the earlier access');
  clock += 12 * 60 * 60 * 1000 + 1;
  assert.equal(access.granted(request(value)), false, 'the access expires');
  for (let i = 0; i < 10; i++) assert.throws(() => access.enter('wrong', { address: 'b' }), error => error.status === 403);
  assert.throws(() => access.enter(CODE, { address: 'b' }), error => error.status === 429, 'ten wrong codes close the address for an hour');
  assert.ok(access.enter(CODE, { address: 'c' }));
});

/** A Studio with the try open on a fixture starter, its Kiro a fake. */
async function setup(t, { env = {} } = {}) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-try-site-'));
  const starter = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-try-site-starter-'));
  await fs.writeFile(path.join(starter, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title></head><body><main><h1>Shop</h1></main></body></html>');
  const qloo = qlooFixture();
  const studio = await createStudio({ config: getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: data, TRY_ACCESS_CODE: CODE, QLOO_API_KEY: 'fixture-key-123', KIRO_CLI_PATH: 'kiro-cli-test-only', ...env }), inspect: readyKiro,
    tryOptions: { fetchImpl: qloo.fetchImpl, log: { error: () => {}, warn: () => {} }, starters: { 'fixture-shop': { id: 'fixture-shop', title: 'A test-only shop', medium: 'web', source: starter, summary: 'A fixture.', protect: [], brief: audience => `Redesign the shop for people who love ${audience}.` } },
      spawnImpl: fakeKiro({ fetchImpl: qloo.fetchImpl, scripts: { predict: predictScript, qloo: qlooArmScript, baseline: baselineArmScript } }) } });
  t.after(async () => { await studio.close(); await fs.rm(data, { recursive: true, force: true }); await fs.rm(starter, { recursive: true, force: true }); });
  return { studio, app: studio.appUrl, preview: studio.previewBaseUrl };
}
const request = async (url, { method = 'GET', cookie = '', form = null, origin = null } = {}) => {
  const response = await fetch(url, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(origin ? { origin } : {}) }, ...(form ? { body: new URLSearchParams(form).toString() } : {}) });
  return { status: response.status, location: response.headers.get('location') || '', cookie: response.headers.get('set-cookie') || '', type: response.headers.get('content-type') || '', policy: response.headers.get('content-security-policy') || '', body: await response.text() };
};
const noScript = (page, what) => { assert.doesNotMatch(page.body, /<script/iu, what); assert.match(page.policy, /default-src 'none'/u, what); assert.doesNotMatch(page.policy, /script-src/u, what); };

test('behind a proxy that sends its own Host, forms may post from the app\'s public address, and only from it', () => {
  const base = { HOST: '127.0.0.1', DATA_DIR: os.tmpdir() };
  assert.equal(getConfig({ ...base, PUBLIC_APP_BASE_URL: 'https://d111111abcdef8.cloudfront.net' }).appBaseUrl, 'https://d111111abcdef8.cloudfront.net');
  assert.equal(getConfig({ ...base, TRUST_PROXY: '2' }).trustProxy, 2);
  assert.equal(getConfig(base).trustProxy, 0);
  assert.throws(() => getConfig({ ...base, PUBLIC_APP_BASE_URL: 'https://d111111abcdef8.cloudfront.net/try/' }), /origin with no path/u);
  assert.throws(() => getConfig({ ...base, PUBLIC_APP_BASE_URL: 'https://d1.cloudfront.net', PUBLIC_PREVIEW_BASE_URL: 'https://d1.cloudfront.net' }), /different origin/u);
  assert.throws(() => getConfig({ ...base, TRUST_PROXY: 'yes' }), /TRUST_PROXY/u);
});

test('the try\'s pages run no script and sit behind the access code; a try runs both steps from its forms and its designs play only by token', async t => {
  const { app, preview } = await setup(t, { env: { PUBLIC_APP_BASE_URL: 'https://d111111abcdef8.cloudfront.net' } });
  assert.equal((await request(`${app}/try/access`, { method: 'POST', form: { code: CODE }, origin: 'https://d111111abcdef8.cloudfront.net' })).status, 303, 'a post from the public address CloudFront serves');
  const gate = await request(`${app}/try/`);
  assert.equal(gate.status, 200);
  noScript(gate, 'the access page');
  assert.match(gate.body, /name="code" type="password"/u);
  assert.equal((await request(`${app}/try/access`, { method: 'POST', form: { code: 'wrong-code' } })).status, 403);
  assert.equal((await request(`${app}/try/access`, { method: 'POST', form: { code: CODE }, origin: 'https://elsewhere.example' })).status, 403, 'a post from another site');
  const entered = await request(`${app}/try/access`, { method: 'POST', form: { code: CODE }, origin: app });
  assert.equal(entered.status, 303);
  assert.match(entered.cookie, /HttpOnly; SameSite=Lax/u);
  const cookie = entered.cookie.split(';')[0];

  const start = await request(`${app}/try/`, { cookie });
  noScript(start, 'the request page');
  assert.match(start.body, /value="fixture-shop" checked/u);
  const refused = await request(`${app}/try/`, { method: 'POST', cookie, origin: app, form: { starter: 'fixture-shop', references: '<b>' } });
  assert.equal(refused.status, 400);
  assert.match(refused.body, /plain names/u);
  assert.match(refused.body, /&lt;b&gt;/u, 'the form keeps what was typed, escaped');
  const created = await request(`${app}/try/`, { method: 'POST', cookie, origin: app, form: { starter: 'fixture-shop', references: 'Paterson\nNujabes' } });
  assert.equal(created.status, 303);
  const id = /^\/try\/([a-f0-9]{32})\/$/u.exec(created.location)?.[1];
  assert.ok(id, created.location);

  const state = async () => JSON.parse((await request(`${app}/api/try/${id}`, { cookie })).body);
  const wait = async step => { for (let i = 0; i < 1500; i++) { const run = await state(); if (run[step] && !['queued', 'planning', 'predicting', 'measuring', 'preparing', 'designing', 'reporting'].includes(run[step].status)) return run; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error(`${step} did not finish`); };
  const measured = await wait('quick');
  assert.equal(measured.quick.status, 'done', measured.quick.problem);
  assert.equal(measured.previewToken, undefined, 'the API never gives the preview token');
  const page = await request(`${app}/try/${id}/`, { cookie });
  noScript(page, 'the try page');
  assert.doesNotMatch(page.body, /http-equiv="refresh"/u, 'a finished step does not refresh');
  assert.match(page.body, /What Qloo measured/u);
  assert.match(page.body, /action="\/try\/[a-f0-9]{32}\/design"/u);
  const report = await request(`${app}/try/${id}/files/.mousa/report/index.html`, { cookie });
  assert.equal(report.status, 200);
  assert.match(report.policy, /default-src 'none'/u);
  for (const hidden of ['.mousa/taste/profile.json', '.mousa/cache/qloo/.gitignore', '.mousa/report/..%2Ftaste%2Fbrief.json']) assert.equal((await request(`${app}/try/${id}/files/${hidden}`, { cookie })).status, 404, hidden);

  const asked = await request(`${app}/try/${id}/design`, { method: 'POST', cookie, origin: app, form: {} });
  assert.equal(asked.status, 303);
  const working = await request(`${app}/try/${id}/`, { cookie });
  if (['queued', 'preparing', 'designing', 'reporting'].includes((await state()).pair.status)) assert.match(working.body, /http-equiv="refresh" content="4"/u, 'a working step refreshes its page');
  const paired = await wait('pair');
  assert.equal(paired.pair.status, 'done', paired.pair.problem);
  const done = await request(`${app}/try/${id}/`, { cookie });
  noScript(done, 'the finished try page');
  const token = done.body.match(new RegExp(`${new URL(preview).origin.replace(/[.]/gu, '\\.')}/try/${id}/([a-f0-9]{48})/with-qloo/index\\.html`, 'u'))?.[1];
  assert.ok(token, 'the page frames the design from the preview origin with the run\'s token');
  assert.match(done.policy, new RegExp(`frame-src ${new URL(preview).origin.replace(/[.]/gu, '\\.')}`, 'u'));
  assert.match(done.body, /files\/compare\/without-qloo\/\.mousa\/report\/index\.html/u);
  const played = await request(`${preview}/try/${id}/${token}/with-qloo/index.html`);
  assert.equal(played.status, 200);
  assert.equal(played.policy, SHOWCASE_APP_CSP);
  assert.equal((await request(`${preview}/try/${id}/${'0'.repeat(48)}/with-qloo/index.html`)).status, 404, 'a wrong token');
  assert.equal((await request(`${preview}/try/${id}/${token}/with-qloo/.mousa/taste/input.json`)).status, 404, 'never a hidden file');
  assert.equal((await request(`${app}/try/${id}/${token}/with-qloo/index.html`, { cookie })).status, 404, 'the design never plays from the app origin');
  const shot = await request(`${app}/try/${id}/progress/with-qloo.png`, { cookie });
  assert.equal(shot.status, 200);
  assert.equal(shot.type, 'image/png');

  const published = await request(`${app}/try/${id}/publish`, { method: 'POST', cookie, origin: app, form: { consent: 'yes' } });
  assert.equal(published.status, 303);
  assert.equal((await state()).consent.publish, true);
  assert.match((await request(`${app}/try/${id}/`, { cookie })).body, /Withdraw my consent/u);

  // Without the cookie, nothing of the try opens.
  assert.equal((await request(`${app}/api/try/${id}`)).status, 401);
  assert.match((await request(`${app}/try/${id}/`)).body, /name="code" type="password"/u);
  const anonymous = await request(`${app}/try/${id}/files/.mousa/report/index.html`);
  assert.match(anonymous.body, /name="code" type="password"/u);
  assert.doesNotMatch(anonymous.body, /What Qloo measured/u, 'a report needs the access code');
  assert.equal((await request(`${app}/try/${'a'.repeat(32)}/`, { cookie })).status, 404);
});

test('a Studio without the try\'s code shows what the try will be, and its API says it is closed; LEGACY_JOBS=off closes the Studio\'s own runs', async t => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-try-closed-'));
  const studio = await createStudio({ config: getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: data, LEGACY_JOBS: 'off', MOUSA_COMMIT: 'abc1234' }), inspect: readyKiro });
  t.after(async () => { await studio.close(); await fs.rm(data, { recursive: true, force: true }); });
  const pending = await request(`${studio.appUrl}/try/`);
  assert.equal(pending.status, 200);
  assert.match(pending.body, /The live try is not open yet\./u);
  noScript(pending, 'the pending page');
  assert.equal(JSON.parse((await request(`${studio.appUrl}/api/try/starters`)).body).open, false);
  assert.equal((await request(`${studio.appUrl}/try/access`, { method: 'POST', form: { code: 'anything-at-all' } })).status, 503);
  const job = await fetch(`${studio.appUrl}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ templateId: 'shop', brief: 'A shop.' }) });
  assert.equal(job.status, 403);
  assert.match((await job.json()).error, /no new Studio jobs/u);
  const health = JSON.parse((await request(`${studio.appUrl}/api/health/deep`)).body);
  assert.equal(health.status, 'degraded', 'a closed try is not ready');
  assert.deepEqual([health.try.open, health.try.missing, health.legacyJobs, health.commit], [false, ['TRY_ACCESS_CODE is not set.', 'QLOO_API_KEY is not set.'], false, 'abc1234']);
  assert.ok(health.disk.freeBytes > 0 && Number.isInteger(health.try.quick.waiting));
  assert.doesNotMatch(JSON.stringify(health), /fixture-key|access-code/u);
});
