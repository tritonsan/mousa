// The production tools of a standalone plugin session: what this machine can make, the reading, plan and review
// validators, the font library, image generation and capture. A Studio or game bridge offers its own project tools
// instead, so these run only where the plugin is the host. File tools read and write inside MOUSA_PROJECT_DIR only.

import fs from 'node:fs/promises';
import path from 'node:path';
import { TasteProtocolError, normalizeTasteName } from '../culture/taste.mjs';
import { mediumProfile, listMedia, describeMedium } from './media.mjs';
import { normalizeCapabilities, standaloneCapabilities, CAPTURE_LIMITS } from './capabilities.mjs';
import { normalizeTasteReading } from './reading.mjs';
import { normalizeProductionPlan, generationAllowance } from './plan.mjs';
import { normalizeReview } from './review.mjs';
import { inspectBrowser, verifyBrowser, serveDirectory, captureViews } from './capture.mjs';
import { inspectCodex, createCodexImageGenerator, buildImagePrompt, IMAGE_ASPECTS, ImageRequestError } from './images.mjs';
import { loadFontLibrary, fontLibraryRoot } from './fonts.mjs';
import { ProjectScopeError, projectRoot, resolveInProject, relativePath, readState, writeState, STATE_DIR } from './project-files.mjs';

export const MEDIUM_IDS = Object.freeze(listMedia().map(medium => medium.id));
const MEDIUM = { type: 'string', enum: MEDIUM_IDS, description: 'The medium: web (a website), app-ui (an app interface with a design token file) or generic (any text project). Defaults to web.' };
const ARTIFACT = (maxProperties, description) => ({ type: 'object', maxProperties, additionalProperties: true, ...(description ? { description } : {}) });
const TASTE_INPUT = ARTIFACT(12, 'The tasteInput object returned by qloo_taste_profile, or an equivalent host record.');
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITES = openWorldHint => ({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint });

export const PRODUCTION_TOOLS = Object.freeze([
  {
    name: 'culture_list_capabilities',
    description: 'Production stage 0. List what this session can make for a medium: the font library, whether images can be generated here (only on a machine with Codex installed and signed in, never on a hosted server), whether the result can be captured for review, each production method for each DNA layer with the reason any is unavailable, and the layers a taste reading must carry. Plan only with available methods.',
    inputSchema: { type: 'object', properties: { medium: MEDIUM }, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: 'culture_validate_reading',
    description: 'Production stage 1, after the taste input and before the DNA. Validate a taste reading: {schemaVersion:"1.0", clusters:[2-4 {id, name, refs:[2-8 refs, one a quality], layers:[1-4], reading}], setAside:[{ref, reason}], approach}. Each cluster rests on a quality (a measured one in a measured run), every required anchor is clustered or set aside (at most two set aside), at least one cluster gathers a surprise when there are surprises, and the clusters carry the medium\'s required layers. Pass the valid reading to culture_validate_design_dna.',
    inputSchema: { type: 'object', properties: { reading: ARTIFACT(10), tasteInput: TASTE_INPUT, medium: MEDIUM }, required: ['reading', 'tasteInput'], additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: 'culture_validate_production_plan',
    description: 'Production stage 2, after the DNA and before any material, image or build. Validate a production plan: {schemaVersion:"1.0", steps:[one per device {device, method, cluster, why, count?, fallback?}], review:[2-6 {id, device, look, view?}]}. Each method must be available here and make the device\'s layer, the cluster must hold one of the device\'s anchors, a generator step states a count within the limit and a fallback that needs no generator, and every cluster is realized. Without capabilities it checks against this session\'s own list.',
    inputSchema: { type: 'object', properties: { plan: ARTIFACT(4), dna: ARTIFACT(10, 'The Design DNA, as saved or as culture_validate_design_dna returned it.'), reading: ARTIFACT(10), tasteInput: TASTE_INPUT, medium: MEDIUM,
      capabilities: ARTIFACT(10, 'Optional host capability list; defaults to this session\'s.') }, required: ['plan', 'dna', 'reading', 'tasteInput'], additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: 'culture_find_materials',
    description: 'Search the open-licence (SIL OFL 1.1) font library this plugin carries, by words for the character you want, such as condensed, warm, editorial or typewriter. Returns every family ranked by how many words its category and character share, with weights and the system fonts it stands in for. Pass forDna as fonts to culture_validate_design_dna so typography names only these families.',
    inputSchema: { type: 'object', properties: {
      kind: { type: 'string', enum: ['fonts'] },
      words: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 2, maxLength: 40 } },
    }, required: ['kind'], additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: 'culture_fetch_materials',
    description: 'Copy planned font families from the library into the project, with their licence files, and return the @font-face rules to paste into your CSS (paths relative to the project root). Writes only inside MOUSA_PROJECT_DIR, into directory (default fonts). With the validated plan, only families its library-font steps declare are fetched.',
    inputSchema: { type: 'object', properties: {
      fonts: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 60 } },
      directory: { type: 'string', minLength: 1, maxLength: 80 },
      plan: ARTIFACT(8, 'The plan as culture_validate_production_plan returned it.'),
    }, required: ['fonts'], additionalProperties: false },
    annotations: WRITES(false),
  },
  {
    name: 'culture_generate_image',
    description: 'Generate one original picture for an imagery device of your DNA, where this machine can (Codex installed and signed in; never on a hosted server). Give the device ID and one sentence of what the picture shows, without naming taste entities; the plugin writes the prompt from the device\'s name, colors and qualities. It takes about a minute and saves the picture inside MOUSA_PROJECT_DIR, in directory (default generated). With the validated plan, only devices whose steps chose generated-image may request, up to their count. When generation is unavailable, use the step\'s fallback method.',
    inputSchema: { type: 'object', properties: {
      dna: ARTIFACT(10), device: { type: 'string', minLength: 1, maxLength: 40 }, subject: { type: 'string', minLength: 10, maxLength: 240 },
      aspect: { type: 'string', enum: Object.keys(IMAGE_ASPECTS) }, plan: ARTIFACT(8), tasteInput: TASTE_INPUT, directory: { type: 'string', minLength: 1, maxLength: 80 },
    }, required: ['dna', 'device', 'subject'], additionalProperties: false },
    annotations: WRITES(true),
  },
  {
    name: 'culture_capture',
    description: 'Production stage 4. Render a page of the project in a headless browser at each view of the medium (for the web: desktop 1440x900 and mobile 390x844) and save PNG captures under .mousa/captures/ inside MOUSA_PROJECT_DIR. target scrolls to an element ID or route (the URL fragment); full captures the whole page height. The browser can reach only the project. Open every capture you cite with your own image-reading tool, then judge the plan\'s criteria in culture_validate_review.',
    inputSchema: { type: 'object', properties: {
      entry: { type: 'string', minLength: 1, maxLength: 120, description: 'The page to open, relative to the project root. Defaults to index.html.' },
      views: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 30 } },
      target: { type: 'string', minLength: 1, maxLength: 60 }, full: { type: 'boolean' },
      round: { type: 'integer', minimum: 1, maximum: CAPTURE_LIMITS.maxRounds }, medium: MEDIUM,
    }, additionalProperties: false },
    annotations: WRITES(false),
  },
  {
    name: 'culture_validate_review',
    description: 'Production stage 4, after capture. Validate your review of the captures against the plan\'s criteria: {schemaVersion:"1.0", round, criteria:[{id, capture, verdict:"met"|"partly"|"missed", observed, repair?}], summary}. Every criterion is judged on a capture this session made in that round; partly and missed name the repair you made. This session cannot confirm which captures you opened, so cite only captures you opened.',
    inputSchema: { type: 'object', properties: { review: ARTIFACT(4), plan: ARTIFACT(8, 'The plan as culture_validate_production_plan returned it.') }, required: ['review', 'plan'], additionalProperties: false },
    annotations: READ_ONLY,
  },
]);
export const PRODUCTION_TOOL_NAMES = Object.freeze(PRODUCTION_TOOLS.map(tool => tool.name));

/** A tool failure with a code the agent can act on. */
export class ProductionToolError extends Error {
  constructor(code, message, retryable = false) { super(message); this.name = 'ProductionToolError'; this.code = code; this.retryable = retryable; }
}

const stemMatch = (word, value) => {
  const a = normalizeTasteName(word), b = normalizeTasteName(value);
  return Boolean(a && b) && (b.split(' ').includes(a) || (a.length >= 5 && b.split(' ').some(part => part.length >= 5 && part.slice(0, 5) === a.slice(0, 5))));
};

/** The devices a plan needs: IDs, layers and anchors from the DNA as given, tokens as the medium checks them. */
function planDna(raw, profile) {
  if (typeof profile.dnaForCheck !== 'function') throw new TasteProtocolError('medium', `The ${profile.label.toLowerCase()} medium has no standalone DNA check.`);
  const checked = profile.dnaForCheck(raw);
  const source = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return { devices: checked.devices.map((device, index) => ({ ...device, anchors: (Array.isArray(source.devices?.[index]?.anchors) ? source.devices[index].anchors : []).filter(ref => typeof ref === 'string').map(ref => ref.trim()) })) };
}
const planArgument = value => {
  if (!value || !Array.isArray(value.steps) || !Array.isArray(value.review) || !value.uses) throw new TasteProtocolError('plan', 'Pass the plan as culture_validate_production_plan returned it.');
  return value;
};

/**
 * The handler for the production tools. `inspect.image` and `inspect.browser` replace the machine checks, `generate`
 * the Codex generator and `capture` the browser, so tests and other hosts can run the same tools without them.
 */
export function createProductionTools({ env = process.env, inspect = {}, generate, capture } = {}) {
  let images = null, fonts = null;
  const environment = env.MOUSA_ENVIRONMENT === 'hosted' ? 'hosted' : 'local';
  const perRun = Math.min(8, Math.max(1, Number.parseInt(env.MOUSA_IMAGES_PER_RUN, 10) || 4));
  const imageStatus = () => images ||= (environment === 'hosted' ? Promise.resolve({ available: false, reason: 'A hosted server has no image generator.' })
    : (inspect.image ? inspect.image() : inspectCodex({ config: { codexImages: env.CODEX_IMAGES, codexCliPath: env.CODEX_CLI_PATH }, env })).catch(() => ({ available: false, reason: 'Image generation could not be checked on this machine.' })));
  // An installed browser counts once a test page was captured with it (checked once per process).
  const browserStatus = () => (inspect.browser ? inspect.browser() : inspectBrowser({ env }).then(found => verifyBrowser(found, { env }))).catch(() => ({ available: false, reason: 'The browser could not be checked on this machine.' }));
  const fontLibrary = () => fonts ||= fontLibraryRoot({ env }).then(root => root ? loadFontLibrary(root) : null).catch(() => null);
  const capabilitiesFor = async medium => standaloneCapabilities({ medium, environment, fonts: await fontLibrary(), image: await imageStatus(), browser: await browserStatus(), imagesPerRun: perRun });

  async function handle(name, args) {
    if (name === 'culture_list_capabilities') {
      const profile = mediumProfile(args.medium ?? 'web');
      const capabilities = await capabilitiesFor(profile.id);
      return { status: 'listed', capabilities, medium: describeMedium(profile), media: MEDIUM_IDS,
        usage: 'Choose each device\'s method from the available methods for its layer. Unavailable methods name their reason; a generator step needs a fallback that needs no generator.' };
    }
    if (name === 'culture_validate_reading') {
      const reading = normalizeTasteReading(args.reading, { input: tasteInput(args.tasteInput), medium: args.medium ?? 'web' });
      return { status: 'valid', reading, next: 'Compile the Design DNA from the refs you kept and validate it with culture_validate_design_dna, passing this reading.' };
    }
    if (name === 'culture_validate_production_plan') {
      const profile = mediumProfile(args.medium ?? 'web'), input = tasteInput(args.tasteInput);
      const reading = normalizeTasteReading(args.reading, { input, medium: profile.id });
      const capabilities = args.capabilities === undefined ? await capabilitiesFor(profile.id) : normalizeCapabilities(args.capabilities, { medium: profile.id });
      const plan = normalizeProductionPlan(args.plan, { dna: planDna(args.dna, profile), reading, capabilities });
      return { status: 'valid', plan, next: 'Fetch only the planned materials, request only the planned pictures, then build to the DNA and check conformance.' };
    }
    if (name === 'culture_find_materials') {
      const library = await fontLibrary();
      if (!library) throw new ProductionToolError('MATERIALS_UNAVAILABLE', 'The plugin font library was not found. Set MOUSA_LIBRARY_ROOT to the folder that holds library/fonts.');
      const words = (args.words || []).map(word => word.trim()).filter(Boolean);
      const ranked = library.families.map((family, index) => ({ family, index, matches: words.filter(word => [family.category, ...family.character, family.family].some(value => stemMatch(word, value))) }))
        .sort((a, b) => b.matches.length - a.matches.length || a.index - b.index);
      return { status: 'found', kind: 'fonts', license: 'OFL-1.1',
        families: ranked.map(({ family, matches }) => ({ family: family.family, category: family.category, character: [...family.character], ...(family.similarTo.length ? { similarTo: [...family.similarTo] } : {}),
          weights: [...new Set(family.faces.map(face => face.weight.replace(' ', '-')))].join(', '), italic: family.faces.some(face => face.style === 'italic'), ...(words.length ? { matches } : {}) })),
        forDna: library.families.map(family => ({ family: family.family, files: family.faces.map(face => face.path), similarTo: [...family.similarTo] })),
        usage: 'Category and character describe each typeface; they are not taste data. Fetch the families your plan uses with culture_fetch_materials.' };
    }
    if (name === 'culture_fetch_materials') {
      const library = await fontLibrary();
      if (!library) throw new ProductionToolError('MATERIALS_UNAVAILABLE', 'The plugin font library was not found. Set MOUSA_LIBRARY_ROOT to the folder that holds library/fonts.');
      const root = await projectRoot(env), directory = relativePath(args.directory ?? 'fonts', { name: 'directory' });
      const planned = args.plan === undefined ? null : planArgument(args.plan).uses.materials?.fonts || [];
      const chosen = [...new Set(args.fonts.map(name => name.trim()))].map(name => {
        const family = library.families.find(item => normalizeTasteName(item.family) === normalizeTasteName(name));
        if (!family) throw new ProductionToolError('MATERIAL_UNKNOWN', `${name} is not in the font library. Use culture_find_materials to list its families.`);
        if (planned && !planned.some(item => normalizeTasteName(item) === normalizeTasteName(family.family))) throw new ProductionToolError('MATERIAL_NOT_PLANNED', `The plan fetches no ${family.family}; its library-font steps declare ${planned.join(', ') || 'no family'}.`);
        return family;
      });
      const { file: folder } = await resolveInProject(root, directory);
      await fs.mkdir(folder, { recursive: true });
      const result = [];
      for (const family of chosen) {
        const files = [];
        for (const face of family.faces) {
          await fs.copyFile(face.file, path.join(folder, path.basename(face.file)));
          files.push({ path: `${directory}/${path.basename(face.file)}`, style: face.style, weight: face.weight });
        }
        const licenseFile = path.basename(family.licenseRepositoryPath);
        await fs.copyFile(path.join(path.dirname(family.faces[0].file), licenseFile), path.join(folder, licenseFile));
        result.push({ family: family.family, files, license: family.license, licenseFile: `${directory}/${licenseFile}`, ...(family.copyright ? { copyright: family.copyright } : {}) });
      }
      return { status: 'fetched', directory, families: result,
        fontFace: result.flatMap(family => family.files.map(face => `@font-face{font-family:'${family.family}';src:url('${face.path}') format('woff2');font-weight:${face.weight};font-style:${face.style};font-display:swap}`)),
        forDna: result.map(family => ({ family: family.family, files: family.files.map(face => face.path), similarTo: [...(chosen.find(item => item.family === family.family).similarTo)] })),
        usage: 'Paste the fontFace rules into your stylesheet with paths as seen from it, and keep the licence files with the fonts.' };
    }
    if (name === 'culture_generate_image') {
      const status = await imageStatus();
      if (!status.available) throw new ProductionToolError('IMAGES_UNAVAILABLE', `Images cannot be generated here: ${status.reason} Use the step's fallback method.`);
      const root = await projectRoot(env), directory = relativePath(args.directory ?? 'generated', { name: 'directory' });
      const records = (await readState(root, 'images'))?.images || [];
      if (records.length >= perRun) throw new ProductionToolError('IMAGES_EXHAUSTED', `This session already generated ${records.length} pictures, the limit of ${perRun}. Use the step's fallback method for the rest.`);
      const used = records.filter(record => record.device === args.device).length;
      if (args.plan !== undefined) {
        const allowance = generationAllowance(planArgument(args.plan), 'image', args.device, used);
        if (!allowance.allowed) throw new ProductionToolError('IMAGE_NOT_PLANNED', allowance.reason);
      }
      const names = Array.isArray(args.tasteInput?.entities) ? args.tasteInput.entities.map(entity => entity?.name).filter(value => typeof value === 'string') : [];
      const request = buildImagePrompt({ dna: args.dna, names, device: args.device, subject: args.subject, aspect: args.aspect ?? 'landscape' });
      const file = `${request.device.toLowerCase().replace(/[^a-z0-9_-]/gu, '-')}-${used + 1}`;
      const work = await resolveInProject(root, `${STATE_DIR}/images`, { state: true });
      const generator = generate ? { generate } : createCodexImageGenerator({ codex: status, env });
      let made;
      try { made = await generator.generate({ prompt: request.prompt, directory: work.file, name: file }); }
      catch (error) { throw new ProductionToolError('IMAGE_GENERATION_FAILED', `${String(error?.message || 'The picture could not be generated.').slice(0, 300)} Use the step's fallback method if it fails again.`, true); }
      const target = await resolveInProject(root, `${directory}/${path.basename(made.path)}`);
      await fs.mkdir(path.dirname(target.file), { recursive: true });
      await fs.rename(path.join(work.file, path.basename(made.path)), target.file);
      const record = { device: request.device, subject: request.subject, aspect: request.aspect, prompt: request.prompt, path: target.relative, width: made.width, height: made.height, createdAt: new Date().toISOString() };
      await writeState(root, 'images', { images: [...records, record] });
      return { status: 'generated', device: request.device, path: target.relative, format: made.format, width: made.width, height: made.height, bytes: made.bytes,
        description: made.description, ...(made.palette ? { palette: made.palette } : {}), remaining: perRun - records.length - 1,
        usage: 'Use the picture in the device it was made for, by its path relative to the page that shows it.' };
    }
    if (name === 'culture_capture') {
      const profile = mediumProfile(args.medium ?? 'web');
      const browser = await browserStatus();
      if (!browser.available) throw new ProductionToolError('CAPTURE_UNAVAILABLE', `The result cannot be captured here: ${browser.reason}`);
      const root = await projectRoot(env), entry = relativePath(args.entry ?? profile.entry ?? 'index.html', { name: 'entry' });
      if (!/\.html?$/iu.test(entry)) throw new ProductionToolError('CAPTURE_INVALID', 'entry: name an HTML page of the project.');
      const views = args.views === undefined ? profile.views : args.views.map(id => profile.views.find(view => view.id === id) || (() => { throw new ProductionToolError('CAPTURE_INVALID', `views: use views of the ${profile.label.toLowerCase()} medium: ${profile.views.map(view => view.id).join(', ')}.`); })());
      const state = (await readState(root, 'captures')) || { captures: [] };
      const round = args.round ?? Math.max(1, ...state.captures.map(item => item.round || 1));
      if (round > CAPTURE_LIMITS.rounds) throw new ProductionToolError('CAPTURE_ROUNDS_EXHAUSTED', `The review allows ${CAPTURE_LIMITS.rounds} rounds.`);
      const taken = state.captures.filter(item => item.round === round).length;
      if (taken + views.length > CAPTURE_LIMITS.perRound) throw new ProductionToolError('CAPTURE_LIMIT', `Round ${round} allows ${CAPTURE_LIMITS.perRound} captures and ${taken} were taken.`);
      const out = await resolveInProject(root, `${STATE_DIR}/captures`, { state: true });
      const server = await serveDirectory(root, { entry });
      let shots;
      try { shots = await (capture || captureViews)({ browser, baseUrl: server.url, entry, views, target: args.target, full: args.full === true, outDir: out.file, prefix: `r${round}`, env }); }
      catch (error) { throw new ProductionToolError('CAPTURE_FAILED', String(error?.message || 'The page could not be captured.').slice(0, 300), true); }
      finally { await server.close(); }
      const issued = shots.map(({ file, ...shot }) => ({ ...shot, round, path: `${STATE_DIR}/captures/${path.basename(file)}`, entry, capturedAt: new Date().toISOString() }));
      await writeState(root, 'captures', { captures: [...state.captures.filter(item => !issued.some(shot => shot.id === item.id)), ...issued] });
      return { status: 'captured', round, captures: issued.map(({ capturedAt, ...shot }) => { void capturedAt; return shot; }),
        next: 'Open each PNG with your image-reading tool, judge every review criterion of your plan, and validate the review with culture_validate_review.' };
    }
    if (name === 'culture_validate_review') {
      const root = await projectRoot(env);
      const captures = (await readState(root, 'captures'))?.captures || [];
      const review = normalizeReview(args.review, { plan: planArgument(args.plan), captures, opened: null, rounds: CAPTURE_LIMITS.rounds });
      return { status: 'valid', review, audit: 'This session cannot confirm which captures you opened; a host that records the session does.',
        next: !(review.stats.partly || review.stats.missed) ? 'Every criterion is met. Finish, keeping the DNA as it is.'
          : review.round < CAPTURE_LIMITS.rounds ? `Make the repairs you named, then capture round ${review.round + 1} with culture_capture and review it.` : 'Make the repairs you named; this was the last review round.' };
    }
    return undefined;
  }
  return { definitions: PRODUCTION_TOOLS, names: PRODUCTION_TOOL_NAMES, handle };
}

/** A caller's taste input reduced to what the validators read: its source, entities with refs and names, and required anchors. */
export function tasteInputArgument(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.entities) || value.entities.length > 200) throw new TasteProtocolError('tasteInput', 'A tasteInput with at most 200 entities and its requiredAnchors is required.');
  const entities = value.entities.filter(entity => entity && typeof entity === 'object' && typeof entity.ref === 'string' && entity.ref.length <= 160 && typeof entity.name === 'string');
  const requiredAnchors = (Array.isArray(value.requiredAnchors) ? value.requiredAnchors : []).slice(0, 20).map(item => typeof item === 'string' ? item : item?.ref).filter(ref => typeof ref === 'string');
  return { source: typeof value.source === 'string' ? value.source : 'caller-provided', entities, requiredAnchors };
}
const tasteInput = tasteInputArgument;

export { ProjectScopeError, ImageRequestError };
