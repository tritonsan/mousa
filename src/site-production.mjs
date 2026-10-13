// The Studio's side of the universal protocol's production stages for a taste-led website build: the capability list
// both arms of a build receive, the gates and records of one run's reading, production plan and review, and the
// capture of the run's saved site for the designing model's review, through a loopback server that serves the site as
// its preview does.

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { htmlElementIds } from '../plugin/server/culture/taste.mjs';
import { normalizeCapabilities, PRODUCTION_SCHEMA_VERSION, CAPTURE_LIMITS, HOSTED_IMAGE_REASON } from '../plugin/server/production/capabilities.mjs';
import { mediumProfile } from '../plugin/server/production/media.mjs';
import { normalizeTasteReading, applyReadingToDna } from '../plugin/server/production/reading.mjs';
import { normalizeProductionPlan, generationAllowance } from '../plugin/server/production/plan.mjs';
import { normalizeReview, citedCaptures } from '../plugin/server/production/review.mjs';
import { captureViews, captureName, captureTarget } from '../plugin/server/production/capture.mjs';
import { encodePng } from '../plugin/server/production/image-files.mjs';
import { openedCapturesSettled, auditReviews } from './kiro-session-audit.mjs';
import { isCultureArtifactPath } from './design-artifacts.mjs';
import { validateProjectPath } from './project.mjs';
import { libraryPhoto } from './library.mjs';
import { FONT_FILE_PATH, fontLibraryFile } from './fonts.mjs';
import { GENERATED_IMAGE_PATH } from './image-generator.mjs';

export const SITE_MEDIUM_ID = 'web';
export const CAPABILITIES_FILE = 'culture-capabilities.json';
export const READING_FILE = 'culture-reading.json';
export const PLAN_FILE = 'culture-production.json';
export const REVIEW_FILE = 'culture-review.json';
// Captures land in the run's Kiro working folder, the only folder its read tool may open.
export const REVIEW_DIR = 'review';
// Methods a study may require of both arms: each depends on what the host offers, unlike the methods made in code.
export const REQUIRABLE_SITE_METHODS = Object.freeze(['generated-image', 'library-photo', 'library-font']);
export { HOSTED_IMAGE_REASON };
const SHOWS = { desktop: 'the first screen of the page as a desktop visitor sees it', mobile: 'the first screen of the page as a phone visitor sees it' };
export const SITE_VIEWS = Object.freeze(mediumProfile(SITE_MEDIUM_ID).views.map(view => Object.freeze({ ...view, shows: SHOWS[view.id] || 'the page' })));
const CAPTURES_PER_ROUND = 4;
/** A capture the Studio issued: r<round>-<view>[-<target>][-full], as captureName names it. */
export const CAPTURE_ID = /^r[1-3]-(?:desktop|mobile)(?:-[A-Za-z0-9_-]{1,70})?$/u;
// The preview's own policy. The capture serves the site under the same one, so a capture shows what the preview shows.
export const PREVIEW_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors *; sandbox allow-scripts allow-forms";
const TYPES = Object.freeze({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8' });

const listing = items => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const reply = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const blocked = (message, code = 'TASTE_PHASE_REQUIRED') => ({ content: [{ type: 'text', text: message }], structuredContent: { status: 'blocked', error: { code, message, retryable: false } }, isError: true });

/**
 * The capability list of one taste-led build, identical for both arms: the font and photo libraries, the image
 * generator when the job offers it (never on a hosted server), capture of the saved site when the Studio has a
 * browser, and the methods a study requires of both arms. An unavailable material, generator or capture names its
 * reason, and plans fall back to methods that need none.
 */
export function siteCapabilities({ fonts = null, photos = null, images = null, capture = false, required = [], environment = 'local', reasons = {} } = {}) {
  const off = reason => ({ available: false, reason: String(reason).slice(0, 300) });
  const views = SITE_VIEWS.map(({ id, width, height }) => ({ id, width, height }));
  const licenses = photos?.licenses?.length ? photos.licenses.join(', ').slice(0, 160) : null;
  const generator = images && environment !== 'hosted' ? { available: true, perRun: images.perRun, provider: images.provider || 'codex' }
    : off(environment === 'hosted' ? HOSTED_IMAGE_REASON : reasons.image || 'This Studio was started without image generation.');
  return normalizeCapabilities({
    schemaVersion: PRODUCTION_SCHEMA_VERSION, medium: SITE_MEDIUM_ID, environment,
    materials: {
      fonts: fonts ? { available: true, count: fonts.families, catalog: 'culture-fonts.json', license: 'OFL-1.1' } : off(reasons.fonts || 'This Studio has no font library.'),
      photos: photos ? { available: true, count: photos.photos, catalog: 'culture-library.json', ...(licenses ? { license: licenses } : {}) } : off(reasons.photos || 'This starter has no photo library.'),
    },
    generators: { image: generator },
    review: { capture: capture ? { available: true, views, rounds: CAPTURE_LIMITS.rounds, perRound: CAPTURES_PER_ROUND }
      : off(reasons.capture || 'This Studio was started without a browser to capture the site.') },
    required,
    notes: [
      'The DNA is frozen once the first site file is written or the first picture is requested, and the production plan with it; a DNA saved again before then needs a new plan.',
      ...(generator.available ? ['A picture is generated only for an imagery device whose step chose generated-image, up to the step\'s count; a failed request counts, and the step\'s fallback makes the rest.'] : []),
      ...(capture ? [
        'Captures show index.html as a visitor sees it, in a headless browser that loads the site\'s own files, library photos, fonts and generated pictures and nothing else; scripts run and the page settles first.',
        `${SITE_VIEWS.map(view => `The ${view.id} view (${view.width}x${view.height}) shows ${view.shows}`).join('; ')}. A capture can scroll to an element by its ID (target) or take the whole page height (full).`,
      ] : []),
    ],
  }, { medium: SITE_MEDIUM_ID });
}

/**
 * A read-only loopback server for one run's capture, serving what the run's preview serves, under the preview's own
 * policy: the project's text files, the starter's listed library photos, the font library's files and the generated
 * pictures the run recorded, from its asset folder. Nothing else is reachable.
 */
export async function serveSiteCapture({ project, assets, images = [], library = null, fonts = null }) {
  const recorded = new Map((images || []).filter(image => GENERATED_IMAGE_PATH.test(image?.path || '')).map(image => [image.path, image]));
  const server = http.createServer(async (request, response) => {
    const missing = () => { if (!response.headersSent) response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found'); };
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\/+/u, '') || 'index.html';
      let body, type;
      if (/^library\/[a-z0-9][a-z0-9-]{0,60}\.jpg$/u.test(name)) {
        const photo = libraryPhoto(library, name);
        if (!photo) return missing();
        body = await fs.readFile(photo.file); type = 'image/jpeg';
      } else if (FONT_FILE_PATH.test(name)) {
        const face = fontLibraryFile(fonts, name);
        if (!face) return missing();
        body = await fs.readFile(face.file); type = 'font/woff2';
      } else if (GENERATED_IMAGE_PATH.test(name)) {
        const image = recorded.get(name);
        if (!image) return missing();
        body = await fs.readFile(path.join(assets, ...name.split('/'))); type = image.format === 'png' ? 'image/png' : 'image/jpeg';
      } else {
        const file = validateProjectPath(name);
        body = Buffer.from(await project.readFile(file), 'utf8'); type = TYPES[path.extname(file).toLowerCase()] || 'text/plain; charset=utf-8';
      }
      // A sandboxed page has an opaque origin and loads fonts in CORS mode, as in the preview.
      response.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': PREVIEW_CSP, 'Access-Control-Allow-Origin': '*' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { missing(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

/**
 * The Studio's capture of a run's saved site, or the reason it has none: each view of index.html in a headless browser
 * that can reach only the run's capture server, scrolled to an element by `target` or at its full height, written to
 * `outDir` as <id>.png.
 */
export function createSiteCapture({ browser, env = process.env, capture = captureViews } = {}) {
  if (!browser?.available) return { available: false, reason: browser?.reason || 'No Chromium-based browser was found to capture the site.' };
  return { available: true, label: browser.label || browser.name || 'Chromium',
    async capture({ project, assets, images, library, fonts, views, round, target, full = false, outDir }) {
      const server = await serveSiteCapture({ project, assets, images, library, fonts });
      try { return await capture({ browser, baseUrl: server.url, entry: 'index.html', views, target, full, outDir, prefix: `r${round}`, env }); }
      finally { await server.close(); }
    } };
}

/** The tests' stand-in for the browser: a flat PNG at each view's size, named as a real capture names it. */
export function fixtureSiteCapture({ color = [22, 29, 45, 255], label = 'Fixture capture', onCapture } = {}) {
  return { available: true, label, async capture(request) {
    await onCapture?.(request);
    const { views, round, target, full = false, outDir } = request;
    await fs.mkdir(outDir, { recursive: true });
    const shots = [];
    for (const view of views) {
      const id = captureName({ prefix: `r${round}`, view, target, full });
      const png = encodePng(view.width, view.height, Buffer.alloc(view.width * view.height * 4, Buffer.from(color)));
      const file = path.join(outDir, `${id}.png`);
      await fs.writeFile(file, png);
      shots.push({ id, view: view.id, ...(target ? { target } : {}), ...(full ? { full: true } : {}), width: view.width, height: view.height, bytes: png.length, file });
    }
    return shots;
  } };
}

/** A run's production record before its first tool call. */
export const newRunProduction = () => ({ reading: null, plan: null, captures: [], reviews: [], round: 1, audit: null });

/**
 * One run's production stages, for the Studio's taste-led build. The host's write tool calls in at each point of its
 * sequence: `stage` and `commit` for the reading, the plan and the review; `gateDna`, `bindDna` and `afterDna` around
 * the DNA; `gateSite` and `siteWritten` for site files; `gateImage` and `imageRequested` for pictures; `checked` after
 * each conformance check; `capture` for the review's captures; and `finish` once the run has ended. Everything it
 * learns is kept in `production`, the run's record from newRunProduction. `context` gives it the run's live state:
 * `input()` and `dna()`, the job's `event` and `save`, `hostWait()` (time the model is not charged for),
 * `imagesInProgress()` and `sources()`, what the capture server serves besides the project files.
 */
export function createSiteProduction({ capabilities, production, pipeline, project, directory, capture = null, input, dna, event, save, hostWait, imagesInProgress = () => 0, sources = () => ({}), now = () => new Date() }) {
  const review = capabilities.review.capture;
  const rounds = review.available && capture?.available ? review.rounds : 0;
  const views = rounds ? review.views : [];
  const home = path.join(directory, 'kiro-home');
  const imageRequests = new Map();
  let siteVersion = 0, checkedVersion = -1;

  /** A fingerprint of the site files alone, so a review can tell whether a later save changed the site. */
  const siteFingerprint = async () => {
    const files = Object.entries(await project.exportFiles()).filter(([file]) => !isCultureArtifactPath(file)).sort(([a], [b]) => a.localeCompare(b));
    return crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
  };
  const plannedImages = () => Object.keys(production.plan?.uses?.generators?.image?.devices || {});

  /** Checks a reading, plan or review before it is written: {blocked}, {invalid} or {staged}. */
  async function stage(file, content) {
    if (file === READING_FILE) {
      if (!input() || !pipeline.revealedAt) return { blocked: 'Save culture-assumption.json and read project_get_taste before saving your reading of the taste input.' };
      if (dna()) return { blocked: `${READING_FILE} is frozen: the Design DNA was compiled from it.` };
      try { return { staged: normalizeTasteReading(content, { input: input(), medium: SITE_MEDIUM_ID }) }; } catch (error) { return { invalid: error }; }
    }
    if (file === PLAN_FILE) {
      if (!dna()) return { blocked: 'Save a valid culture-dna.json before the production plan: the plan names how each of its devices is made.' };
      if (pipeline.constructionStartedAt) return { blocked: `${PLAN_FILE} is frozen once the first site file is written or the first picture is requested.` };
      try { return { staged: normalizeProductionPlan(content, { dna: dna(), reading: production.reading, capabilities }) }; } catch (error) { return { invalid: error }; }
    }
    if (file === REVIEW_FILE) {
      if (!production.plan) return { blocked: `Save ${PLAN_FILE} first: the review judges the criteria your plan lists.` };
      if (!rounds) return { blocked: 'This run captures nothing to review.', code: 'TOOL_UNKNOWN' };
      if (production.round > rounds) return { blocked: `The review is complete: all ${rounds} rounds were reviewed.` };
      const round = production.round, current = production.captures.filter(item => item.round === round);
      if (!current.length) return { blocked: `Capture the site with project_capture_review before saving the review of round ${round}.` };
      // A host that records the Kiro session confirms which captures were opened; a scripted session cannot.
      const opened = await openedCapturesSettled({ home, captures: production.captures, expected: citedCaptures(content) });
      try {
        const judged = normalizeReview(content, { plan: production.plan, captures: production.captures.map(({ id, round: taken, path: shot }) => ({ id, round: taken, path: shot })), opened, round, rounds });
        return { staged: { review: judged, opened, current } };
      } catch (error) { return { invalid: error }; }
    }
    return { blocked: `${file} is not a production artifact.` };
  }

  /** Records a written reading, plan or review; returns what the write tool's reply adds, with the next step. */
  async function commit(file, staged) {
    const at = now().toISOString();
    if (file === READING_FILE) {
      production.reading = staged;
      Object.assign(pipeline, { readAt: at, status: 'read' });
      event('taste', `Taste reading saved: ${staged.clusters.length} clusters over ${staged.stats.refs} refs (${staged.clusters.map(cluster => cluster.name).join('; ')})${staged.setAside.length ? `; ${staged.setAside.length} set aside` : ''}.`);
      return { clusters: staged.clusters.length, setAside: staged.setAside.length,
        next: 'Compile culture-dna.json from the refs your reading kept: anchor each device to at least one ref a cluster gathers, and none to a ref you set aside.' };
    }
    if (file === PLAN_FILE) {
      production.plan = staged;
      Object.assign(pipeline, { plannedAt: at, status: 'planned' });
      const generated = Object.entries(staged.uses.generators).map(([generator, use]) => `${use.total} ${generator} for ${Object.keys(use.devices).join(', ')}`);
      event('taste', `Production plan saved: ${staged.steps.length} steps with ${listing(staged.uses.methods)}${generated.length ? `; ${generated.join('; ')}` : '; no generator'}; ${staged.review.length} review criteria.`);
      const planned = plannedImages();
      return { steps: staged.steps.length, methods: staged.uses.methods, criteria: staged.review.length,
        next: planned.length ? `Request the planned pictures for ${listing(planned)} with project_generate_image, then build the site around them.` : 'Build the site to the DNA, each device by the method its step names.' };
    }
    const { review: judged, opened, current } = staged;
    const round = judged.round;
    production.reviews.push({ ...judged, savedAt: at, opened: opened ? current.filter(item => opened.has(item.id)).map(item => item.id) : null, after: { site: await siteFingerprint() } });
    production.round++;
    Object.assign(pipeline, { reviewedAt: at, status: 'reviewed' });
    const { met, partly, missed } = judged.stats;
    event('review', `Review of round ${round}: ${met} met, ${partly} partly, ${missed} missed${opened ? '; every capture it cites was opened in the session' : '; the session record could not be audited'}.`);
    const open = partly + missed;
    return { round, met, partly, missed,
      next: !open ? 'Every criterion is met. Finish, keeping the DNA and the plan as they are.'
        : round < rounds ? `Make the repairs you named in the site files, check them with project_check_dna, then capture round ${round + 1} with project_capture_review and review it.` : 'Make the repairs you named in the site files and check them with project_check_dna; this was the last review round.' };
  }

  /** Why the DNA cannot be saved yet, or null. */
  const gateDna = () => production.reading ? null : `Save ${READING_FILE} first: the DNA anchors to the refs your reading of the taste input keeps.`;
  /** The DNA source as the reading binds it; set-aside anchors are refused, and set-aside required anchors count as rejected. */
  const bindDna = content => applyReadingToDna(content, production.reading);
  /** A plan describes the DNA it was made for, so a DNA saved again sets the plan aside. */
  async function afterDna() {
    if (!production.plan) return;
    production.plan = null;
    await fs.rm(path.join(project.directory, PLAN_FILE), { force: true });
    event('taste', 'The production plan was for the earlier DNA; it was set aside and must be saved again.');
  }

  /** Why a site file cannot be written yet, or null. `attempts` counts this run's picture requests. */
  function gateSite({ images = false, attempts = 0 } = {}) {
    if (!production.plan) return `Save ${PLAN_FILE} before writing site files: plan how each device is made before you build it.`;
    const planned = plannedImages();
    if (planned.length && images && !attempts) return `Your production plan generates pictures for ${listing(planned)}: request them with project_generate_image before writing site files, then build the site around the pictures it returns.`;
    return null;
  }
  const siteWritten = () => { siteVersion++; };

  /** Why a picture cannot be requested for `device`, or null: only the plan's generated-image steps, up to their count. */
  function gateImage(device) {
    if (!production.plan) return `Save ${PLAN_FILE} first: a picture is requested only for a device whose step chose generated-image.`;
    const allowance = generationAllowance(production.plan, 'image', device, imageRequests.get(device) || 0);
    return allowance.allowed ? null : allowance.limit ? `${allowance.reason} Make the rest with the step's fallback method.` : allowance.reason;
  }
  const imageRequested = device => { imageRequests.set(device, (imageRequests.get(device) || 0) + 1); };

  /** A conformance check of the current site files; the report names the next review round while rounds remain. */
  function checked(report) {
    checkedVersion = siteVersion;
    if (rounds && production.plan && production.round <= rounds) report.review = `Once your repairs are done, capture round ${production.round} of ${rounds} with project_capture_review and judge your plan's criteria in ${REVIEW_FILE}.`;
    return report;
  }

  /** project_capture_review: capture the checked site for this round's review. */
  async function captureReview(args) {
    if (!rounds) return blocked('Capture is not available in this run.', 'TOOL_UNKNOWN');
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['views', 'target', 'full'].includes(key))) return blocked('project_capture_review accepts views, target and full only.', 'TOOL_INPUT_INVALID');
    if (!production.plan) return blocked(`Save ${PLAN_FILE} first: the review judges the criteria your plan lists.`);
    if (!siteVersion) return blocked('Write the site files and check them with project_check_dna before capturing the site.');
    if (checkedVersion !== siteVersion) return blocked('Check the saved site with project_check_dna first, so the captures show the files its last check measured.');
    if (imagesInProgress()) return blocked('A picture is still being generated; capture the site once it is done.');
    const round = production.round;
    if (round > rounds) return blocked(`The review allows ${rounds} rounds, and all of them were reviewed.`, 'TOOL_INPUT_INVALID');
    const ids = views.map(view => view.id);
    if (args.views !== undefined && (!Array.isArray(args.views) || !args.views.length || args.views.some(id => !ids.includes(id)))) return blocked(`views: name one or more of ${ids.join(', ')}.`, 'TOOL_INPUT_INVALID');
    if (args.full !== undefined && typeof args.full !== 'boolean') return blocked('full: use true or false.', 'TOOL_INPUT_INVALID');
    if (args.target !== undefined) {
      if (!captureTarget(args.target)) return blocked('target: give the ID of an element of index.html, such as a section ID.', 'TOOL_INPUT_INVALID');
      const known = htmlElementIds(await project.readFile('index.html').catch(() => ''));
      if (!known.includes(args.target)) return blocked(`target: index.html has no element with the ID ${args.target}. Its IDs include ${known.slice(0, 12).join(', ') || 'none'}.`, 'TOOL_INPUT_INVALID');
    }
    const full = args.full === true;
    const wanted = args.views === undefined ? views : views.filter(view => args.views.includes(view.id));
    const shots = wanted.map(view => captureName({ prefix: `r${round}`, view, target: args.target, full }));
    const taken = production.captures.filter(item => item.round === round);
    const repeated = shots.filter(id => taken.some(item => item.id === id));
    if (repeated.length) return blocked(`Round ${round} already has ${listing(repeated)}. Review this round in ${REVIEW_FILE}; after your repairs, capture round ${round + 1}.`, 'TOOL_INPUT_INVALID');
    if (taken.length + shots.length > review.perRound) return blocked(`Round ${round} allows ${review.perRound} captures, and ${taken.length} were taken.`, 'TOOL_INPUT_INVALID');
    const site = await siteFingerprint();
    // The previous round's review named repairs; what changed since is recorded beside it.
    const last = production.reviews.at(-1);
    if (last && !last.repairs) last.repairs = { site: last.after.site !== site };
    event('review', `Capturing round ${round}: ${listing(shots)}.`);
    await save();
    let made;
    const wait = hostWait();
    wait.pause();
    try { made = await capture.capture({ ...sources(), project, views: wanted, round, ...(args.target ? { target: args.target } : {}), full, outDir: path.join(directory, REVIEW_DIR) }); }
    catch (error) {
      const message = String(error?.message || 'The site could not be captured.').slice(0, 300);
      event('warning', `Capture failed: ${message}`);
      await save();
      return { content: [{ type: 'text', text: `The site could not be captured: ${message} Call project_capture_review again, or finish without a review if it fails again.` }],
        structuredContent: { status: 'error', error: { code: 'CAPTURE_FAILED', message, retryable: true } }, isError: true };
    } finally { wait.resume(); }
    const issued = made.filter(shot => CAPTURE_ID.test(shot.id || '') && shots.includes(shot.id)).map(shot => ({ id: shot.id, view: shot.view, round, path: `${REVIEW_DIR}/${shot.id}.png`,
      width: shot.width, height: shot.height, bytes: shot.bytes, ...(shot.target ? { target: shot.target } : {}), ...(shot.full ? { full: true } : {}), capturedAt: now().toISOString(), site }));
    if (!issued.length) { event('warning', 'Capture returned no usable picture.'); await save(); return blocked('The capture returned no picture. Call project_capture_review again.', 'CAPTURE_FAILED'); }
    production.captures.push(...issued);
    event('review', `Captured ${issued.map(item => item.id).join(', ')}.`);
    await save();
    return reply({ status: 'captured', round, rounds,
      captures: issued.map(({ id, view, path: shot, width, height, target, full: whole }) => ({ id, view, path: shot, width, height, ...(target ? { target } : {}), ...(whole ? { full: true } : {}),
        shows: whole ? `the whole page at ${width} pixels wide` : target ? `the page scrolled to #${target} at ${width}x${height}` : SITE_VIEWS.find(item => item.id === view)?.shows })),
      next: `Open each capture you cite with your read tool (the paths are relative to your working folder, such as ${issued[0].path}), judge every review criterion of ${PLAN_FILE} against what the captures show, and save ${REVIEW_FILE} for round ${round}: {schemaVersion:'1.0',round:${round},criteria:[{id,capture:'${issued[0].id}',verdict:'met'|'partly'|'missed',observed,repair}],summary}.` });
  }

  /** After the run: the audit of its reviews, and a limitation when it captured or reviewed nothing it could. */
  async function finish() {
    const site = await siteFingerprint();
    production.audit = await auditReviews({ home, reviews: production.reviews, captures: production.captures, changed: item => ({ site: item.after?.site !== site }) });
    if (rounds && production.plan && !production.reviews.length) {
      const note = production.captures.length ? 'The site was captured, but no review of the captures was saved.' : 'The run ended without reviewing captures of the site.';
      if (!pipeline.limitations.includes(note)) pipeline.limitations.push(note);
      event('warning', note);
    }
    return production.audit;
  }

  /** What culture-taste.json keeps of the production stages. */
  const record = () => ({ medium: SITE_MEDIUM_ID, required: capabilities.required, reading: production.reading, plan: production.plan,
    reviews: production.reviews.map(({ after, ...item }) => { void after; return item; }),
    captures: production.captures.map(({ id, view, round, path: shot, width, height, target, full }) => ({ id, view, round, path: shot, width, height, ...(target ? { target } : {}), ...(full ? { full } : {}) })),
    ...(production.audit ? { audit: production.audit } : {}) });

  return { rounds, stage, commit, gateDna, bindDna, afterDna, gateSite, siteWritten, gateImage, imageRequested, checked, capture: captureReview, finish, record, plannedImages };
}
