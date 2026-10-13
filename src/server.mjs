import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadDotEnv, getConfig, isLoopback, redact } from './config.mjs';
import { inspectKiro } from './doctor.mjs';
import { templates } from './templates.mjs';
import { JobManager, HttpError, validModes } from './jobs.mjs';
import { QlooClient } from './qloo/client.mjs';
import { createToolHandler, dispatchRpc } from './mcp/server.mjs';
import { validateProjectPath } from './project.mjs';
import { WorkspaceStore } from './workspaces.mjs';
import { portableRunRecords } from './design-artifacts.mjs';
import { loadLibrary, libraryPhoto, libraryPhotosUsed } from './library.mjs';
import { FONT_FILE_PATH, loadFontLibrary, fontLibraryFile, fontFilesUsed } from './fonts.mjs';
import { GENERATED_IMAGE_PATH, createImageGenerator } from './image-generator.mjs';
import { CHARACTER_KIND, characterDefaults, listCharacterJobs } from './character-jobs.mjs';
import { MUSIC_PATH, loadMusicLibrary, musicLibraryFile, sendLibraryFile } from '../game/harness/music.mjs';
import { PREVIEW_CSP, CAPTURE_ID, REVIEW_DIR, createSiteCapture } from './site-production.mjs';
import { inspectBrowser, verifyBrowser } from '../plugin/server/production/capture.mjs';
import { loadShowcase, isShowcaseJob, showcaseAppFile, SHOWCASE_APP_CSP } from './showcase.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
// The app shows generated-image thumbnails from the separate preview origin, which is added to img-src per response.
const appCsp = origin => `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${origin}; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src 'self' ${origin}`;
// The capture of a site for its review serves it under this same policy, so a capture shows what the preview shows.
const previewCsp = PREVIEW_CSP;
// The game pages are host code that fetches its own world and the pair's validated JSON; nothing inline runs, and the
// sandbox gives the page an opaque origin, so every response it loads allows any origin.
const gameCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors *; sandbox allow-scripts";
const GAME_FILES = /^(?:index\.html|compare\.html|styles\.css|src\/[a-z-]{1,40}\.js|world\/canon\.json|characters\/maren\.json)$/u;
// A painted arm adds its pieces and its standing figure, which run-pair.mjs publishes beside the arm's character file.
const PAIR_FILES = /^(?:pair\.json|qloo-(?:off|on|swap)\.json|qloo-(?:off|on|swap)-portrait-[12]\.(?:jpg|png)|qloo-(?:off|on|swap)-skin-(?:layer|strip|tip)-[a-z0-9-]{1,50}\.png|qloo-(?:off|on|swap)-figure\.png|qloo-(?:off|on|swap)-review-r[1-3]-(?:pose|walk|scene|kindle)\.png)$/u;

export function tokenMatches(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function send(res, status, value, headers = {}) {
  const isJson = value && typeof value === 'object' && !Buffer.isBuffer(value);
  const body = isJson ? JSON.stringify(value) : value;
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
  res.end(body);
}
async function readJson(req, limit = 200000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new HttpError(413, 'Request size limit exceeded.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'Valid JSON is required.'); }
}
function authorized(req, config) {
  if (!config.accessToken) return true;
  return tokenMatches(req.headers['x-demo-token'], config.accessToken) || tokenMatches(req.headers.authorization?.replace(/^Bearer /i, ''), config.accessToken);
}
function requireAuth(req, config) { if (!authorized(req, config)) throw new HttpError(401, 'A valid reviewer access code is required.'); }
function checkOrigin(req) {
  if (!req.headers.origin) return;
  let origin; try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'Request origin rejected.'); }
  if (origin.host !== req.headers.host) throw new HttpError(403, 'Generation requests from another site are not accepted.');
}

export async function createStudio({ config = getConfig(), inspect = inspectKiro, runner, characterRunner, qlooClientFactory, imageGenerator = null, siteCapture = null, browser = null } = {}) {
  let kiro = await inspect(config);
  const getKiroStatus = async () => kiro;
  const workspaces = new WorkspaceStore(config, templates); await workspaces.initialize();
  const manager = new JobManager({ config, templates, getKiroStatus, workspaces, imageGenerator, siteCapture, browser, ...(runner ? { runner } : {}), ...(characterRunner ? { characterRunner } : {}), ...(qlooClientFactory ? { qlooClientFactory } : {}) });
  await manager.initialize();
  // The recorded work a reviewer sees first, readable without the access token; read once at start.
  const showcase = await loadShowcase({ dataDir: config.dataDir, jobs: manager.jobs });
  for (const note of showcase.notes) console.warn(`Showcase: ${note}`);
  let previewBaseUrl = config.previewBaseUrl;
  // A network client of /mcp gets the validators and the font catalog, but no file, image or capture tool: those act on
  // this machine, so the endpoint reports them as a hosted server would.
  const standaloneHandler = createToolHandler({ qlooClient: new QlooClient({ apiKey: config.qlooKey, baseUrl: config.qlooBaseUrl }),
    production: { env: { MOUSA_ENVIRONMENT: 'hosted', MOUSA_CAPTURE: 'off', MOUSA_LIBRARY_ROOT: config.rootDir } } });

  const previewServer = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') return send(res, 405, 'Method not allowed.');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health') return send(res, 200, { status: 'ok', service: 'preview' });
      // A character pair plays in the game's own pages, at the same relative paths as game/serve.mjs: the game's code
      // and world from game/, the bundled fonts from the font library, and only this job's pair files from its data.
      const gameMatch = url.pathname.match(/^\/game\/([a-f0-9-]{36})\/([a-f0-9]{48})\/(.+)$/);
      if (gameMatch) {
        const job = manager.get(gameMatch[1]);
        if (job.kind !== CHARACTER_KIND || !tokenMatches(gameMatch[2], job.previewToken)) throw new HttpError(403, 'Preview access denied.');
        if (job.status !== 'completed') throw new HttpError(404, 'This character pair is not ready yet.');
        let requested;
        try { requested = decodeURIComponent(gameMatch[3]); } catch { throw new HttpError(404, 'Not found.'); }
        const headers = { 'Content-Security-Policy': gameCsp, 'Access-Control-Allow-Origin': '*' };
        const serve = async (file, type, extra = {}) => {
          const body = await fs.readFile(file).catch(() => { throw new HttpError(404, 'Not found.'); });
          return send(res, 200, body, { 'Content-Type': type, ...headers, ...extra });
        };
        // Awaited, so a listed file that is missing reaches the handler below as a 404.
        if (GAME_FILES.test(requested)) return await serve(path.join(config.rootDir, 'game', ...requested.split('/')), mime[path.extname(requested)]);
        if (FONT_FILE_PATH.test(requested)) {
          const face = fontLibraryFile(await loadFontLibrary(config.rootDir), requested);
          if (!face) throw new HttpError(404, 'Font not found.');
          return await serve(face.file, 'font/woff2', { 'Cache-Control': 'private, max-age=86400' });
        }
        // The open music library: its catalog and the tracks it lists, with byte ranges for the audio element.
        if (MUSIC_PATH.test(requested)) {
          const music = musicLibraryFile(config.rootDir, await loadMusicLibrary(config.rootDir), requested);
          if (!music) throw new HttpError(404, 'Track not found.');
          return await sendLibraryFile(req, res, music, { ...headers, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
            .catch(error => { if (res.headersSent) { res.destroy(); return; } throw error.code === 'ENOENT' ? new HttpError(404, 'Track not found.') : error; });
        }
        const pairFile = requested.match(/^runs\/([a-z0-9-]{1,60})\/([a-z0-9-]+\.[a-z]+)$/u);
        if (pairFile && pairFile[1] === job.pairId && PAIR_FILES.test(pairFile[2])) return await serve(path.join(config.dataDir, job.id, job.pairId, pairFile[2]), mime[path.extname(pairFile[2])]);
        throw new HttpError(404, 'Not found.');
      }
      // The showcased app run: the starter as it was, the redesign and the review captures, sandboxed like a site preview.
      const appMatch = url.pathname.match(/^\/showcase\/app\/([a-z0-9-]{3,61})\/(.+)$/u);
      if (appMatch) {
        if (showcase.app?.id !== appMatch[1]) throw new HttpError(404, 'Not found.');
        let relative;
        try { relative = decodeURIComponent(appMatch[2]); } catch { throw new HttpError(404, 'Not found.'); }
        const found = showcaseAppFile({ dataDir: config.dataDir, id: showcase.app.id, relative });
        if (!found) throw new HttpError(404, 'Not found.');
        const body = await fs.readFile(found.file).catch(() => { throw new HttpError(404, 'Not found.'); });
        return send(res, 200, body, { 'Content-Type': found.type, 'Content-Security-Policy': SHOWCASE_APP_CSP, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=600' });
      }
      const match = url.pathname.match(/^\/preview\/([a-f0-9-]{36})\/(baseline|qloo)\/([a-f0-9]{48})\/(.+)$/);
      if (!match) throw new HttpError(404, 'Preview not found.');
      const job = manager.get(match[1]);
      if (!tokenMatches(match[3], job.previewToken)) throw new HttpError(403, 'Preview access denied.');
      // A review capture is the host's own PNG of the run's site, shown while the run is still working: only captures it recorded.
      const reviewMatch = /^__review\/([A-Za-z0-9_-]{1,90})\.png$/u.exec(match[4]);
      if (reviewMatch) {
        const capture = (job.kind || 'build') === 'build' ? job.runs.find(r => r.mode === match[2])?.production?.captures?.find(item => item.id === reviewMatch[1]) : null;
        if (!capture || !CAPTURE_ID.test(capture.id)) throw new HttpError(404, 'Capture not found.');
        const body = await fs.readFile(path.join(config.dataDir, job.id, match[2], REVIEW_DIR, `${capture.id}.png`)).catch(() => { throw new HttpError(404, 'Capture not found.'); });
        return send(res, 200, body, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': previewCsp, 'Access-Control-Allow-Origin': '*' });
      }
      if (!['build', 'revise'].includes(job.kind || 'build') || !job.runs.some(r => r.mode === match[2] && r.status === 'completed')) throw new HttpError(404, 'Preview is not ready yet.');
      if (match[4] === '__culture-inspector.js') {
        const inspector = await fs.readFile(path.join(config.rootDir, 'src', 'preview-inspector.js'), 'utf8');
        return send(res, 200, inspector, { 'Content-Type': mime['.js'], 'Content-Security-Policy': previewCsp });
      }
      const requested = decodeURIComponent(match[4]);
      // Library photos are binary host files, not project files: only photos listed for this job's starter are served.
      if (/^library\/[a-z0-9][a-z0-9-]{0,60}\.jpg$/u.test(requested)) {
        const photo = libraryPhoto(await loadLibrary(config.rootDir, job.templateId), requested);
        if (!photo) throw new HttpError(404, 'Photo not found.');
        return send(res, 200, await fs.readFile(photo.file), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': previewCsp, 'Access-Control-Allow-Origin': '*' });
      }
      // Fonts are binary host files too: only files the font library lists are served. A sandboxed preview has an opaque
      // origin and fonts load in CORS mode, so the response allows any origin.
      if (FONT_FILE_PATH.test(requested)) {
        const face = fontLibraryFile(await loadFontLibrary(config.rootDir), requested);
        if (!face) throw new HttpError(404, 'Font not found.');
        return send(res, 200, await fs.readFile(face.file), { 'Content-Type': 'font/woff2', 'Cache-Control': 'private, max-age=86400', 'Content-Security-Policy': previewCsp, 'Access-Control-Allow-Origin': '*' });
      }
      // Generated images are binary run assets: only images this run recorded are served.
      if (GENERATED_IMAGE_PATH.test(requested)) {
        const image = job.runs.find(r => r.mode === match[2])?.generatedImages?.find(item => item.path === requested);
        if (!image) throw new HttpError(404, 'Image not found.');
        return send(res, 200, await fs.readFile(manager.assetPath(job, match[2], image.path)), { 'Content-Type': image.format === 'png' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': previewCsp, 'Access-Control-Allow-Origin': '*' });
      }
      const file = validateProjectPath(requested);
      let content = await manager.project(job, match[2]).readFile(file);
      if (file === 'index.html') {
        const script = '<script defer src="__culture-inspector.js"></script>';
        content = /<\/body\s*>/i.test(content) ? content.replace(/<\/body\s*>/i, script + '</body>') : content + script;
      }
      // The capability is part of the URL directory, so relative CSS/JS/SVG paths keep it.
      send(res, 200, content, { 'Content-Type': mime[path.extname(file)] || 'text/plain', 'Content-Security-Policy': previewCsp, 'Access-Control-Allow-Origin': '*' });
    } catch (error) { send(res, error.status || 400, { error: error.status === 404 ? error.message : 'The preview request could not be completed.' }); }
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;
      if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { status: 'ok' });
      if (req.method === 'GET' && pathname === '/api/status') {
        if (url.searchParams.get('refresh') === '1' && authorized(req, config)) kiro = await inspect(config);
        return send(res, 200, { kiro, qloo: { configured: Boolean(config.qlooKey) }, images: manager.imageStatus(), capture: manager.captureStatus(),
          production: { stages: Boolean(config.productionStages), environment: config.environment || 'local' }, access: { required: Boolean(config.accessToken) },
          protocol: config.creativeProtocol || 'research', model: config.model || kiro.defaultModel, comparisonReady: Boolean(kiro.available && kiro.authenticated && (config.model || kiro.defaultModel) && config.qlooKey), previewOrigin: new URL(previewBaseUrl).origin });
      }
      if (req.method === 'GET' && pathname === '/api/templates') return send(res, 200, templates.map(({ files, ...metadata }) => metadata));
      if (pathname === '/api/workspaces') {
        requireAuth(req, config);
        if (req.method === 'GET') return send(res, 200, workspaces.list());
        if (req.method === 'POST') { checkOrigin(req); try { return send(res, 201, await workspaces.upsert(await readJson(req, 100000))); } catch (error) { throw new HttpError(error.status || 400, error.message); } }
      }
      const workspaceMatch = pathname.match(/^\/api\/workspaces\/([a-f0-9-]{36})(?:\/(export|select))?$/);
      if (workspaceMatch) {
        requireAuth(req, config);
        const workspace = workspaces.get(workspaceMatch[1]);
        const variants = [...manager.jobs.values()].filter(job => job.workspaceId === workspace.id && ['build', 'revise'].includes(job.kind || 'build'))
          .flatMap(job => job.runs.filter(run => run.status === 'completed').map(run => ({ jobId: job.id, mode: run.mode, title: job.selectedDirection?.title || (job.kind === 'revise' ? `Revision ${job.targetSelector}` : workspace.name), audienceId: job.audienceId || null, kind: job.kind || 'build', createdAt: job.createdAt, parentJobId: job.parentJobId || null })))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (req.method === 'GET' && !workspaceMatch[2]) return send(res, 200, { ...workspace, variants });
        if (req.method === 'PUT' && !workspaceMatch[2]) { checkOrigin(req); try { return send(res, 200, await workspaces.upsert(await readJson(req, 100000), workspace.id)); } catch (error) { throw new HttpError(error.status || 400, error.message); } }
        if (req.method === 'POST' && workspaceMatch[2] === 'select') {
          checkOrigin(req); const input = await readJson(req, 1000), job = manager.get(input.jobId);
          if (job.templateId !== workspace.templateId || (job.workspaceId && job.workspaceId !== workspace.id) || !['build', 'revise'].includes(job.kind || 'build') || !job.runs.some(r => r.mode === input.mode && r.status === 'completed')) throw new HttpError(400, 'A completed variant from the same workspace is required.');
          return send(res, 200, await workspaces.select(workspace.id, { jobId: job.id, mode: input.mode }));
        }
        if (req.method === 'GET' && workspaceMatch[2] === 'export') {
          const chosen = workspace.selectedVariant;
          const job = chosen ? manager.get(chosen.jobId) : [...manager.jobs.values()]
            .filter(j => j.workspaceId === workspace.id && j.kind !== 'prepare' && j.runs.some(r => r.status === 'completed'))
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
          const run = job?.runs.find(r => r.mode === chosen?.mode && r.status === 'completed') || job?.runs.find(r => r.status === 'completed');
          const { importedResearch, researchDecisions: authoredResearch, ...snapshotContext } = job?.cultureBrief || workspace.cultureBrief;
          void authoredResearch;
          // A taste pass records many full responses; the snapshot keeps the cited ones within portable brief bounds.
          const records = portableRunRecords({ evidence: run?.evidence || [], decisions: run?.decisions || [], researchDecisions: run?.researchDecisions || [] });
          return send(res, 200, { schemaVersion: '1.0', provenance: 'studio-snapshot', exportedFrom: chosen ? 'selected-variant' : job ? 'latest-completed-work' : 'draft', context: {
            product: { name: workspace.name, templateId: job?.templateId || workspace.templateId, brief: job?.productBrief || job?.brief || workspace.brief }, ...snapshotContext,
            selectedDirection: job?.selectedDirection || undefined, evidence: records.evidence, decisions: records.decisions,
            ...(run?.researchDecisions?.length ? { researchDecisions: run.researchDecisions } : {}),
            ...(run?.webSources?.length ? { webSources: run.webSources.map(({ provenance, reusedFrom, ...record }) => { void provenance; void reusedFrom; return record; }) } : {}),
          }, source: job ? { jobId: job.id, mode: run?.mode, retrievedAt: new Date().toISOString() } : null,
          ...(importedResearch ? { importedResearch } : {}),
          workspaceDraft: { name: workspace.name, templateId: workspace.templateId, brief: workspace.brief, cultureBrief: workspace.cultureBrief },
          interpretation: 'Qloo records are cultural relationships. Design choices are creative interpretation; imported records are unverified until matched to actual server history.' });
        }
      }
      if (req.method === 'POST' && pathname === '/internal/tools') {
        const token = req.headers.authorization?.replace(/^Bearer /i, '');
        const session = manager.bridgeSessions.get(token);
        if (!session) throw new HttpError(403, 'Inactive job bridge.');
        const input = await readJson(req);
        if (typeof input.name !== 'string') throw new HttpError(400, 'Tool name is required.');
        return send(res, 200, await session.handle(input.name, input.arguments || {}));
      }
      if (pathname === '/mcp') {
        requireAuth(req, config);
        if (req.method !== 'POST') return send(res, 405, 'Use POST for stateless Streamable HTTP MCP.', { Allow: 'POST' });
        checkOrigin(req); const message = await readJson(req);
        const result = await dispatchRpc({ message, handler: standaloneHandler, includeProjectTools: false, includeQlooTools: true });
        return result ? send(res, 200, result) : send(res, 202, '');
      }
      if (pathname === '/api/jobs' && req.method === 'POST') {
        requireAuth(req, config); checkOrigin(req);
        const job = await manager.create(await readJson(req, 100000));
        return send(res, 202, { id: job.id });
      }
      // The showcase is public and read-only: its records, and the app run with the preview folder its files play from.
      if (req.method === 'GET' && pathname === '/api/showcase') {
        const record = id => (id ? manager.publicJob(manager.get(id)) : null);
        return send(res, 200, { sites: record(showcase.sites), game: record(showcase.game),
          app: showcase.app ? { id: showcase.app.id, record: showcase.app.record, base: `${previewBaseUrl}/showcase/app/${showcase.app.id}/` } : null });
      }
      const jobMatch = pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})(?:\/(cancel|runs\/(baseline|qloo)\/(download|diff|brief)))?$/);
      if (jobMatch) {
        // A showcased record may be read without the token; changing any job still needs it.
        if (!(req.method === 'GET' && isShowcaseJob(showcase, jobMatch[1]))) requireAuth(req, config);
        const job = manager.get(jobMatch[1]);
        if (req.method === 'GET' && !jobMatch[2]) return send(res, 200, manager.publicJob(job));
        if (req.method === 'POST' && jobMatch[2] === 'cancel') { checkOrigin(req); return send(res, 200, manager.publicJob(await manager.cancel(job.id))); }
        if (req.method === 'GET' && jobMatch[3]) {
          if (job.kind === CHARACTER_KIND) throw new HttpError(404, 'A character pair has no site files; its record plays in the Game character view.');
          const run = job.runs.find(r => r.mode === jobMatch[3]);
          if (!run || run.status !== 'completed') throw new HttpError(404, 'Completed site not found.');
          if (!['build', 'revise'].includes(job.kind || 'build') && jobMatch[4] !== 'brief') throw new HttpError(404, 'Preparation and direction plans are not downloadable sites.');
          if (jobMatch[4] === 'diff') return send(res, 200, run.diff || { files: [] });
          if (jobMatch[4] === 'brief') {
            let context;
            try { context = JSON.parse(await manager.project(job, run.mode).readFile('culture-brief.json')); }
            catch { context = { schemaVersion: '1.0', product: { templateId: job.templateId, brief: job.productBrief || job.brief }, ...(job.cultureBrief || {}), evidence: run.evidence || [], decisions: run.decisions || [], provenance: 'legacy-studio-record' }; }
            return send(res, 200, context);
          }
          const files = await manager.project(job, run.mode).exportFiles();
          // Photos are binary, so the JSON download names the library files the site needs and their licenses.
          const photos = libraryPhotosUsed(await loadLibrary(config.rootDir, job.templateId), files);
          // Generated images exist only in this run, so the download carries them, with the host prompt each came from.
          const generatedImages = await Promise.all((run.generatedImages || []).map(async image => ({ path: image.path, mimeType: image.format === 'png' ? 'image/png' : 'image/jpeg',
            width: image.width, height: image.height, provider: image.provider, prompt: image.prompt, used: image.used ?? null,
            base64: (await fs.readFile(manager.assetPath(job, run.mode, image.path))).toString('base64') })));
          // Fonts, like photos, are named with their repository paths and licences rather than embedded.
          const fonts = fontFilesUsed(await loadFontLibrary(config.rootDir), files);
          return send(res, 200, { jobId: job.id, mode: run.mode, files, ...(photos.length ? { photos,
            photoNote: 'The site shows openly licensed photos from the Studio photo library. Copy each repositoryPath from the Moûsa repository to its path next to these files.' } : {}),
            ...(fonts.length ? { fonts, fontNote: 'The site loads open-licence fonts from the Studio font library. Copy each repositoryPath and its licence file from the Moûsa repository to its path next to these files.' } : {}),
            ...(generatedImages.length ? { generatedImages, generatedNote: 'Generated images are included as base64. Decode each one to its path next to these files.' } : {}) });
        }
      }
      // The Game character view: the fixed world and default brief are public repository content; the pair list is not.
      if (req.method === 'GET' && pathname === '/api/character-defaults') return send(res, 200, await characterDefaults(config.rootDir, manager.browser ? { browser: async () => manager.browser } : {}));
      if (req.method === 'GET' && pathname === '/api/character-jobs') { requireAuth(req, config); return send(res, 200, listCharacterJobs(manager.jobs.values())); }
      // Type specimens for the taste panel: the families and files of the font library the previews serve.
      if (req.method === 'GET' && pathname === '/api/fonts') {
        const fonts = await loadFontLibrary(config.rootDir);
        return send(res, 200, (fonts?.families || []).map(family => ({ family: family.family, category: family.category, files: family.faces.map(face => ({ path: face.path, style: face.style, weight: face.weight })) })));
      }
      const fontMatch = pathname.match(/^\/library\/(fonts\/[a-z0-9][a-z0-9-]{0,80}\.woff2)$/u);
      if (req.method === 'GET' && fontMatch) {
        const face = fontLibraryFile(await loadFontLibrary(config.rootDir), fontMatch[1]);
        if (!face) throw new HttpError(404, 'Font not found.');
        return send(res, 200, await fs.readFile(face.file), { 'Content-Type': 'font/woff2', 'Cache-Control': 'private, max-age=86400' });
      }
      // Thumbnails for the taste panel: the same listed, openly licensed photos the previews serve.
      const libraryMatch = pathname.match(/^\/library\/([a-z][a-z-]{0,40})\/([a-z0-9][a-z0-9-]{0,60}\.jpg)$/u);
      if (req.method === 'GET' && libraryMatch) {
        const photo = libraryPhoto(await loadLibrary(config.rootDir, libraryMatch[1]), libraryMatch[2]);
        if (!photo) throw new HttpError(404, 'Photo not found.');
        return send(res, 200, await fs.readFile(photo.file), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' });
      }
      const templateMatch = pathname.match(/^\/templates\/([a-z-]+)\/(index\.html|styles\.css|app\.js)$/);
      if (req.method === 'GET' && templateMatch) {
        const template = templates.find(t => t.id === templateMatch[1]);
        if (!template) throw new HttpError(404, 'Starter site not found.');
        return send(res, 200, template.files[templateMatch[2]], { 'Content-Type': mime[path.extname(templateMatch[2])], 'Content-Security-Policy': previewCsp });
      }
      if (req.method === 'GET' && ['/', '/index.html', '/app.js', '/game.js', '/showcase.js', '/styles.css', '/brand.css', '/assets/mousa-logo.png'].includes(pathname)) {
        const name = pathname === '/' ? 'index.html' : pathname.slice(1);
        const content = await fs.readFile(path.join(config.rootDir, 'web', name));
        return send(res, 200, content, { 'Content-Type': mime[path.extname(name)], 'Content-Security-Policy': appCsp(new URL(previewBaseUrl).origin) });
      }
      throw new HttpError(404, 'Resource not found.');
    } catch (error) {
      const status = error.status || 500;
      send(res, status, { error: status < 500 ? error.message : redact(error.message || 'The request could not be completed.', config) });
    }
  });
  const listen = (instance, port) => new Promise((resolve, reject) => { instance.once('error', reject); instance.listen(port, config.host, resolve); });
  await listen(previewServer, config.previewPort);
  if (!previewBaseUrl) previewBaseUrl = `http://${config.host === 'localhost' ? '127.0.0.1' : config.host}:${previewServer.address().port}`;
  await listen(server, config.port);
  if (!isLoopback(config.host) && !config.previewBaseUrl) throw new Error('Public preview origin required.');
  const appUrl = `http://${isLoopback(config.host) ? config.host : '127.0.0.1'}:${server.address().port}`;
  if (new URL(previewBaseUrl).origin === new URL(appUrl).origin) throw new Error('Preview must use a different origin from the app.');
  manager.setUrls({ bridgeUrl: `http://127.0.0.1:${server.address().port}`, previewBaseUrl });
  return { server, previewServer, manager, workspaces, appUrl, previewBaseUrl, close: async () => {
    await manager.close();
    const closed = [server, previewServer].map(item => new Promise(resolve => item.close(resolve)));
    // A response its client never read would otherwise hold the server open.
    for (const item of [server, previewServer]) item.closeAllConnections();
    await Promise.all(closed);
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDotEnv();
  (async () => {
    const config = getConfig();
    // Only the running Studio looks for Codex and a browser; tests and scripts that create a Studio get neither unless they pass one.
    // An installed browser counts once it has captured a test page, so a container that cannot run it offers no review.
    const [imageGenerator, browser] = await Promise.all([createImageGenerator(config), inspectBrowser().then(found => verifyBrowser(found))]);
    return createStudio({ config, imageGenerator, browser, siteCapture: createSiteCapture({ browser }) });
  })().then(studio => {
    console.log(`Moûsa Studio: ${studio.appUrl}`);
    console.log(`Static site previews: ${studio.previewBaseUrl}`);
    const images = studio.manager.imageStatus(), capture = studio.manager.captureStatus();
    console.log(images.available ? `Generated images: ${images.provider} ${images.version}` : `Generated images: off (${images.reason})`);
    console.log(capture.available ? `Review captures: ${capture.label}` : `Review captures: off (${capture.reason})`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await studio.close(); process.exit(0); });
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
