// The public site a Studio serves from its gallery: the landing page at the plain address with the Studio moved to
// /studio, the gallery and session pages with no script under a policy that allows none, a report's files from the
// app origin, and the design's own code only from the preview origin, sandboxed. A fixture run is built into the
// gallery first; no model, Qloo or browser request is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../src/config.mjs';
import { createStudio } from '../src/server.mjs';
import { buildGallery } from '../src/gallery/build.mjs';
import { SHOWCASE_APP_CSP } from '../src/showcase.mjs';
import { loadFontLibrary } from '../plugin/server/production/fonts.mjs';
import { fixtureRun, fixtureConfig } from './helpers/gallery-fixtures.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readyKiro = async () => ({ available: true, authenticated: true, version: 'test-only', defaultModel: 'fixed-test-model' });

/** A Studio on a data folder whose gallery holds the fixture run, or none. */
async function setup(t, { gallery = true, env = {} } = {}) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-site-data-'));
  const runs = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-site-runs-'));
  if (gallery) {
    await fixtureRun(runs);
    const built = await buildGallery({ config: fixtureConfig(), runsDir: runs, repo, out: path.join(data, 'gallery'), library: await loadFontLibrary(repo) });
    assert.equal(built.written, true, JSON.stringify(built.findings));
  }
  const studio = await createStudio({ config: getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: data, ...env }), inspect: readyKiro });
  t.after(async () => { await studio.close(); await fs.rm(data, { recursive: true, force: true }); await fs.rm(runs, { recursive: true, force: true }); });
  return { studio, app: studio.appUrl, preview: studio.previewBaseUrl };
}

const get = async url => { const response = await fetch(url); return { status: response.status, type: response.headers.get('content-type') || '', policy: response.headers.get('content-security-policy') || '', body: await response.text() }; };

test('with a gallery the plain address opens the site, every page runs no script, and the Studio moves to /studio', async t => {
  const { app, preview } = await setup(t, { env: { SITE_REPOSITORY_URL: 'https://github.com/example/mousa' } });
  const landing = await get(`${app}/`);
  assert.equal(landing.status, 200);
  assert.match(landing.body, /AI agents design for the audience they imagine\./u);
  assert.match(landing.body, /href="\/gallery\/fixture-pantry\/"/u);
  assert.match(landing.body, /github\.com\/example\/mousa/u, 'the repository the site names');
  for (const page of [landing, await get(`${app}/gallery/`), await get(`${app}/gallery/fixture-pantry/`)]) {
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.body, /<script/iu);
    assert.match(page.policy, /default-src 'none'/u);
    assert.doesNotMatch(page.policy, /script-src/u);
  }
  const entry = await get(`${app}/gallery/fixture-pantry/`);
  assert.match(entry.policy, new RegExp(`frame-src ${new URL(preview).origin.replace(/[.]/gu, '\\.')};`, 'u'), 'a session page frames only the preview origin');
  assert.match(landing.policy, new RegExp(`frame-src ${new URL(preview).origin.replace(/[.]/gu, '\\.')} https://www\\.youtube-nocookie\\.com;`, 'u'), 'the landing page also frames the video');
  assert.match((await get(`${app}/judges/`)).policy, /frame-src \S+ https:\/\/www\.youtube-nocookie\.com;/u, 'so does the jury page');
  assert.match(entry.body, new RegExp(`<iframe src="${new URL(preview).origin.replace(/[.]/gu, '\\.')}/gallery/fixture-pantry/out/design/index\\.html"[^>]*sandbox="allow-scripts allow-forms"`, 'u'));
  assert.match(entry.body, /What the agent did/u);
  assert.match(entry.body, /refused: TASTE_PROTOCOL_INVALID/u);
  assert.match(entry.body, /node scripts\/run-claude-code-live\.mjs --run/u);
  assert.match(entry.body, /src="\/gallery\/fixture-pantry\/report\/assets\/captures\/r1-desktop\.png"/u, 'the report\'s captures load from the app origin');
  const studio = await get(`${app}/studio`);
  assert.equal(studio.status, 200);
  assert.match(studio.body, /<script defer src="\/app\.js"><\/script>/u);
  assert.equal((await get(`${app}/gallery/no-such-entry/`)).status, 404);
  const index = JSON.parse((await get(`${app}/api/gallery`)).body);
  assert.deepEqual(index.entries.map(item => item.id), ['fixture-pantry']);
  const css = await get(`${app}/site/report.css`);
  assert.match(css.body, /@font-face\{font-family:'Fraunces';src:url\('\/library\/fonts\/fraunces-/u, 'the report styles load the library fonts from this origin');
});

test('a report\'s files come from the app origin and the design\'s files only from the preview origin, sandboxed', async t => {
  const { app, preview } = await setup(t);
  const record = await get(`${app}/gallery/fixture-pantry/report/record.json`);
  assert.equal(record.status, 200);
  assert.equal(JSON.parse(record.body).kind, 'session');
  const report = await get(`${app}/gallery/fixture-pantry/report/index.html`);
  assert.equal(report.status, 200);
  assert.match(report.policy, /default-src 'none'/u);
  assert.doesNotMatch(report.policy, /script-src/u);
  assert.equal((await get(`${app}/gallery/fixture-pantry/report/%2e%2e/entry.json`)).status, 404, 'no step out of the report');
  assert.equal((await get(`${app}/gallery/fixture-pantry/out/design/index.html`)).status, 404, 'the design\'s code never runs on the app origin');
  const design = await get(`${preview}/gallery/fixture-pantry/out/design/index.html`);
  assert.equal(design.status, 200);
  assert.equal(design.policy, SHOWCASE_APP_CSP);
  assert.match(design.policy, /sandbox allow-scripts/u);
  assert.equal((await get(`${preview}/gallery/fixture-pantry/out/design/styles.css`)).type, 'text/css; charset=utf-8');
  for (const missing of ['/gallery/fixture-pantry/report/record.json', '/gallery/fixture-pantry/out/design/.mousa/session.json', '/gallery/fixture-pantry/out/%2e%2e/entry.json', '/gallery/no-such-entry/out/design/index.html']) {
    assert.equal((await get(`${preview}${missing}`)).status, 404, missing);
  }
});

test('without a gallery the plain address still opens the Studio', async t => {
  const { app } = await setup(t, { gallery: false });
  const home = await get(`${app}/`);
  assert.equal(home.status, 200);
  assert.match(home.body, /<script defer src="\/app\.js"><\/script>/u);
  assert.equal((await get(`${app}/gallery/`)).status, 404);
});
