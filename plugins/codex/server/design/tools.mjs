// The design tools of the mousa surface: the stages after the measurement (reading, Design DNA, production plan,
// review), the conformance check through the project's own design system, captures of the result or of the specimen
// board handed straight to the model, pictures made by the host's own image tool or a local Codex, the font library and
// a fingerprint comparison of two designs. Every record stays in the project's .mousa folder, so the agent passes only
// the artifact of the stage it is on.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { htmlElementIds, designFingerprint, compareDesignFingerprints, normalizeTasteName, DNA_LAYERS, TasteProtocolError } from '../culture/taste.mjs';
import { mediumProfile, listMedia } from '../production/media.mjs';
import { normalizeTasteReading, applyReadingToDna } from '../production/reading.mjs';
import { normalizeProductionPlan, generationAllowance } from '../production/plan.mjs';
import { normalizeReview } from '../production/review.mjs';
import { standaloneCapabilities, CAPTURE_LIMITS } from '../production/capabilities.mjs';
import { serveDirectory, captureViews } from '../production/capture.mjs';
import { buildImageBrief, buildImagePrompt, createCodexImageGenerator, IMAGE_ASPECTS, IMAGE_LIMITS } from '../production/images.mjs';
import { pngSize, jpegSize, imagePalette, colorDistance, scalePng } from '../production/image-files.mjs';
import { fontsForDna } from '../production/fonts.mjs';
import { readState, writeState, resolveInProject, relativePath, readProjectFiles, STATE_DIR, WORKSPACE_FIELD } from '../production/project-files.mjs';
import { tasteInputArgument } from '../production/tools.mjs';
import { collectProjectFiles, detectDesignSystem, mergedPages, checkDesignSystem, checkFontFiles, styleFootprint, styleNotes } from './systems.mjs';
import { buildSpecimen } from './specimen.mjs';

export const PRODUCTION_MEDIA = Object.freeze(listMedia().map(medium => medium.id).filter(id => ['web', 'app-ui', 'generic'].includes(id)));
// What a taste recipe usually makes when the project itself does not say: pages for a site, a place or a brand, an
// interface with tokens for an app, source text for a game, writing and anything else.
const RECIPE_ARTIFACT = Object.freeze({ web: 'web', 'app-ui': 'app-ui', place: 'web', brand: 'web', game: 'generic', writing: 'generic', generic: 'generic' });
// Captures handed to a model are scaled to this longer side, which models reduce larger pictures to anyway.
export const INLINE_CAPTURE_MAX_SIDE = 1568;
const SPECIMEN_VIEW = Object.freeze({ id: 'board', width: 1440, height: 900 });
const PALETTE_FIT_DELTA_E = 22;

const STAGES = ['prediction', 'reading', 'dna', 'plan', 'review'];
export const DESIGN_TOOLS = Object.freeze([
  {
    name: 'design_validate',
    description: 'Validate and save one design stage; each stage is frozen once the next one rests on it. prediction: before any Qloo data, your own guess at what the audience loves in each planned domain and the design you would make from it (designSketch, library fonts); restart:true starts a new session. reading: 2-4 clusters of refs that belong together (name them as the Taste Brief lists them), each resting on a quality, the layers each carries, refs set aside with reasons, and how the medium carries them. dna: 5-10 concrete devices anchored to refs your reading kept, with literal tokens (hex colors, library fonts, CSS values, keyframes, SVG ids, element ids, copy, pictures); surprises must move it away from your sketch; the result lists the methods this session offers per layer. plan: one step per device with its method, the cluster it realizes and why, a count and fallback for generated pictures, and 2-6 review criteria. review: your verdict on each criterion from captures of this round. revise:true replaces a saved reading, DNA or plan and drops the stages after it.',
    inputSchema: { type: 'object', properties: {
      stage: { type: 'string', enum: STAGES },
      artifact: { type: 'object', description: 'The stage\'s artifact as JSON.' },
      medium: { type: 'string', enum: PRODUCTION_MEDIA, description: 'web (pages and stylesheets), app-ui (pages with a design token file) or generic (any source). Detected from the project when left out.' },
      restart: { type: 'boolean' }, revise: { type: 'boolean' }, workspace: WORKSPACE_FIELD,
    }, required: ['stage', 'artifact'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'design_check',
    description: 'Check that every device of the saved DNA is really in the project: colors, fonts and their files, CSS values, keyframes with a reduced-motion fallback and a pause control for endless loops, SVG drawings, element ids, copy and pictures. In a project with CSS custom properties it also checks that each palette and typography value is held by a custom property the styles use through var(), and names it. Reads the project\'s pages, styles and scripts unless paths are given. Shows presence, not quality.',
    inputSchema: { type: 'object', properties: {
      paths: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200 } },
      medium: { type: 'string', enum: PRODUCTION_MEDIA }, workspace: WORKSPACE_FIELD,
    }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'design_capture',
    description: 'Capture the result for your review and see it: the pictures come back in this result. By default the project\'s entry page at each view of its medium (desktop and mobile for a site); target scrolls to an element id, full takes the whole height, and root serves a built folder such as dist. specimen:true captures the specimen board instead: the DNA drawn on one page (palette, type in its fonts, motion, drawings, pictures and voice), for designs a browser cannot open or to judge the system itself. Rounds hold 6 captures each; review each round with design_validate stage review.',
    inputSchema: { type: 'object', properties: {
      specimen: { type: 'boolean' }, entry: { type: 'string', minLength: 1, maxLength: 200 },
      views: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 30 } },
      target: { type: 'string', minLength: 1, maxLength: 60 }, full: { type: 'boolean' },
      root: { type: 'string', minLength: 1, maxLength: 120, description: 'A folder inside the project to serve as the site, such as dist or build after the project\'s own build step. Default: the project folder.' },
      round: { type: 'integer', minimum: 1, maximum: CAPTURE_LIMITS.rounds }, workspace: WORKSPACE_FIELD,
    }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'image',
    description: 'Pictures for an imagery device, as the production plan allows. prompt: Moûsa writes the image brief from the device (its look, colors and qualities, never a work\'s name) and names the file to save; make the picture with your own image tool from that brief, save it there, then call register. register: checks the saved file and how close its main colors are to the device\'s palette, and records it. generate: makes the picture with a signed-in Codex CLI on this machine, when mousa_status lists codex-cli as available. Without any image tool, use the plan\'s fallback method.',
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: ['prompt', 'register', 'generate'] },
      device: { type: 'string', minLength: 1, maxLength: 40 },
      subject: { type: 'string', minLength: 10, maxLength: 240, description: 'One sentence: what the picture shows, without naming any work, artist or brand.' },
      aspect: { type: 'string', enum: Object.keys(IMAGE_ASPECTS) },
      path: { type: 'string', minLength: 5, maxLength: 120, description: 'For register: the saved file, such as generated/dna5-1.png.' },
      workspace: WORKSPACE_FIELD,
    }, required: ['action', 'device'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'materials',
    description: 'The open-licence font library (SIL OFL 1.1) the plugin carries. find: families ranked by words for the character you want, such as condensed, warm, editorial or typewriter, with the system fonts each stands in for. fetch: copy the families your plan uses into the project (default folder fonts) with their licence files, and get the @font-face rules to paste into your stylesheet, with URLs written from the stylesheet you name.',
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: ['find', 'fetch'] },
      words: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 2, maxLength: 40 } },
      fonts: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 60 } },
      directory: { type: 'string', minLength: 1, maxLength: 80, description: 'Where the fonts go, such as fonts, or public/fonts in a Vite project, which serves it from the site root.' },
      stylesheet: { type: 'string', minLength: 1, maxLength: 200, description: 'The stylesheet that will hold the @font-face rules, such as src/style.css. Default: one at the project root.' },
      workspace: WORKSPACE_FIELD,
    }, required: ['action'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'design_compare',
    description: 'A heuristic distance between two designs in folders of the project, such as a design made with Qloo and one made without: palette, type classes, landmark sections and CSS features. When the folders are design workspaces, it also reports where the taste of each came from, how many DNA devices rest on what the prediction did not contain, and whether both started from the same frozen prediction. One distance is not a quality or preference measure.',
    inputSchema: { type: 'object', properties: { a: { type: 'string', minLength: 1, maxLength: 200 }, b: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['a', 'b'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
]);

export class DesignToolError extends Error {
  constructor(code, message, retryable = false) { super(message); this.name = 'DesignToolError'; this.code = code; this.retryable = retryable; }
}
const refuse = (code, message) => { throw new DesignToolError(code, message); };

/** The devices a production plan reads: tokens as the medium checks them, anchors as the DNA declares them. */
function planDna(dna, profile) {
  const checked = profile.dnaForCheck(dna);
  return { devices: checked.devices.map((device, index) => ({ ...device, anchors: (dna.devices?.[index]?.anchors || []).filter(ref => typeof ref === 'string') })) };
}
// The marks the Taste Brief puts after a name: new (a surprise) or predicted.
const BRIEF_MARK = / \((?:new|predicted)\)$/u;
const REF_FIELDS = Object.freeze({ reading: [['clusters', 'refs'], ['setAside', 'ref']], dna: [['devices', 'anchors'], ['rejected', 'ref']] });

/**
 * The refs of a reading or DNA, which the agent may give as the Taste Brief names them. A name resolves to the one
 * entity of the taste input that carries it, a measured one before the agent's own prediction of the same name; a name
 * two measured entities share asks for the ref, and an unknown name is refused with where the names are listed.
 */
export function resolveTasteRefs(stage, artifact, input) {
  let source = artifact;
  if (typeof source === 'string') { try { source = JSON.parse(source); } catch { return artifact; } }
  if (!source || typeof source !== 'object' || Array.isArray(source) || !REF_FIELDS[stage]) return artifact;
  const entities = Array.isArray(input?.entities) ? input.entities : [];
  const refs = new Set(entities.map(entity => entity.ref));
  const byName = new Map();
  for (const entity of entities) {
    const key = normalizeTasteName(entity.name);
    if (key) byName.set(key, [...(byName.get(key) || []), entity]);
  }
  const resolve = (value, at) => {
    if (typeof value !== 'string') return value;
    const given = value.trim();
    if (refs.has(given)) return given;
    const found = byName.get(normalizeTasteName(given.replace(BRIEF_MARK, ''))) || [];
    const measured = found.filter(entity => entity.source === 'qloo');
    const pool = [...new Map((measured.length ? measured : found).map(entity => [entity.ref, entity])).values()];
    if (pool.length === 1) return pool[0].ref;
    if (pool.length > 1) throw new TasteProtocolError(at, `${given} names ${pool.length} entries of the taste input: ${pool.slice(0, 4).map(entity => `${entity.ref} (${entity.domain})`).join(', ')}. Give the ref you mean.`);
    throw new TasteProtocolError(at, `${given.slice(0, 80)} is not a name in this session's taste input. Use a name as the Taste Brief lists it, or a ref from ${STATE_DIR}/taste/input.json.`);
  };
  const copy = structuredClone(source);
  for (const [list, field] of REF_FIELDS[stage]) {
    if (!Array.isArray(copy[list])) continue;
    copy[list].forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const at = `${stage}.${list}[${index}].${field}`;
      if (Array.isArray(item[field])) item[field] = item[field].map((value, position) => resolve(value, `${at}[${position}]`));
      else if (item[field] !== undefined) item[field] = resolve(item[field], at);
    });
  }
  return copy;
}

const stemMatch = (word, value) => {
  const a = normalizeTasteName(word), b = normalizeTasteName(value);
  return Boolean(a && b) && (b.split(' ').includes(a) || (a.length >= 5 && b.split(' ').some(part => part.length >= 5 && part.slice(0, 5) === a.slice(0, 5))));
};

/**
 * The tools. `context`: env, host, project(meta) for the folder, fonts() for the library, images() for the picture
 * providers, browser() for capture, and, in tests, generate (a Codex stand-in), capture (a browser stand-in) and now.
 */
export function createDesignTools(context) {
  const { env = process.env, host = 'unknown', project, fonts = async () => null, images = async () => [], browser = async () => ({ available: false, reason: 'No browser check.' }),
    generate, capture, now = Date.now } = context;
  const environment = env.MOUSA_ENVIRONMENT === 'hosted' ? 'hosted' : 'local';
  const perRun = Math.min(IMAGE_LIMITS.perRun, Math.max(1, Number.parseInt(env.MOUSA_IMAGES_PER_RUN, 10) || 4));
  const stamp = () => new Date(now()).toISOString();
  const session = (root, stage) => writeState(root, 'session', { plugin: 'mousa', stage, updatedAt: stamp() });
  const needed = async (root, name, message) => (await readState(root, name)) || refuse('STAGE_MISSING', message);

  async function imageAvailability() {
    const providers = await images();
    const usable = providers.find(item => item.id !== 'off' && ['available', 'depends'].includes(item.status));
    return usable ? { available: true, provider: usable.id } : { available: false, reason: providers.find(item => item.id === 'codex-cli')?.reason || (providers.length === 1 && providers[0].note) || 'No image tool is available in this session.' };
  }
  const capabilitiesFor = async medium => standaloneCapabilities({ medium, environment, fonts: await fonts(), image: await imageAvailability(), browser: await browser(), imagesPerRun: perRun });
  const methodsByLayer = (capabilities, layers) => Object.fromEntries(layers.map(layer => [layer, capabilities.methods.filter(item => item.available && item.layers.includes(layer)).map(item => item.id)]));

  async function productionMedium(root, requested, files) {
    if (requested) return requested;
    const saved = (await readState(root, 'design/dna'))?.medium || (await readState(root, 'design/reading'))?.medium;
    if (saved) return saved;
    const detected = detectDesignSystem(files || await collectProjectFiles(root));
    if (detected.pages || detected.medium !== 'generic') return detected.medium;
    return RECIPE_ARTIFACT[(await readState(root, 'taste/plan'))?.medium] || 'generic';
  }

  async function validate(args, meta) {
    const root = await project(meta, args.workspace);
    const input = await needed(root, 'taste/input', 'Measure the audience first: taste_profile with dryRun, design_validate for your prediction, then taste_profile (or taste_profile with baseline:true to design without Qloo).');
    const nameOf = new Map((input.entities || []).map(entity => [entity.ref, entity.name]));
    if (args.stage === 'reading') {
      if ((await readState(root, 'design/dna')) && !args.revise) refuse('STAGE_FROZEN', 'Your Design DNA rests on this reading. To change it, call again with revise:true; the DNA and the plan after it are then removed.');
      const medium = await productionMedium(root, args.medium);
      const reading = normalizeTasteReading(resolveTasteRefs('reading', args.artifact, input), { input: tasteInputArgument(input), medium });
      if (args.revise) await dropStages(root, ['dna', 'plan']);
      await writeState(root, 'design/reading', { medium, savedAt: stamp(), reading });
      await session(root, 'read');
      return { status: 'valid', stage: 'reading', medium, clusters: reading.clusters.map(cluster => ({ id: cluster.id, name: cluster.name, layers: cluster.layers })),
        setAside: (reading.setAside || []).map(item => nameOf.get(item.ref) || item.ref), next: 'Write the Design DNA from the refs your clusters keep, each device anchored to at least one of them, then design_validate with stage dna.' };
    }
    if (args.stage === 'dna') {
      const record = await needed(root, 'design/reading', 'Save your reading first: design_validate with stage reading.');
      const prediction = await needed(root, 'taste/prediction', 'Save your prediction first: design_validate with stage prediction.');
      if ((await readState(root, 'design/plan')) && !args.revise) refuse('STAGE_FROZEN', 'Your production plan rests on this DNA. To change it, call again with revise:true; the plan is then removed.');
      const medium = args.medium || record.medium, profile = mediumProfile(medium);
      const files = await collectProjectFiles(root);
      const existingIds = [...new Set(Object.entries(files).filter(([name]) => /\.html?$/iu.test(name)).flatMap(([, html]) => htmlElementIds(html)))];
      const library = await fonts();
      // No photo library on this surface: pictures come from the image tool, so a device lists only generated ones.
      const dna = profile.validateDna(applyReadingToDna(resolveTasteRefs('dna', args.artifact, input), record.reading), { input: tasteInputArgument(input), sketch: prediction.designSketch, existingIds, library: [],
        ...(library ? { fonts: fontsForDna(library) } : {}) });
      if (args.revise) await dropStages(root, ['plan']);
      await writeState(root, 'design/dna', { medium: profile.id, savedAt: stamp(), dna });
      await session(root, 'specified');
      const capabilities = await capabilitiesFor(profile.id);
      return { status: 'valid', stage: 'dna', medium: profile.id, devices: dna.devices.map(device => ({ id: device.id, layer: device.layer, device: device.device })),
        methods: methodsByLayer(capabilities, [...new Set(dna.devices.map(device => device.layer))]),
        unavailable: capabilities.methods.filter(item => !item.available).map(item => `${item.id}: ${item.reason}`),
        ...(capabilities.generators?.image?.available ? { pictures: { perRun: capabilities.generators.image.perRun, provider: capabilities.generators.image.provider } } : {}),
        reviewCapture: Boolean(capabilities.review?.capture?.available),
        next: 'Plan how each device is made with these methods, then design_validate with stage plan.' };
    }
    if (args.stage === 'plan') {
      const dnaRecord = await needed(root, 'design/dna', 'Save the Design DNA first: design_validate with stage dna.');
      const reading = await needed(root, 'design/reading', 'Save your reading first.');
      if (((await readState(root, 'images'))?.images || []).length && !args.revise) refuse('STAGE_FROZEN', 'Pictures were already made from this plan. To change it, call again with revise:true.');
      const profile = mediumProfile(dnaRecord.medium);
      const plan = normalizeProductionPlan(args.artifact, { dna: planDna(dnaRecord.dna, profile), reading: reading.reading, capabilities: await capabilitiesFor(profile.id) });
      await writeState(root, 'design/plan', { medium: profile.id, savedAt: stamp(), plan });
      await session(root, 'production-planned');
      return { status: 'valid', stage: 'plan', steps: plan.steps.map(step => `${step.device}: ${step.method}${step.count ? ` ×${step.count}` : ''}`), review: (plan.review || []).map(item => item.id),
        ...(plan.uses.materials.fonts?.length ? { fonts: plan.uses.materials.fonts } : {}),
        next: `${plan.uses.materials.fonts?.length ? 'Fetch the planned fonts with materials fetch. ' : ''}${Object.keys(plan.uses.generators || {}).length ? 'Make the planned pictures with image. ' : ''}Build the design, then design_check.` };
    }
    if (args.stage === 'review') {
      const planRecord = await needed(root, 'design/plan', 'Save the production plan first: design_validate with stage plan.');
      const captures = (await readState(root, 'captures'))?.captures || [];
      // Captures this surface returned inside its result were seen; reads a host records (Claude Code's Read audit) also count.
      const opened = new Set([...captures.filter(item => item.delivered).map(item => item.id), ...((await readState(root, 'opened'))?.opened || [])]);
      const review = normalizeReview(args.artifact, { plan: planRecord.plan, captures, opened, rounds: CAPTURE_LIMITS.rounds });
      const reviews = (await readState(root, 'design/reviews'))?.reviews || [];
      await writeState(root, 'design/reviews', { reviews: [...reviews.filter(item => item.round !== review.round), review] });
      await session(root, 'reviewed');
      const open = review.stats.partly || review.stats.missed;
      return { status: 'valid', stage: 'review', round: review.round, stats: review.stats, audited: review.audited,
        next: !open ? 'Every criterion is met. Finish, keeping the DNA as it is.' : review.round < CAPTURE_LIMITS.rounds ? `Make the repairs you named, then design_capture with round ${review.round + 1} and review it.` : 'Make the repairs you named; this was the last review round.' };
    }
    return refuse('TOOL_INPUT_INVALID', 'Use a stage: prediction, reading, dna, plan or review.');
  }

  /** Later stages a revision removes, kept in the session history rather than deleted. */
  async function dropStages(root, names) {
    const target = path.join(root, STATE_DIR, 'history', `${stamp().replace(/[:.]/gu, '-')}-revised`);
    for (const name of names) {
      const file = path.join(root, STATE_DIR, 'design', `${name}.json`);
      if (await fs.stat(file).then(() => true, () => false)) { await fs.mkdir(target, { recursive: true }); await fs.rename(file, path.join(target, `${name}.json`)); }
    }
  }

  async function check(args, meta) {
    const root = await project(meta, args.workspace);
    const record = await needed(root, 'design/dna', 'Save the Design DNA first: design_validate with stage dna.');
    const files = args.paths ? await readProjectFiles(root, args.paths) : await collectProjectFiles(root);
    if (!Object.keys(files).length) refuse('PROJECT_EMPTY', 'The project has no pages, styles or scripts yet. Build the design, then check it.');
    const detected = detectDesignSystem(files);
    const profile = mediumProfile(args.medium || record.medium);
    const library = await fonts();
    const options = { ...(library ? { fonts: fontsForDna(library) } : {}), ...(detected.tokensFile ? { tokensFile: detected.tokensFile } : {}) };
    const checked = profile.id === 'web' ? mergedPages(files) : files;
    let report = profile.checkConformance(profile.dnaForCheck(record.dna), checked, options);
    // The project's own design system: custom properties, a Tailwind theme, or colours in any notation. App screens keep
    // their token check.
    if (profile.id !== 'app-ui') report = checkDesignSystem(record.dna, checked, report, detected);
    // A font file named by a path that reaches nothing, read from each stylesheet where it is written.
    if (options.fonts) report = await checkFontFiles(report, record.dna, files, root, options.fonts);
    // The project's way of styling, against how the session found it: a Tailwind restyle written as a stylesheet of
    // new classes passed the theme check in a live session while leaving the project's classes behind.
    const start = await readState(root, 'design/start');
    const now = styleFootprint(files), drift = styleNotes(start, now);
    const style = { ...(start ? { atStart: { stylesheets: start.stylesheets, handWritten: start.handWritten, classes: start.classes } } : {}), now: { stylesheets: now.stylesheets, handWritten: now.handWritten, classes: now.classes } };
    await writeState(root, 'design/check', { checkedAt: stamp(), medium: profile.id, system: detected.system, score: report.score, devices: report.devices, style });
    await session(root, 'checked');
    const notes = [...(detected.notes || []), ...drift];
    const repair = report.devices.some(device => device.status !== 'present');
    return { status: 'checked', medium: profile.id, system: detected.system, score: report.score, meetsThreshold: report.meetsThreshold,
      devices: report.devices.map(device => ({ id: device.id, layer: device.layer, status: device.status, ...(device.missing.length ? { missing: device.missing.slice(0, 5) } : {}) })),
      ...(report.system ? { bindings: report.system.bindings } : {}), ...(report.motion ? { motion: { reducedMotion: report.motion.reducedMotion, pauseControl: report.motion.pauseControl, undefinedKeyframes: report.motion.undefined } } : {}),
      style, ...(notes.length ? { notes } : {}), limitation: 'Presence of the declared values, not visual quality or preference.',
      next: drift.length ? `${repair ? 'Repair what is missing, and m' : 'M'}ove the styling back into the project's classes (see notes), check again, then capture the result with design_capture.`
        : repair ? 'Repair what is missing, check again, then capture the result with design_capture.' : 'Capture the result with design_capture and review it against your plan.' };
  }

  async function captureResult(args, meta) {
    const root = await project(meta, args.workspace);
    const found = await browser();
    if (!found.available) refuse('CAPTURE_UNAVAILABLE', `The result cannot be captured here: ${found.reason}`);
    const state = (await readState(root, 'captures')) || { captures: [] };
    const round = args.round ?? Math.max(1, ...state.captures.map(item => item.round || 1));
    const taken = state.captures.filter(item => item.round === round).length;
    const out = await resolveInProject(root, `${STATE_DIR}/captures`, { state: true });
    await fs.mkdir(out.file, { recursive: true });
    let shots, served, scratch = null;
    try {
      if (args.specimen) {
        const record = await needed(root, 'design/dna', 'Save the Design DNA first: the specimen board draws it.');
        if (taken + 1 > CAPTURE_LIMITS.perRound) refuse('CAPTURE_LIMIT', `Round ${round} allows ${CAPTURE_LIMITS.perRound} captures and ${taken} were taken.`);
        scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-specimen-'));
        await buildSpecimen({ dna: record.dna, library: await fonts(), root, files: await collectProjectFiles(root), outDir: scratch, title: 'Design DNA specimen' });
        served = await serveDirectory(scratch, { entry: 'index.html' });
        shots = await (capture || captureViews)({ browser: found, baseUrl: served.url, entry: 'index.html', views: [SPECIMEN_VIEW], full: true, outDir: out.file, prefix: `r${round}-specimen`, env });
      } else {
        const files = await collectProjectFiles(root);
        const detected = detectDesignSystem(files);
        const medium = mediumProfile((await readState(root, 'design/dna'))?.medium || detected.medium);
        // A framework project is captured from its own build output, which the file reader leaves out.
        const site = args.root ? (await resolveInProject(root, args.root, { name: 'root' })).file : root;
        if (args.root && !(await fs.stat(site).then(stat => stat.isDirectory(), () => false))) refuse('CAPTURE_INVALID', `root: ${args.root} is not a folder of the project. Run the project's build first.`);
        const entry = relativePath(args.entry || (args.root ? 'index.html' : detected.entry) || medium.entry || 'index.html', { name: 'entry' });
        const present = args.root ? await fs.stat(path.join(site, ...entry.split('/'))).then(stat => stat.isFile(), () => false) : Object.hasOwn(files, entry);
        if (!/\.html?$/iu.test(entry) || !present) refuse('CAPTURE_INVALID', `entry: name an HTML page ${args.root ? `in ${args.root}` : 'of the project'}${!args.root && detected.entry ? `, such as ${detected.entry}` : ''}. A design without pages is reviewed with specimen:true.`);
        const views = args.views === undefined ? medium.views : args.views.map(id => medium.views.find(view => view.id === id) || refuse('CAPTURE_INVALID', `views: use ${medium.views.map(view => view.id).join(', ')}.`));
        if (taken + views.length > CAPTURE_LIMITS.perRound) refuse('CAPTURE_LIMIT', `Round ${round} allows ${CAPTURE_LIMITS.perRound} captures and ${taken} were taken.`);
        served = await serveDirectory(site, { entry });
        shots = await (capture || captureViews)({ browser: found, baseUrl: served.url, entry, views, target: args.target, full: args.full === true, outDir: out.file, prefix: `r${round}`, env });
      }
    } catch (error) {
      if (error instanceof DesignToolError) throw error;
      throw new DesignToolError('CAPTURE_FAILED', String(error?.message || 'The page could not be captured.').slice(0, 300), true);
    } finally {
      await served?.close();
      if (scratch) await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
    const issued = shots.map(({ file, ...shot }) => ({ ...shot, round, path: `${STATE_DIR}/captures/${path.basename(file)}`, ...(args.specimen ? { specimen: true } : {}), delivered: true, capturedAt: stamp() }));
    await writeState(root, 'captures', { captures: [...state.captures.filter(item => !issued.some(shot => shot.id === item.id)), ...issued] });
    await session(root, 'captured');
    // The pictures themselves, scaled for the model, without structuredContent: Codex drops images from a result that has it.
    const content = [];
    for (const shot of shots) {
      const bytes = await fs.readFile(shot.file);
      content.push({ type: 'image', data: scalePng(bytes, INLINE_CAPTURE_MAX_SIDE).toString('base64'), mimeType: 'image/png' });
    }
    content.push({ type: 'text', text: JSON.stringify({ status: 'captured', round, captures: issued.map(({ capturedAt, delivered, ...shot }) => { void capturedAt; void delivered; return shot; }),
      next: 'Judge each review criterion of your plan on these captures, describing what they show, then design_validate with stage review.' }) });
    return { content };
  }

  async function picture(args, meta) {
    const root = await project(meta, args.workspace);
    const dnaRecord = await needed(root, 'design/dna', 'Save the Design DNA first: pictures are made for its imagery devices.');
    const planRecord = await needed(root, 'design/plan', 'Save the production plan first: it says which devices get pictures and how many.');
    const records = (await readState(root, 'images'))?.images || [];
    const mine = records.filter(item => item.device === args.device);
    if (args.action === 'register') {
      if (!args.path) refuse('TOOL_INPUT_INVALID', 'register needs path: the file you saved, such as generated/dna5-1.png.');
      const relative = relativePath(args.path, { name: 'path' });
      const pending = mine.find(item => item.status === 'requested' && item.saveAs.replace(/\.(?:png|jpg)$/u, '') === relative.replace(/\.(?:png|jpe?g)$/u, ''));
      if (!pending) refuse('IMAGE_NOT_REQUESTED', `No brief was issued for ${relative}. Call image with action prompt for ${args.device} first, then save the picture under the name it gives.`);
      const { file } = await resolveInProject(root, relative);
      const bytes = await fs.readFile(file).catch(() => null);
      if (!bytes) refuse('IMAGE_MISSING', `${relative} is not in the project yet. Save the picture there first.`);
      if (bytes.length > 20 * 1024 * 1024) refuse('IMAGE_INVALID', 'The picture is larger than 20 MB.');
      const size = pngSize(bytes) || jpegSize(bytes);
      if (!size) refuse('IMAGE_INVALID', `${relative} is not a PNG or JPEG picture.`);
      const fit = paletteFit(bytes, dnaRecord.dna, args.device);
      const record = { ...pending, status: 'registered', path: relative, provider: 'host-tool', width: size.width, height: size.height, ...(fit ? { palette: fit } : {}), registeredAt: stamp() };
      await writeState(root, 'images', { images: records.map(item => item === pending ? record : item) });
      return { status: 'registered', device: args.device, path: relative, width: size.width, height: size.height, ...(fit ? { palette: fit } : {}),
        next: fit && !fit.fits ? 'Its main colors are far from the device\'s palette: make it again from the brief, or treat it with the palette (a filter or blend) where it is shown.' : `Show it in the device it was made for, by its path, and list ${relative} in that device's tokens.images if the DNA is revised.` };
    }
    if (!args.subject) refuse('TOOL_INPUT_INVALID', `${args.action} needs subject: one sentence of what the picture shows.`);
    if (records.length >= perRun) refuse('IMAGES_EXHAUSTED', `This session already asked for ${records.length} pictures, the limit of ${perRun}. Use the plan's fallback method for the rest.`);
    const allowance = generationAllowance(planRecord.plan, 'image', args.device, mine.length);
    if (!allowance.allowed) refuse('IMAGE_NOT_PLANNED', allowance.reason);
    const input = await readState(root, 'taste/input');
    const names = (input?.entities || []).map(entity => entity?.name).filter(value => typeof value === 'string');
    const n = mine.length + 1, base = `generated/${args.device.toLowerCase().replace(/[^a-z0-9_-]/gu, '-')}-${n}`;
    if (args.action === 'prompt') {
      const { brief, subject, aspect } = buildImageBrief({ dna: dnaRecord.dna, names, device: args.device, subject: args.subject, aspect: args.aspect ?? 'landscape' });
      const saveAs = `${base}.png`;
      await writeState(root, 'images', { images: [...records, { device: args.device, n, subject, aspect, brief, saveAs, status: 'requested', requestedAt: stamp() }] });
      const how = host === 'codex'
        ? `Make the picture with your image generation tool from this brief. Save it in the project as ${saveAs} (copy it from where the tool saved it), then call image with action register and path ${saveAs}.`
        : `Make the picture with this session's image tool from this brief, save it in the project as ${saveAs}, then call image with action register. If this session has no image tool, use the plan's fallback method instead.`;
      return { status: 'requested', device: args.device, brief, saveAs, how, remaining: allowance.remaining - 1 };
    }
    if (args.action === 'generate') {
      const providers = await images();
      const cli = providers.find(item => item.id === 'codex-cli');
      if (!generate && cli?.status !== 'available') refuse('IMAGES_UNAVAILABLE', `A local Codex CLI is not available here${cli?.reason ? `: ${cli.reason}` : ''}. Use action prompt with your own image tool, or the plan's fallback method.`);
      const request = buildImagePrompt({ dna: dnaRecord.dna, names, device: args.device, subject: args.subject, aspect: args.aspect ?? 'landscape' });
      const work = await resolveInProject(root, `${STATE_DIR}/images`, { state: true });
      await fs.mkdir(work.file, { recursive: true });
      const generator = generate ? { generate } : createCodexImageGenerator({ codex: { ...cli, available: true, path: cli.path }, env });
      let made;
      try { made = await generator.generate({ prompt: request.prompt, directory: work.file, name: path.basename(base), keepPng: true }); }
      catch (error) { throw new DesignToolError('IMAGE_GENERATION_FAILED', `${String(error?.message || 'The picture could not be generated.').slice(0, 300)} Use the step's fallback method if it fails again.`, true); }
      const target = await resolveInProject(root, `generated/${path.basename(made.path)}`);
      await fs.mkdir(path.dirname(target.file), { recursive: true });
      await fs.rename(path.join(work.file, path.basename(made.path)), target.file);
      const bytes = await fs.readFile(target.file);
      const fit = paletteFit(bytes, dnaRecord.dna, args.device);
      await writeState(root, 'images', { images: [...records, { device: args.device, n, subject: request.subject, aspect: request.aspect, brief: request.prompt, saveAs: target.relative, status: 'registered',
        path: target.relative, provider: 'codex-cli', width: made.width, height: made.height, ...(fit ? { palette: fit } : {}), registeredAt: stamp() }] });
      return { status: 'generated', device: args.device, path: target.relative, width: made.width, height: made.height, ...(fit ? { palette: fit } : {}), remaining: allowance.remaining - 1 };
    }
    return refuse('TOOL_INPUT_INVALID', 'Use action prompt, register or generate.');
  }

  /** How many of a PNG's main colors sit near the device's colors (its own, completed from the palette devices). */
  function paletteFit(bytes, dna, deviceId) {
    const main = imagePalette(bytes, { count: 6 });
    if (!main?.length) return null;
    const devices = dna.devices || [], device = devices.find(item => item.id === deviceId);
    const own = device?.tokens?.colors || [];
    const colors = own.length >= 2 ? own : [...new Set([...own, ...devices.filter(item => item.layer === 'palette').flatMap(item => item.tokens?.colors || [])])];
    if (!colors.length) return null;
    const matched = main.filter(item => colors.some(color => colorDistance(item.hex, color) <= PALETTE_FIT_DELTA_E)).length;
    return { main: main.map(item => item.hex), matched, of: main.length, fits: matched >= Math.min(2, main.length) };
  }

  async function material(args, meta) {
    const library = await fonts();
    if (!library) refuse('MATERIALS_UNAVAILABLE', 'The font library was not found. Set MOUSA_LIBRARY_ROOT to the folder that holds library/fonts.');
    if (args.action === 'find') {
      const words = (args.words || []).map(word => word.trim()).filter(Boolean);
      const ranked = library.families.map((family, index) => ({ family, index, matches: words.filter(word => [family.category, ...(family.character || []), family.family].some(value => stemMatch(word, value))) }))
        .sort((a, b) => b.matches.length - a.matches.length || a.index - b.index);
      return { status: 'found', license: 'OFL-1.1', families: ranked.map(({ family, matches }) => ({ family: family.family, category: family.category, character: (family.character || []).slice(0, 4),
        ...(family.similarTo?.length ? { standsInFor: family.similarTo } : {}), ...(words.length ? { matches } : {}) })),
        note: 'Category and character describe each typeface; they are not taste data. Name only these families in the DNA, and fetch the ones your plan uses.' };
    }
    if (!args.fonts?.length) refuse('TOOL_INPUT_INVALID', 'fetch needs fonts: the families to copy.');
    const root = await project(meta, args.workspace);
    const planned = (await readState(root, 'design/plan'))?.plan?.uses?.materials?.fonts || null;
    const directory = relativePath(args.directory ?? 'fonts', { name: 'directory' });
    const stylesheet = args.stylesheet ? relativePath(args.stylesheet, { name: 'stylesheet' }) : null;
    // A folder a build serves as it is (public/ in Vite, Next.js and Astro, static/ in SvelteKit) is reached from the
    // site root; any other folder by a path from the stylesheet.
    const served = /^(?:public|static)(?:\/(.*))?$/u.exec(directory);
    const urlFor = file => served ? `/${served[1] ? `${served[1]}/` : ''}${file}` : stylesheet ? path.posix.relative(path.posix.dirname(stylesheet), `${directory}/${file}`) : `${directory}/${file}`;
    const chosen = [...new Set(args.fonts.map(name => name.trim()))].map(name => {
      const family = library.families.find(item => normalizeTasteName(item.family) === normalizeTasteName(name)) || refuse('MATERIAL_UNKNOWN', `${name} is not in the font library. Use materials find to list its families.`);
      if (planned && !planned.some(item => normalizeTasteName(item) === normalizeTasteName(family.family))) refuse('MATERIAL_NOT_PLANNED', `The plan uses no ${family.family}; its library fonts are ${planned.join(', ') || 'none'}.`);
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
      const licence = path.basename(family.licenseRepositoryPath || '');
      if (licence) await fs.copyFile(path.join(path.dirname(family.faces[0].file), licence), path.join(folder, licence)).catch(() => {});
      result.push({ family: family.family, files, license: family.license, ...(licence ? { licenseFile: `${directory}/${licence}` } : {}) });
    }
    return { status: 'fetched', directory, families: result.map(item => ({ family: item.family, files: item.files.map(face => face.path) })),
      fontFace: result.flatMap(family => family.files.map(face => `@font-face{font-family:'${family.family}';src:url('${urlFor(path.posix.basename(face.path))}') format('woff2');font-weight:${face.weight};font-style:${face.style};font-display:swap}`)),
      note: `Paste the @font-face rules into ${stylesheet || 'a stylesheet at the project root'} as they are: their URLs are written from it${served ? ', and the site serves this folder from its root' : ''}. Keep the licence files beside the fonts.` };
  }

  async function compare(args, meta) {
    const root = await project(meta);
    const folders = [args.a, args.b].map(value => relativePath(value, { name: 'folder' }));
    const sets = [];
    for (const folder of folders) {
      const { file } = await resolveInProject(root, folder);
      const files = await collectProjectFiles(file);
      if (!Object.keys(files).length) refuse('PROJECT_EMPTY', `${folder} holds no pages, styles or scripts.`);
      sets.push(files);
    }
    const [a, b] = sets.map(designFingerprint);
    const arms = [];
    for (const folder of folders) arms.push(await armRecord(root, folder));
    const both = arms.every(Boolean);
    const same = both && arms[0].prediction && arms[0].prediction === arms[1].prediction;
    return { status: 'compared', a: folders[0], b: folders[1], distance: compareDesignFingerprints(a, b),
      ...(arms.some(Boolean) ? { arms: { a: arms[0]?.summary || null, b: arms[1]?.summary || null } } : {}),
      ...(both ? { samePrediction: Boolean(same) } : {}),
      limitation: `A heuristic distance from palette, type classes, landmark sections and CSS features.${both && !same ? ' The two designs did not start from the same frozen prediction, so their difference mixes the taste source with two different starting points.' : ''} Repeat the comparison under the same conditions before calling a difference the taste data's effect; it says nothing about quality.` };
  }

  /** What a design folder's own records say: where its taste came from, its frozen prediction and its DNA's anchors. */
  async function armRecord(root, folder) {
    const { file } = await resolveInProject(root, folder);
    const real = await fs.realpath(file).catch(() => null);
    if (!real) return null;
    const [input, prediction, dnaRecord] = await Promise.all(['taste/input', 'taste/prediction', 'design/dna'].map(name => readState(real, name).catch(() => null)));
    if (!input && !dnaRecord) return null;
    const stats = dnaRecord?.dna?.stats;
    const source = input?.source === 'qloo-profile' ? 'qloo' : input?.source === 'model-assumption' ? 'own prediction' : 'unknown';
    return {
      prediction: prediction ? JSON.stringify({ entries: (prediction.entries || []).map(entry => [entry.domain, normalizeTasteName(entry.name)]), sketch: prediction.designSketch || null }) : null,
      summary: { taste: source, ...(stats ? { devices: stats.devices, layers: stats.layers, qualityAnchoredDevices: stats.qualityAnchoredDevices,
        ...(source === 'qloo' ? { surpriseAnchoredDevices: stats.surpriseAnchoredDevices, headline: `${stats.surpriseAnchoredDevices} of ${stats.devices} devices rest on what the prediction did not contain.` } : {}),
        ...(stats.sketchMoves ? { sketchMoves: stats.sketchMoves } : {}) } : {}) },
    };
  }

  const names = DESIGN_TOOLS.map(tool => tool.name);
  async function handle(name, args, meta) {
    if (name === 'design_validate') return validate(args, meta);
    if (name === 'design_check') return check(args, meta);
    if (name === 'design_capture') return captureResult(args, meta);
    if (name === 'image') return picture(args, meta);
    if (name === 'materials') return material(args, meta);
    if (name === 'design_compare') return compare(args, meta);
    return null;
  }
  return { definitions: DESIGN_TOOLS, names, handle, layers: DNA_LAYERS };
}
