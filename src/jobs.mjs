import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { FileProject } from './project.mjs';
import { QlooClient } from './qloo/client.mjs';
import { createToolHandler } from './mcp/server.mjs';
import { makeDesignPrompt, makeTastePrompt, runKiro } from './kiro-runner.mjs';
import { redact } from './config.mjs';
import { normalizeCultureBrief, normalizeDirections, normalizeDecisions, normalizeCreativePlan, normalizeCreativeReconsideration, isCultureArtifactPath, fileDiff, assertBrandLocks, assertStarterFacts, narrativeRetention, copyOverlap, findHtmlTarget, applyScopedRevision, snapshotResearchApplications, verifyResearchApplications, uncheckedResearchVerification, portableTasteRecords, portableRunRecords, tasteRecordText } from './design-artifacts.mjs';
import { extractNativeWebSources, validatePublicResearchUrl } from './web-research.mjs';
import { normalizeResearchDecisions } from '../plugin/server/culture/policy.mjs';
import { TASTE_LIMITS, DEFAULT_TASTE_DOMAINS, buildTasteProfile, selectTasteReferences, normalizeTasteAssumption, tasteInputFromProfile, tasteInputFromAssumption, compactTasteInput,
  normalizeDesignDna, checkDnaConformance, dnaDecisions, normalizeTasteDirections, scoreTasteDirections, compareTasteRuns, htmlElementIds, sketchDivergence, isTagDomain, isQualityDomain, QUALITY_DOMAIN } from '../plugin/server/culture/taste.mjs';
import { creativeContextForBrief, normalizePreparation, normalizePreparationResponse, answerPreparation } from './preparation.mjs';
import { loadLibrary, libraryArtifact, libraryForDna } from './library.mjs';
import { loadFontLibrary, fontsArtifact, fontsForDna } from './fonts.mjs';
import { IMAGE_LIMITS, GENERATED_IMAGE_PATH, ImageRequestError, buildImagePrompt } from './image-generator.mjs';
import { CHARACTER_KIND, characterRequest, newCharacterJob, runCharacterJob, publicCharacterJob } from './character-jobs.mjs';
import { SITE_MEDIUM_ID, CAPABILITIES_FILE, READING_FILE, PLAN_FILE, REVIEW_FILE, REQUIRABLE_SITE_METHODS, HOSTED_IMAGE_REASON, siteCapabilities, newRunProduction, createSiteProduction } from './site-production.mjs';
import { compareProduction } from '../plugin/server/production/compare.mjs';
import { runPair } from '../game/harness/run-pair.mjs';

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const validModes = ['baseline', 'qloo'];
export const creativeProtocols = ['taste', 'research'];
// Product-relevant extra domains; every starter also gets brands, film, music, books and TV.
export const TEMPLATE_TASTE_DOMAINS = { 'indie-game': ['videogame'], 'boutique-hotel': ['destination'] };
// Files outside the taste-led sequence; the host owns the brief and taste records.
const TASTE_BLOCKED_ARTIFACTS = ['culture-plan.json', 'culture-reconsideration.json', 'culture-research.json', 'culture-decisions.json', 'culture-revision.json', 'culture-preparation.json', 'culture-brief.json', 'culture-imported-context.json'];
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const portableWebSources = sources => (sources || []).map(({ provenance, reusedFrom, ...record }) => { void provenance; void reusedFrom; return record; });
const WEB_CAPTURE_BYTES = 64 * 1024;

/** Which recorded generated images the site files use, and which generated paths they reference that do not exist. */
function generatedImageUse(images, files) {
  const site = Object.entries(files || {}).filter(([file, content]) => typeof content === 'string' && !isCultureArtifactPath(file)).map(([, content]) => content).join('\n');
  const made = (images || []).map(image => image.path);
  const referenced = [...new Set(site.match(/generated\/[a-z0-9][a-z0-9_-]{0,60}\.(?:jpg|png)/gu) || [])];
  return { used: made.filter(item => site.includes(item)), unused: made.filter(item => !site.includes(item)), unknown: referenced.filter(item => !made.includes(item)).sort() };
}

/** What the Studio shows of a build's production stages: the methods both arms could choose, and what the study required. */
function publicProduction(production) {
  if (!production?.capabilities) return null;
  const { capabilities } = production, capture = capabilities.review.capture;
  return { medium: capabilities.medium, environment: capabilities.environment, required: production.required,
    methods: capabilities.methods.map(({ id, kind, layers, available, reason }) => ({ id, kind, layers, available, ...(reason ? { reason } : {}) })),
    capture: capture.available ? { available: true, views: capture.views, rounds: capture.rounds } : { available: false, reason: capture.reason } };
}

/** One run's reading, plan, reviews and captures, each capture with its preview address once the run is complete. */
function publicRunProduction(production, preview) {
  if (!production) return null;
  return { reading: production.reading, plan: production.plan, round: production.round, audit: production.audit,
    reviews: production.reviews.map(({ after, ...review }) => { void after; return review; }),
    captures: production.captures.map(({ id, view, round, width, height, target, full }) => ({ id, view, round, width, height, ...(target ? { target } : {}), ...(full ? { full } : {}),
      url: preview ? `${preview}__review/${id}.png` : null })) };
}

/** Keep a literal Unicode prefix; source IDs are assigned only to retained rows. */
function boundedWebSource(record, existing) {
  if (Buffer.byteLength(JSON.stringify([...existing, record]), 'utf8') <= WEB_CAPTURE_BYTES) return record;
  const limitation = [record.limitation, 'The literal excerpt was shortened to respect the aggregate 64 KiB web capture bound.'].filter(Boolean).join(' ').slice(0, 1200);
  const candidate = { ...record, truncated: true, limitation };
  const points = Array.from(record.excerpt || '');
  let low = 0, high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    candidate.excerpt = points.slice(0, middle).join('');
    if (Buffer.byteLength(JSON.stringify([...existing, candidate]), 'utf8') <= WEB_CAPTURE_BYTES) low = middle;
    else high = middle - 1;
  }
  if (!low) return null;
  candidate.excerpt = points.slice(0, low).join('');
  return candidate;
}

export class JobManager {
  constructor({ config, templates, getKiroStatus, workspaces, runner = runKiro, characterRunner = runPair, enforceResearchPhases = true, qlooClientFactory, imageGenerator = null, siteCapture = null, browser = null }) {
    this.config = config; this.templates = templates; this.getKiroStatus = getKiroStatus;
    this.qlooClientFactory = qlooClientFactory || (() => new QlooClient({ apiKey: config.qlooKey, baseUrl: config.qlooBaseUrl }));
    this.imageGenerator = imageGenerator;
    // The capture of a run's saved site for its review ({available, capture, label} or {available: false, reason}).
    this.siteCapture = siteCapture;
    // The browser the Studio checked at start (an inspectBrowser result), which character pairs capture with too.
    this.browser = browser;
    // Game character pairs share the queue; each running pair has its own cancellation controller.
    this.characterRunner = characterRunner; this.characterControllers = new Map();
    this.runner = runner; this.jobs = new Map(); this.bridgeSessions = new Map(); this.queue = []; this.draining = false; this.saves = new Map();
    this.closing = false;
    this.enforceResearchPhases = enforceResearchPhases;
    this.workspaces = workspaces;
    this.bridgeUrl = ''; this.previewBaseUrl = '';
  }
  async initialize() {
    await fs.mkdir(this.config.dataDir, { recursive: true });
    for (const item of await fs.readdir(this.config.dataDir, { withFileTypes: true })) {
      if (!item.isDirectory() || !/^[a-f0-9-]{36}$/.test(item.name)) continue;
      try {
        const job = JSON.parse(await fs.readFile(path.join(this.config.dataDir, item.name, 'meta.json'), 'utf8'));
        if (job.id !== item.name || !(job.kind === CHARACTER_KIND || this.templates.some(t => t.id === job.templateId)) || !Array.isArray(job.runs)) continue;
        if (['queued', 'running'].includes(job.status)) {
          job.status = 'failed'; job.error = 'The server restarted; start the incomplete job again.';
          for (const run of job.runs) if (['queued', 'running'].includes(run.status)) { run.status = 'failed'; run.error = job.error; }
        }
        this.jobs.set(job.id, job);
      } catch { /* Ignore incomplete metadata, never claim a recovered generation succeeded. */ }
    }
  }
  setUrls({ bridgeUrl, previewBaseUrl }) { this.bridgeUrl = bridgeUrl; this.previewBaseUrl = previewBaseUrl; }
  get(id) { const job = this.jobs.get(id); if (!job) throw new HttpError(404, 'Job not found.'); return job; }
  project(job, mode) { return new FileProject(path.join(this.config.dataDir, job.id, mode, 'site'), this.config); }
  /** Binary assets live beside the text-only project; callers pass a path checked against GENERATED_IMAGE_PATH. */
  assetPath(job, mode, relative) {
    if (!GENERATED_IMAGE_PATH.test(relative)) throw new Error('Invalid generated image path.');
    return path.join(this.config.dataDir, job.id, mode, 'assets', ...relative.split('/'));
  }
  imageStatus() {
    const generator = this.imageGenerator;
    // A hosted server offers no image generator, whatever is installed on it.
    if (this.config.environment === 'hosted') return { available: false, provider: null, reason: HOSTED_IMAGE_REASON };
    if (!generator) return { available: false, provider: null, reason: 'This Studio was started without image generation.' };
    return { available: Boolean(generator.available), provider: generator.provider || null, version: generator.version || null,
      ...(generator.available ? { perRun: IMAGE_LIMITS.perRun } : { reason: generator.reason || 'Image generation is unavailable.' }) };
  }
  /** Whether a new job can offer generated images: a generator is ready and this is not a hosted server. */
  imagesOffered() { return this.config.environment !== 'hosted' && Boolean(this.imageGenerator?.available); }
  captureStatus() {
    const capture = this.siteCapture;
    if (!capture?.available || typeof capture.capture !== 'function') return { available: false, reason: capture?.reason || 'This Studio was started without a browser to capture the site.' };
    return { available: true, label: capture.label || null };
  }
  /**
   * The production stages of a taste-led build: one capability list for both arms, fixed when the job is created, with
   * the methods a study requires of both. A required method must be available here, so the job stops before any request.
   */
  async siteProduction({ templateId, images, required = [] }) {
    if (!Array.isArray(required) || required.length > REQUIRABLE_SITE_METHODS.length || required.some(id => !REQUIRABLE_SITE_METHODS.includes(id))) {
      throw new HttpError(400, `A study can require ${REQUIRABLE_SITE_METHODS.join(', ')} of both designers.`);
    }
    const [fonts, library] = await Promise.all([loadFontLibrary(this.config.rootDir).catch(() => null), loadLibrary(this.config.rootDir, templateId).catch(() => null)]);
    const capture = this.captureStatus();
    try {
      const capabilities = siteCapabilities({ fonts: fonts ? { families: fonts.families.length } : null,
        photos: library ? { photos: library.images.length, licenses: [...new Set(library.images.map(image => image.license))] } : null,
        images, capture: capture.available, required: [...new Set(required)], environment: this.config.environment,
        reasons: { image: this.imageGenerator?.reason, capture: capture.reason } });
      return { medium: SITE_MEDIUM_ID, capabilities, required: capabilities.required };
    } catch (error) { throw new HttpError(400, error.message.replace(/^capabilities\.required\[\d+\]: /u, '')); }
  }
  async save(job) {
    const previous = this.saves.get(job.id) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const directory = path.join(this.config.dataDir, job.id);
      await fs.mkdir(directory, { recursive: true });
      const temporary = path.join(directory, 'meta.tmp');
      await fs.writeFile(temporary, JSON.stringify(job, null, 2), 'utf8');
      await fs.rename(temporary, path.join(directory, 'meta.json'));
    });
    this.saves.set(job.id, pending); return pending;
  }
  event(job, run, type, message) {
    run.events.push({ time: new Date().toISOString(), type, message: redact(message, this.config).slice(0, 350) });
    if (run.events.length > 180) run.events.shift();
  }
  publicJob(job) {
    if (job.kind === CHARACTER_KIND) return publicCharacterJob(job, this.previewBaseUrl);
    return {
      id: job.id, status: job.status, templateId: job.templateId, brief: job.brief,
      createdAt: job.createdAt, model: job.model, effort: job.effort, error: job.error, localization: job.localization || null,
      productBrief: job.productBrief || job.brief, revisionRequest: job.kind === 'revise' ? job.brief : null,
      kind: job.kind || 'build', workspaceId: job.workspaceId || null, cultureBrief: job.cultureBrief || normalizeCultureBrief({}),
      baseCultureBrief: job.baseCultureBrief || job.cultureBrief || normalizeCultureBrief({}),
      intendedKind: job.intendedKind || null, preparationJobId: job.preparationJobId || null,
      preparationResponse: job.preparationResponse || null, preparationRound: job.preparationRound || 0,
      parentJobId: job.parentJobId || null, parentMode: job.parentMode || null, planJobId: job.planJobId || null, planMode: job.planMode || null,
      directionId: job.directionId || null, audienceId: job.audienceId || null, targetSelector: job.targetSelector || null,
      protocol: job.protocol || 'research', taste: job.taste || null, tasteComparison: job.tasteComparison || null, images: job.images || null,
      production: publicProduction(job.production),
      runs: job.runs.map(run => {
        const base = ['build', 'revise'].includes(job.kind || 'build') ? `${this.previewBaseUrl}/preview/${job.id}/${run.mode}/${job.previewToken}/` : null;
        const preview = run.status === 'completed' ? base : null;
        // Review captures are shown as they are taken, while the run is still working.
        return { mode: run.mode, status: run.status, error: run.error, events: run.events,
          taste: run.taste || null, tastePipeline: run.tastePipeline || null, production: publicRunProduction(run.production, base),
          evidence: run.evidence, decisions: run.decisions, files: run.files,
          directions: run.directions || [], diff: run.diff || { files: [] }, preparation: run.preparation || null,
          researchDecisions: (run.researchDecisions || []).map(record => ({ ...record,
            verification: run.researchVerification?.find(check => check.id === record.id) || uncheckedResearchVerification(record) })), assessmentCalls: run.assessmentCalls || [],
          researchCalls: run.researchCalls || [], webCalls: run.webCalls || [], webSources: run.webSources || [],
          creativePipeline: run.creativePipeline || null, provisionalPlan: run.provisionalPlan || null, reconsideration: run.reconsideration || null,
          generatedImages: (run.generatedImages || []).map(image => ({ ...image, url: preview ? preview + image.path : null })),
          previewUrl: preview ? `${preview}index.html` : null,
        };
      }),
    };
  }
  /** Readiness shared by every paid job: Kiro, one fixed model, and room in the job store and the queue. */
  async paidRunModel({ qloo = true } = {}) {
    if (this.jobs.size >= this.config.maxJobs) throw new HttpError(429, 'This demo has reached its job limit. The administrator must archive older jobs.');
    if (this.queue.length >= 4) throw new HttpError(429, 'The generation queue is full. Try again when the current jobs finish.');
    const kiro = await this.getKiroStatus();
    if (!kiro.available || !kiro.authenticated) throw new HttpError(503, kiro.error || 'The Kiro session or API key is not ready.');
    const model = this.config.model || kiro.defaultModel;
    if (!model || !/^[a-zA-Z0-9._:/-]{1,120}$/.test(model)) throw new HttpError(503, 'Set KIRO_MODEL to use the same fixed model in both runs.');
    if (qloo && !this.config.qlooKey) throw new HttpError(503, 'A Qloo API key is required for cultural research and comparison.');
    return model;
  }
  enqueue(job) {
    this.jobs.set(job.id, job); this.queue.push(job.id);
    setImmediate(() => this.drain().catch(error => {
      job.status = 'failed'; job.error = redact(error.message, this.config); this.save(job).catch(() => {});
    }));
    return job;
  }
  /**
   * A game character pair: the Long Dusk world is fixed; the brief, its references, the audience's place and age, the
   * portraits per arm, the departure rule and any recorded profile to reuse or swap in are the request.
   */
  async createCharacter(input) {
    let request;
    try { request = characterRequest(input, { imagesAvailable: this.imagesOffered(), jobs: this.jobs }); } catch (error) { throw new HttpError(error.status || 400, error.message); }
    const model = await this.paidRunModel();
    const job = newCharacterJob({ request, model, effort: this.config.effort, images: this.imageGenerator });
    await this.save(job);
    return this.enqueue(job);
  }
  async create(input) {
    if (this.closing) throw new HttpError(503, 'The Studio server is shutting down.');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'A generation request is required.');
    if (input.kind === CHARACTER_KIND) return this.createCharacter(input);
    let { templateId, brief, mode, kind = 'build', workspaceId, parentJobId, parentMode, targetSelector, planJobId, planMode, directionId, audienceId, preparationJobId, preparationResponse, intendedKind = 'build' } = input;
    if (!['build', 'plan', 'revise', 'prepare'].includes(kind)) throw new HttpError(400, 'Choose a valid job type.');
    if (!['build', 'plan', 'revise'].includes(intendedKind)) throw new HttpError(400, 'Choose a valid preparation purpose.');
    if (kind === 'prepare' && mode !== 'baseline') throw new HttpError(400, 'Preparation runs without Qloo and requires baseline mode.');
    const explicitWorkspace = Boolean(workspaceId);
    const revisionContext = kind === 'revise' || (kind === 'prepare' && intendedKind === 'revise');
    const requestedParent = revisionContext && parentJobId ? this.get(parentJobId) : null;
    const preparationJob = preparationJobId ? this.get(preparationJobId) : null;
    const priorPreparation = preparationJob?.runs.find(run => run.status === 'completed' && run.preparation)?.preparation;
    if (preparationJobId && (preparationJob.kind !== 'prepare' || !priorPreparation)) throw new HttpError(400, 'A completed preparation is required.');
    if (preparationResponse && (kind !== 'prepare' || !preparationJobId)) throw new HttpError(400, 'A preparation answer requires its completed preparation.');
    if (preparationResponse) { try { preparationResponse = normalizePreparationResponse(preparationResponse); } catch (error) { throw new HttpError(400, error.message); } }
    if (kind === 'prepare' && preparationJobId && (!preparationResponse || priorPreparation.status !== 'needs_input')) throw new HttpError(400, 'Answer a preparation that is waiting for input.');
    if (preparationResponse?.type === 'references' && (preparationJob.preparationRound || 0) >= 1) throw new HttpError(400, 'The reference clarification round is complete. Choose an inspiration option, delegate, or continue without research.');
    workspaceId ||= requestedParent?.workspaceId || undefined;
    templateId ||= requestedParent?.templateId;
    const workspace = workspaceId ? this.workspaces?.get(workspaceId) : null;
    if (workspaceId && !workspace) throw new HttpError(404, 'Workspace not found.');
    templateId ||= workspace?.templateId; brief ??= workspace?.brief;
    if (workspace && templateId !== workspace.templateId) throw new HttpError(400, 'The workspace and starter site do not match.');
    if (typeof brief !== 'string' || brief.trim().length < 10 || brief.length > this.config.maxBriefLength) throw new HttpError(400, 'The design request must contain 10–3500 characters.');
    let cultureBrief;
    try { cultureBrief = normalizeCultureBrief(input.cultureBrief || (!explicitWorkspace && requestedParent?.cultureBrief) || workspace?.cultureBrief || requestedParent?.cultureBrief || {}); } catch (error) { throw new HttpError(400, error.message); }
    if (!Object.hasOwn(input, 'audienceId') && requestedParent?.audienceId && cultureBrief.audiences.some(a => a.id === requestedParent.audienceId)) audienceId = requestedParent.audienceId;
    if (audienceId && !cultureBrief.audiences.some(a => a.id === audienceId)) throw new HttpError(400, 'The selected audience was not found in the brief.');
    const baseCultureBrief = structuredClone(cultureBrief);
    if (preparationJob) {
      const sameContext = preparationJob.templateId === templateId && preparationJob.brief === brief.trim()
        && preparationJob.workspaceId === (workspaceId || null)
        && canonical(preparationJob.baseCultureBrief || preparationJob.cultureBrief) === canonical(baseCultureBrief)
        && (preparationJob.audienceId || null) === (audienceId || null)
        && (preparationJob.parentJobId || null) === (parentJobId || null)
        && (preparationJob.parentMode || null) === (parentMode || null)
        && (preparationJob.targetSelector || null) === (targetSelector || null);
      const purpose = kind === 'prepare' ? intendedKind : kind;
      const samePurpose = purpose === 'revise' ? preparationJob.intendedKind === 'revise' : preparationJob.intendedKind !== 'revise';
      if (!sameContext || !samePurpose) throw new HttpError(400, 'The brief or creative context has changed. Prepare the current context again.');
      if (kind !== 'prepare') {
        if (priorPreparation.status !== 'ready') throw new HttpError(400, 'Answer the preparation question before production.');
        cultureBrief = { ...cultureBrief, creativeContext: structuredClone(priorPreparation.creativeContext) };
      }
    }
    if (revisionContext && (!preparationJob || kind === 'prepare')) {
      const parentContext = requestedParent?.cultureBrief?.creativeContext;
      const parentBase = requestedParent?.baseCultureBrief?.creativeContext;
      if (parentContext && (!cultureBrief.creativeContext || canonical(cultureBrief.creativeContext) === canonical(parentBase))) {
        const inherited = structuredClone(parentContext);
        inherited.references = inherited.references.filter(ref => ref.role !== 'audience' || !ref.audienceId || cultureBrief.audiences.some(group => group.id === ref.audienceId && group.references.some(name => name.toLowerCase() === ref.name.toLowerCase())));
        cultureBrief = { ...cultureBrief, creativeContext: inherited };
      }
    }
    let selectedDirection = null;
    if (planJobId) {
      const plan = this.get(planJobId);
      const run = plan.runs.find(r => r.mode === (planMode || mode) && r.status === 'completed');
      if (plan.kind !== 'plan' || plan.templateId !== templateId || !run) throw new HttpError(400, 'A completed direction plan for the same starter is required.');
      if (plan.workspaceId !== (workspaceId || null)) throw new HttpError(400, 'The direction plan must belong to the same workspace.');
      if ((mode === 'baseline' || mode === 'compare') && run.mode === 'qloo') throw new HttpError(400, 'Qloo research cannot be transferred to baseline mode. Choose Qloo-enabled generation or an independent plan.');
      selectedDirection = run.directions?.find(d => d.id === directionId);
      if (!selectedDirection) throw new HttpError(400, 'Choose a creative direction from the plan.');
      if (plan.brief !== brief.trim() || canonical(plan.cultureBrief || normalizeCultureBrief({})) !== canonical(cultureBrief)) throw new HttpError(400, 'The brief has changed. Replan creative directions for the updated context.');
      planMode = run.mode;
    }
    if (revisionContext) {
      if (!parentJobId || !validModes.includes(parentMode) || mode === 'compare') throw new HttpError(400, 'A revision requires one completed variant.');
      const parent = this.get(parentJobId), run = parent.runs.find(r => r.mode === parentMode && r.status === 'completed');
      if (!run || !['build', 'revise'].includes(parent.kind || 'build') || parent.templateId !== templateId) throw new HttpError(400, 'The revision source must be a completed variant of the same site.');
      if (workspaceId && parent.workspaceId && parent.workspaceId !== workspaceId) throw new HttpError(400, 'A revision cannot use a source from another workspace.');
      if (kind !== 'prepare' && parentMode === 'qloo' && mode !== 'qloo') throw new HttpError(400, 'A Qloo-generated site cannot be used as a baseline starting point.');
      try { findHtmlTarget(await this.project(parent, parentMode).readFile('index.html'), targetSelector); } catch (error) { throw new HttpError(400, error.message); }
    }
    const template = this.templates.find(t => t.id === templateId);
    if (!template) throw new HttpError(400, 'Choose a valid starter site.');
    if (typeof brief !== 'string' || brief.trim().length < 10 || brief.length > this.config.maxBriefLength) throw new HttpError(400, 'The design request must contain 10–3500 characters.');
    if (!['baseline', 'qloo', 'compare'].includes(mode)) throw new HttpError(400, 'Choose a valid generation mode.');
    if (kind !== 'plan') {
      const sourceFiles = revisionContext ? await this.project(requestedParent, parentMode).exportFiles() : template.files;
      try { assertBrandLocks(sourceFiles, sourceFiles, cultureBrief.brand); } catch (error) { throw new HttpError(400, error.message); }
    }
    if (input.protocol !== undefined && !creativeProtocols.includes(input.protocol)) throw new HttpError(400, 'Choose the taste or research creative protocol.');
    // Preparation and scoped revision keep the research workflow; builds and plans follow the configured protocol.
    let protocol = ['build', 'plan'].includes(kind) ? input.protocol || this.config.creativeProtocol || 'research' : 'research';
    const planJob = planJobId ? this.get(planJobId) : null;
    if (planJob) {
      const planProtocol = planJob.protocol || 'research';
      if (input.protocol !== undefined && input.protocol !== planProtocol) throw new HttpError(400, 'A direction is built with the creative protocol of its plan.');
      protocol = planProtocol;
      if (protocol === 'taste' && mode !== planMode) throw new HttpError(400, 'A taste-led direction is built in the same mode as its plan, because it inherits that run\'s prediction and taste input.');
    }
    let taste = null;
    if (input.tasteSourceJobId !== undefined) {
      if (protocol !== 'taste' || mode === 'baseline' || planJob) throw new HttpError(400, 'A reused taste profile requires a taste-led Qloo run without a direction plan.');
      if (typeof input.tasteSourceJobId !== 'string' || !/^[a-f0-9-]{36}$/u.test(input.tasteSourceJobId)) throw new HttpError(400, 'Choose a valid taste profile source job.');
      if (!this.get(input.tasteSourceJobId).runs.some(run => run.mode === 'qloo' && run.taste?.profile?.status === 'ok')) throw new HttpError(400, 'The taste profile source needs a recorded Qloo taste profile.');
    }
    if (protocol === 'taste' && planJob) taste = { ...structuredClone(planJob.taste), inheritedFrom: { jobId: planJob.id, mode: planMode } };
    else if (protocol === 'taste') {
      const context = creativeContextForBrief(cultureBrief);
      const selection = selectTasteReferences(context.references, { audienceId });
      const audience = cultureBrief.audiences.find(group => group.id === audienceId) || (cultureBrief.audiences.length === 1 ? cultureBrief.audiences[0] : null);
      const location = audience?.location;
      const domains = [...DEFAULT_TASTE_DOMAINS, ...(TEMPLATE_TASTE_DOMAINS[templateId] || []), ...(location ? ['place'] : [])];
      taste = { version: '1.0', domains, requiredAnchorCount: TASTE_LIMITS.requiredAnchors, basis: selection.basis, references: selection.references,
        ...(location ? { location } : {}), knownNames: [...new Set([...context.references.map(ref => ref.name), ...cultureBrief.audiences.flatMap(group => group.references)])].slice(0, 40),
        ...(input.tasteSourceJobId ? { sourceJobId: input.tasteSourceJobId } : {}) };
      if (mode !== 'baseline' && !input.tasteSourceJobId) {
        if (context.referencePolicy === 'skip') throw new HttpError(400, 'Cultural research was skipped for this brief, so a taste-led Qloo run has no references. Generate with Qloo off, or prepare the brief again with references.');
        if (!selection.references.length) throw new HttpError(400, 'A taste-led Qloo run needs audience or inspiration references. Add references to an audience group or prepare the brief first.');
      }
    }
    // Both arms of a taste-led build share one image capability, fixed when the job is created.
    const images = protocol === 'taste' && kind === 'build' && this.imagesOffered()
      ? { provider: this.imageGenerator.provider, version: this.imageGenerator.version || null, perRun: IMAGE_LIMITS.perRun } : null;
    // With production stages they share the whole capability list, and a study setting can require a method of both.
    const staged = protocol === 'taste' && kind === 'build' && this.config.productionStages;
    if (input.required !== undefined && !staged) throw new HttpError(400, 'A study setting applies to a taste-led site build with production stages.');
    const production = staged ? await this.siteProduction({ templateId, images, required: input.required }) : null;
    const model = await this.paidRunModel({ qloo: mode !== 'baseline' });
    const productBrief = revisionContext ? (this.get(parentJobId).productBrief || this.get(parentJobId).brief) : brief.trim();
    const job = { id: crypto.randomUUID(), templateId, brief: brief.trim(), productBrief, model, effort: this.config.effort, status: 'queued', kind,
      workspaceId: workspaceId || null, cultureBrief, parentJobId: parentJobId || null, parentMode: parentMode || null,
      baseCultureBrief, intendedKind: kind === 'prepare' ? intendedKind : kind,
      preparationJobId: preparationJobId || null, preparationResponse: preparationResponse || null,
      preparationRound: kind === 'prepare' && preparationResponse?.type === 'references' ? (preparationJob.preparationRound || 0) + 1 : preparationJob?.preparationRound || 0,
      planJobId: planJobId || null, planMode: planMode || null, directionId: directionId || null, selectedDirection,
      audienceId: audienceId || null, targetSelector: targetSelector || null, protocol, taste, images, ...(production ? { production } : {}),
      createdAt: new Date().toISOString(), previewToken: crypto.randomBytes(24).toString('hex'), error: null,
      runs: (mode === 'compare' ? validModes : [mode]).map(mode => ({ mode, status: 'queued', error: null, events: [], evidence: [], decisions: [], directions: [], diff: { files: [] }, files: [], assessmentCalls: [], researchDecisions: [], researchCalls: [], preparation: null, webCalls: [], webSources: [], provisionalPlan: null, reconsideration: null,
        creativePipeline: protocol !== 'taste' && this.enforceResearchPhases && kind !== 'prepare' ? { version: '1.0', status: 'awaiting-plan', planSavedAt: null, researchStartedAt: null, reconsideredAt: null, constructionStartedAt: null, limitations: [] } : null,
        ...(protocol === 'taste' ? {
          tastePipeline: { version: '1.0', status: 'awaiting-prediction', predictedAt: null, revealedAt: null, specifiedAt: null, constructionStartedAt: null, limitations: [] },
          taste: { profile: null, assumption: null, input: null, dna: null, conformance: null, sketchDivergence: null, directionScores: null, selfChecks: 0 },
        } : {}), ...(production ? { production: newRunProduction() } : {}) })),
    };
    await this.save(job);
    return this.enqueue(job);
  }
  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const job = this.get(this.queue.shift());
        if (job.status === 'cancelled') continue;
        job.status = 'running'; await this.save(job);
        if (job.kind === CHARACTER_KIND) {
          await runCharacterJob(this, job, { runner: this.characterRunner });
          await this.save(job);
          continue;
        }
        // The taste pass runs before any paid model run, so a missing profile stops the whole comparison.
        const tasteReady = job.protocol !== 'taste' || await this.prepareTaste(job);
        for (const run of job.runs) {
          if (!tasteReady || job.status === 'cancelled' || this.closing) break;
          await this.execute(job, run);
        }
        const completed = job.runs.every(r => r.status === 'completed');
        // Metrics are recorded before the job reports completion, so a completed comparison always carries them.
        if (completed && job.status !== 'cancelled' && job.protocol === 'taste' && job.kind === 'build' && job.runs.length === 2) {
          try { job.tasteComparison = await this.tasteComparison(job); }
          catch { job.tasteComparison = null; this.event(job, job.runs[1], 'warning', 'The taste comparison metrics could not be computed; both generated sites remain available.'); }
        }
        if (job.status !== 'cancelled') {
          job.status = completed ? 'completed' : 'failed';
          // A failed taste pass explains why no run started; report it rather than the dependent run.
          job.error = (!tasteReady && job.runs.find(r => r.mode === 'qloo')?.error) || job.runs.find(r => r.error)?.error || null;
        }
        await this.save(job);
      }
    } finally { this.draining = false; }
  }
  async recordEvidence(job, run, evidence) {
    const id = `Q${String(run.evidence.length + 1).padStart(3, '0')}`;
    if (evidence.evidence) evidence.evidence.id = id;
    run.evidence.push({ ...evidence, id, time: new Date().toISOString() });
    this.event(job, run, 'qloo', `Qloo: ${evidence.results?.length || 0} results — ${id}`);
    await this.save(job);
  }
  recordResearchCall(run, { tool, input, meta, status, evidenceId, error }) {
    run.researchCalls ||= [];
    if (run.researchCalls.length >= 40) return;
    run.researchCalls.push({ tool, time: new Date().toISOString(), status, sourceRequestAttempted: true, origin: 'host-taste-pass', ...(meta ? { tastePass: meta } : {}),
      query: JSON.parse(redact(JSON.stringify(input ?? {}), this.config)), ...(evidenceId ? { evidenceId } : {}), ...(error ? { error } : {}) });
  }
  /** Host-run Qloo taste pass, or an explicitly reused profile for a manipulation check. Returns false when the job must stop. */
  async prepareTaste(job) {
    const run = job.runs.find(item => item.mode === 'qloo');
    if (!run || job.planJobId) return true;
    try {
      if (job.taste.sourceJobId) {
        const source = this.get(job.taste.sourceJobId);
        const sourceRun = source.runs.find(item => item.mode === 'qloo' && item.taste?.profile?.status === 'ok');
        if (!sourceRun) throw new Error('The reused taste profile is no longer available.');
        // Reused evidence keeps its original identity and retrieval time; the profile records its origin.
        run.evidence = structuredClone(sourceRun.evidence || []).map(record => ({ ...record, reusedFrom: { jobId: source.id, mode: 'qloo' } }));
        run.taste.profile = { ...structuredClone(sourceRun.taste.profile), reusedFrom: { jobId: source.id, mode: 'qloo' } };
        this.event(job, run, 'taste', `Reused the recorded Qloo taste profile of job ${source.id}; no new Qloo request was made.`);
      } else {
        this.event(job, run, 'taste', `Host taste pass: resolving ${job.taste.references.length} references and querying ${job.taste.domains.length} domains before any model run.`);
        await this.save(job);
        run.taste.profile = await buildTasteProfile({ client: this.qlooClientFactory(), references: job.taste.references, domains: job.taste.domains,
          location: job.taste.location, knownNames: job.taste.knownNames,
          onEvidence: record => this.recordEvidence(job, run, record), onCall: call => this.recordResearchCall(run, call) });
        this.event(job, run, 'taste', `Taste pass ${run.taste.profile.status}: ${run.taste.profile.entities.length} measured entities from ${run.taste.profile.calls} Qloo requests.`);
      }
      if (run.taste.profile.status !== 'ok') {
        throw new Error(run.taste.profile.status === 'unresolved' ? 'No brief reference resolved to a Qloo entity or tag, so this run has no measured taste input.'
          : 'Qloo returned too little taste signal to govern a design: fewer than two domains returned three or more entities.');
      }
      await this.save(job);
      return job.status !== 'cancelled';
    } catch (error) {
      if (job.status === 'cancelled') return false;
      run.status = 'failed'; run.tastePipeline.status = 'failed';
      run.error = `The Qloo taste pass failed before any model run: ${redact(error.message, this.config).slice(0, 600)}`;
      this.event(job, run, 'error', run.error);
      for (const other of job.runs) if (other !== run && other.status === 'queued') {
        other.status = 'failed'; other.error = 'Not started: the Qloo taste pass failed, so this comparison stopped before any model run.';
        if (other.tastePipeline) other.tastePipeline.status = 'failed';
      }
      await this.save(job);
      return false;
    }
  }
  async tasteComparison(job) {
    const arms = {};
    for (const run of job.runs) arms[run.mode] = { files: await this.project(job, run.mode).exportFiles(), dna: run.taste?.dna, input: run.taste?.input, conformance: run.taste?.conformance, sketchDivergence: run.taste?.sketchDivergence };
    // How each arm chose to make its site, from its production plan and its reviews.
    const made = job.production ? compareProduction({ baseline: job.runs.find(run => run.mode === 'baseline')?.production, qloo: job.runs.find(run => run.mode === 'qloo')?.production }) : null;
    const comparison = { ...compareTasteRuns(arms), ...(made ? { production: made, productionHeadline: made.headline } : {}) };
    // The words of the two sites, beside their tokens: facts are shared by design, so only the narrative is compared.
    const starter = this.templates.find(t => t.id === job.templateId)?.files['index.html'];
    const narrative = Object.fromEntries(job.runs.map(run => [run.mode, run.taste?.narrative || narrativeRetention(starter, arms[run.mode].files['index.html'])]));
    if (!narrative.baseline || !narrative.qloo) return comparison;
    const copy = { ...copyOverlap(starter, arms.baseline.files['index.html'], arms.qloo.files['index.html']), narrative };
    return { ...comparison, copy,
      copyHeadline: `The two sites share ${copy.shared} of ${copy.distinct} sentences word for word. Qloo on rewrote ${narrative.qloo.rewritten} of ${narrative.qloo.lines} starter narrative lines and Qloo off ${narrative.baseline.rewritten}.` };
  }
  /**
   * Taste-led protocol: prediction (frozen) -> taste input -> binding Design DNA -> construction -> conformance.
   * Both arms run this same sequence; only the taste input differs (Qloo profile vs the model's own prediction).
   */
  async executeTaste(job, run) {
    run.status = 'running';
    const directory = path.join(this.config.dataDir, job.id, run.mode);
    const project = this.project(job, run.mode);
    await fs.mkdir(project.directory, { recursive: true });
    const template = this.templates.find(t => t.id === job.templateId);
    for (const [file, content] of Object.entries(template.files)) await project.writeFile(file, content);
    const state = run.taste, pipeline = run.tastePipeline, domains = job.taste.domains;
    // Starter IDs never count as new structure when a surprise-anchored device must depart from the sketch.
    const starterIds = htmlElementIds(template.files['index.html']);
    // Builds in both arms read the same host photo library; a device may show only listed photos whose tags it translates.
    let library = null;
    if (job.kind === 'build') {
      try { library = await loadLibrary(this.config.rootDir, template.id); }
      catch (error) {
        run.status = 'failed'; pipeline.status = 'failed';
        run.error = `The host photo library could not be loaded, so no model run started: ${redact(error.message, this.config).slice(0, 600)}`;
        this.event(job, run, 'error', run.error); await this.save(job);
        return;
      }
      if (library) await project.writeFile('culture-library.json', JSON.stringify(libraryArtifact(library, template.files['index.html']), null, 2));
    }
    const libraryTokens = libraryForDna(library);
    // Plans and builds in both arms read the same host font library: the frozen sketch and the DNA name only its
    // families, and sites load them from local files, so the declared type is the type visitors see.
    let fontLibrary = null;
    try { fontLibrary = await loadFontLibrary(this.config.rootDir); }
    catch (error) {
      run.status = 'failed'; pipeline.status = 'failed';
      run.error = `The host font library could not be loaded, so no model run started: ${redact(error.message, this.config).slice(0, 600)}`;
      this.event(job, run, 'error', run.error); await this.save(job);
      return;
    }
    if (fontLibrary) await project.writeFile('culture-fonts.json', JSON.stringify(fontsArtifact(fontLibrary), null, 2));
    const fontTokens = fontLibrary ? fontsForDna(fontLibrary) : undefined;
    // Generated images, when the job offers them, come from a saved imagery device: the host writes every prompt.
    const images = job.kind === 'build' && job.images && this.imageGenerator?.available ? this.imageGenerator : null;
    let imageAttempts = 0, hostWait = { pause() {}, resume() {} };
    // Generation still in progress when the run ends is stopped, so no Codex process outlives its job.
    const imageTasks = new Set(), imageController = new AbortController();
    // The production stages, when the build has them: the capability list both arms read, then the model's own reading
    // of the taste input, its production plan and its review of captures of the saved site.
    const production = job.production && run.production ? createSiteProduction({ capabilities: job.production.capabilities, production: run.production, pipeline, project, directory,
      capture: job.production.capabilities.review.capture.available ? this.siteCapture : null, input: () => state.input, dna: () => state.dna,
      event: (type, message) => this.event(job, run, type, message), save: () => this.save(job), hostWait: () => hostWait, imagesInProgress: () => imageTasks.size,
      sources: () => ({ assets: path.join(directory, 'assets'), images: run.generatedImages || [], library, fonts: fontLibrary }) }) : null;
    if (production) await project.writeFile(CAPABILITIES_FILE, JSON.stringify(job.production.capabilities, null, 2));
    // Names an image subject must not use: this run's taste entities and the names the brief already gives. Style and
    // aesthetic tags and shared qualities are qualities, not works, so they stay in subjects and art direction.
    const tasteNames = () => [...(state.input?.entities || []).filter(entity => !isQualityDomain(entity?.domain)).map(entity => entity?.name),
      ...(state.input?.seeds || []).flatMap(seed => [seed?.name, seed?.matchedName]), ...(job.taste.knownNames || [])].filter(name => typeof name === 'string');
    const inherited = Boolean(job.planJobId);
    const requiredRefs = inherited && Array.isArray(job.selectedDirection?.anchors) ? job.selectedDirection.anchors.map(anchor => anchor.ref) : undefined;
    // The artifact's own medium, such as games for a game site, leads the required works when the input has qualities.
    const medium = TEMPLATE_TASTE_DOMAINS[job.templateId] || [];
    const buildInput = () => run.mode === 'qloo'
      ? tasteInputFromProfile(state.profile, state.assumption, { requiredCount: job.taste.requiredAnchorCount, requiredRefs, medium })
      : tasteInputFromAssumption(state.assumption, { requiredCount: job.taste.requiredAnchorCount, requiredRefs, medium });
    // The profile's entities are repeated, with surprise flags, in input.entities; the job record keeps the full profile.
    const recordProfile = ({ entities, ...profile }) => ({ ...profile, entityCount: Array.isArray(entities) ? entities.length : 0 });
    const tasteRecord = () => ({ schemaVersion: '1.0', protocol: 'taste', mode: run.mode, source: state.input?.source || null, domains,
      ...(state.profile ? { profile: recordProfile(state.profile) } : {}), assumption: state.assumption, input: state.input, dna: state.dna, conformance: state.conformance,
      ...(state.narrative ? { narrative: state.narrative } : {}),
      ...(state.directionScores ? { directionScores: state.directionScores } : {}),
      // Each generated image keeps the host prompt it was made from, so the site's provenance travels with it.
      ...(run.generatedImages?.length ? { generatedImages: run.generatedImages.map(({ path: file, device, subject, aspect, prompt, provider, version, width, height, used }) =>
        ({ path: file, device, subject, aspect, prompt, provider, version, width, height, ...(used === undefined ? {} : { used }) })) } : {}),
      ...(production ? { production: production.record() } : {}),
      interpretation: run.mode === 'qloo' ? 'Qloo entities are host-recorded cultural relationships. Every design device is the agent\'s interpretation of them.'
        : 'This run had no measured taste data. Its taste input is the agent\'s own prediction.' });
    const writeTasteRecord = () => project.writeFile('culture-taste.json', tasteRecordText(tasteRecord(), project.limits.maxFileBytes));
    if (inherited) {
      const planRun = this.get(job.planJobId).runs.find(item => item.mode === job.planMode);
      state.assumption = structuredClone(planRun.taste.assumption);
      if (run.mode === 'qloo') {
        state.profile = { ...structuredClone(planRun.taste.profile), reusedFrom: { jobId: job.planJobId, mode: job.planMode } };
        run.evidence = structuredClone(planRun.evidence || []).map(record => ({ ...record, reusedFrom: { jobId: job.planJobId, mode: job.planMode } }));
      }
      state.input = buildInput();
      Object.assign(pipeline, { predictedAt: planRun.tastePipeline?.predictedAt || new Date().toISOString(), revealedAt: new Date().toISOString(), status: 'revealed' });
      pipeline.limitations.push('The prediction and taste input were inherited from the planning run; the selected direction\'s anchors are the required anchors.');
      await project.writeFile('culture-assumption.json', JSON.stringify(state.assumption, null, 2));
      await writeTasteRecord();
    }
    const { importedResearch, researchDecisions: authoredResearch, webSources: authoredWebSources, ...operationalBrief } = job.cultureBrief;
    void authoredResearch; void authoredWebSources;
    // Blind until the prediction is saved: no taste-pass evidence or imported research is visible to the agent.
    const contextArtifact = { schemaVersion: '1.0', product: { name: template.name, templateId: template.id, brief: job.productBrief || job.brief },
      ...operationalBrief, selectedDirection: job.selectedDirection || undefined, audienceId: job.audienceId || undefined,
      evidence: [], decisions: [], researchDecisions: [], webSources: [], provenance: 'taste-protocol-blind-until-prediction' };
    await project.writeFile('culture-brief.json', JSON.stringify(contextArtifact, null, 2));
    const beforeFiles = await project.exportFiles();
    const originalHash = await project.fingerprint();
    const controller = new AbortController();
    const bridgeToken = crypto.randomBytes(32).toString('hex');
    let calls = 0, writeChain = Promise.resolve();
    const reply = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    const phaseError = (message, code = 'TASTE_PHASE_REQUIRED') => ({ content: [{ type: 'text', text: message }], structuredContent: { status: 'blocked', error: { code, message, retryable: false } }, isError: true });
    const artifactError = (file, error) => {
      const message = `Invalid ${file}: ${redact(error.message, this.config).slice(0, 700)} Correct the reported field and save it again.`;
      this.event(job, run, 'warning', `Rejected invalid ${file}; the agent can correct it.`);
      return { content: [{ type: 'text', text: message }], structuredContent: { status: 'error', error: { code: 'CULTURE_ARTIFACT_INVALID', message, retryable: false } }, isError: true };
    };
    const underlying = createToolHandler({ project, includeQlooTools: false, protocol: 'taste' });
    const measuredTags = domain => state.input.entities.filter(entity => entity.domain === domain && entity.source === 'qloo').length;
    const reveal = async () => {
      if (!pipeline.revealedAt) {
        pipeline.revealedAt = new Date().toISOString(); pipeline.status = 'revealed';
        await writeTasteRecord();
        const metrics = state.input.metrics;
        this.event(job, run, 'taste', run.mode === 'qloo'
          ? `Taste profile revealed after the prediction was frozen: ${metrics.surprises} of ${metrics.measuredEntities} measured entities were neither predicted nor named in the brief.${metrics.measuredTags ? ` Qloo also measured ${measuredTags('style')} style and ${measuredTags('aesthetic')} aesthetic tags; ${metrics.tagSurprises} were not predicted.` : ''}` +
            (metrics.measuredQualities ? ` The measured works share ${metrics.measuredQualities} look, mood and meaning qualities; ${metrics.qualitySurprises} were not predicted.` : '')
          : 'The agent\'s own prediction became its taste input; no measured taste data exists in this run.');
        await this.save(job);
      }
      // Each tag domain is measured or not on its own: a pass can return style tags but no aesthetic tags. A measured
      // ranking that returned nothing gives way to the measured qualities of the nearest family, as the DNA check does.
      const tags = state.input.entities.some(entity => isTagDomain(entity.domain)), measured = domain => measuredTags(domain) > 0;
      const derived = family => run.mode === 'qloo' && state.input.entities.some(entity => entity.domain === QUALITY_DOMAIN && entity.source === 'qloo' && entity.family === family);
      const target = (domain, family, article) => measured(domain) ? `a measured ${domain} ref` : derived(family) ? `a measured ${family} quality` : `${article} ${domain} ref`;
      const qualities = state.input.entities.some(entity => entity.domain === QUALITY_DOMAIN && (run.mode !== 'qloo' || entity.source === 'qloo'));
      return reply({ status: 'revealed', ...compactTasteInput(state.input),
        guidance: (run.mode === 'qloo' ? 'Anchor devices to refs. Surprises are measured entities, tags or qualities you did not predict and the brief did not name.' : 'No measured taste data exists in this run. Anchor devices to your own predicted refs.')
          + (tags ? ` Style and aesthetic refs are qualities, not works: anchor a motion device to ${target('style', 'mood', 'a')} and an SVG illustration to ${target('aesthetic', 'look', 'an')}.` : '')
          + (qualities ? (run.mode === 'qloo'
            ? ' Refs in the qualities domain are look, mood and meaning tags that two or more measured works share: anchor the palette and the typography device each to a measured quality, style or aesthetic ref, and treat entities as evidence of the qualities.'
            : ' Refs in the qualities domain are the qualities you predicted the audience\'s favorite works share: anchor the palette and the typography device each to one of your quality, style or aesthetic refs.') : ''),
        ...(production && job.kind === 'build' ? { next: `Save ${READING_FILE} before the DNA: two to four clusters of refs that belong together, each resting on a quality, the refs you set aside as noise with a reason, and how the site will carry the clusters. Together the clusters carry palette, typography and voice.` } : {}) });
    };
    const executeTool = async (name, args) => {
      if (controller.signal.aborted || run.status !== 'running') return { content: [{ type: 'text', text: 'This job is no longer active.' }], isError: true };
      if (++calls > 100) return { content: [{ type: 'text', text: 'The per-job tool limit was reached.' }], isError: true };
      if (name.startsWith('qloo_') || name.startsWith('studio_web')) return phaseError('In the taste-led protocol the host runs the only Qloo taste pass. Save culture-assumption.json, then read the taste input with project_get_taste.');
      if (name === 'project_get_research') return phaseError('project_get_research belongs to the research protocol. Use project_get_taste.');
      if (['project_get_taste', 'project_check_dna'].includes(name) && args && typeof args === 'object' && Object.keys(args).length) return phaseError(`${name} accepts an empty argument object only.`, 'TOOL_INPUT_INVALID');
      if (name === 'project_get_taste') {
        if (!state.assumption) return reply({ status: 'awaiting-prediction', domains, requiredAnchorCount: requiredRefs ? requiredRefs.length : job.taste.requiredAnchorCount,
          instructions: 'Save culture-assumption.json with your own prediction for these domains first. Taste data is revealed only after the prediction is frozen.' });
        return reveal();
      }
      if (name === 'project_check_dna') {
        if (!state.dna) return phaseError('Save a valid culture-dna.json before checking conformance.');
        const files = await project.exportFiles();
        const report = checkDnaConformance(state.dna, files, { library: library ? libraryTokens : undefined, fonts: fontTokens });
        if (images) report.generatedImages = generatedImageUse(run.generatedImages, files);
        // Starter narrative still on the page word for word; facts are not listed because they never change.
        const narrative = narrativeRetention(beforeFiles['index.html'], files['index.html']);
        if (narrative) report.narrative = { lines: narrative.lines, rewritten: narrative.rewritten, kept: narrative.kept,
          note: narrative.kept.length ? 'These starter lines are still word for word on the page. Rewrite any that do not fit your voice device; product facts stay as they are.' : 'Every starter narrative line is in your own words.' };
        state.selfChecks = (state.selfChecks || 0) + 1;
        this.event(job, run, 'conformance', `DNA self-check: ${report.present} present, ${report.partial} partial, ${report.missing} missing.`);
        // The check is what a capture shows: the review captures the site files this check measured.
        production?.checked(report);
        return reply(report);
      }
      if (name === 'project_capture_review') return production ? production.capture(args) : phaseError('Capture is not available in this run.', 'TOOL_UNKNOWN');
      const file = name === 'project_write_file' && typeof args?.path === 'string' ? args.path.replaceAll('\\', '/') : null;
      let staged = null, startsConstruction = false;
      if (file !== null) {
        // Case-insensitive file systems would otherwise let a differently cased name replace a host record.
        if (file !== file.toLowerCase() && isCultureArtifactPath(file.toLowerCase())) return phaseError(`Use the exact lowercase artifact name ${file.toLowerCase()}.`);
        if (['culture-taste.json', 'culture-library.json', 'culture-fonts.json', CAPABILITIES_FILE].includes(file)) return phaseError(`${file} is written by the host.`);
        if (TASTE_BLOCKED_ARTIFACTS.includes(file)) return phaseError(`${file} is not part of the taste-led protocol. Save culture-assumption.json, ${job.kind === 'plan' ? 'culture-directions.json' : 'culture-dna.json and site files'} only.`);
        if (file === 'culture-assumption.json') {
          if (state.assumption) return phaseError('culture-assumption.json is frozen; a prediction cannot change after it is saved.');
          try { staged = normalizeTasteAssumption(args.content, { domains, requireSketch: true, fonts: fontTokens }); } catch (error) { return artifactError(file, error); }
        } else if ([READING_FILE, PLAN_FILE, REVIEW_FILE].includes(file)) {
          if (!production) return phaseError(`${file} is not part of the taste-led protocol.`);
          const outcome = await production.stage(file, args?.content);
          if (outcome.blocked) return phaseError(outcome.blocked, outcome.code);
          if (outcome.invalid) return artifactError(file, outcome.invalid);
          staged = outcome.staged;
        } else if (file === 'culture-dna.json') {
          if (job.kind !== 'build') return phaseError('Direction planning saves culture-directions.json, not a Design DNA.');
          if (!state.assumption || !pipeline.revealedAt) return phaseError('Save culture-assumption.json and read project_get_taste before compiling the Design DNA.');
          if (pipeline.constructionStartedAt) return phaseError('The Design DNA is frozen once construction starts.');
          const gate = production?.gateDna();
          if (gate) return phaseError(gate);
          // With production stages the reading binds the DNA: it anchors only to refs the reading kept.
          try { staged = normalizeDesignDna(production ? production.bindDna(args.content) : args.content, { input: state.input, sketch: state.assumption.designSketch, existingIds: starterIds, library: libraryTokens, fonts: fontTokens }); } catch (error) { return artifactError(file, error); }
          // A build that generates images requests them from an imagery device, so the DNA must have one. With production
          // stages generation is a method a plan may choose, so the DNA needs one only when the study requires pictures.
          if ((production ? job.production.required.includes('generated-image') : images) && !staged.devices.some(device => device.layer === 'imagery')) {
            return artifactError(file, new Error(production ? 'dna.devices: This study requires generated images in both arms, so include at least one imagery device and plan it with generated-image. Its name, colors and qualities become the art direction of the pictures you request.'
              : 'dna.devices: This build generates images, so include at least one imagery device. Its name, colors and qualities become the art direction of the images you request.'));
          }
        } else if (file === 'culture-directions.json') {
          if (job.kind !== 'plan') return phaseError('Only direction planning saves culture-directions.json.');
          if (!state.assumption || !pipeline.revealedAt) return phaseError('Save culture-assumption.json and read project_get_taste before proposing directions.');
          try {
            const directions = normalizeTasteDirections(args.content, { input: state.input, audiences: job.cultureBrief.audiences });
            staged = { directions, scores: scoreTasteDirections(directions, { input: state.input }) };
          } catch (error) { return artifactError(file, error); }
        } else if (isCultureArtifactPath(file)) return phaseError(`${file} is not part of the taste-led protocol.`);
        else {
          if (job.kind !== 'build') return phaseError('Direction planning does not change site files.');
          if (!state.dna) return phaseError('Save a valid culture-dna.json before writing site files. The Design DNA is the binding specification for construction.');
          // Images come before the site, so the build is composed around the pictures the host returns; a failed request also counts.
          // With production stages that holds when the plan generates pictures, and the plan comes before any site file.
          const gate = production ? production.gateSite({ images: Boolean(images), attempts: imageAttempts })
            : images && !imageAttempts ? 'This build generates images: request at least one with project_generate_image from an imagery device of your DNA before writing site files, then build the site around the images it returns.' : null;
          if (gate) return phaseError(gate);
          // The narrative is the DNA's to write, the catalogue facts are not: a page that changes them is refused before it lands.
          if (file === 'index.html') { try { assertStarterFacts(beforeFiles['index.html'], args?.content); } catch (error) { return artifactError(file, error); } }
          startsConstruction = true;
        }
      }
      const result = await underlying(name, args);
      let extra = null;
      if (file !== null && !result.isError) {
        const now = new Date().toISOString();
        if (file === 'culture-assumption.json') {
          state.assumption = staged; state.input = buildInput();
          Object.assign(pipeline, { predictedAt: now, status: 'predicted' });
          this.event(job, run, 'taste', `Prediction frozen: ${staged.entries.length} entities across ${domains.length} domains.`);
        } else if (file === 'culture-dna.json') {
          state.dna = staged; Object.assign(pipeline, { specifiedAt: now, status: 'specified' });
          this.event(job, run, 'taste', `Design DNA saved: ${staged.devices.length} devices across ${staged.stats.layers.length} layers; ${staged.stats.surpriseAnchoredDevices} rest on entities the model did not predict.`);
          if (production) {
            await production.afterDna();
            extra = { next: `Save ${PLAN_FILE}: one step per device, each with a method ${CAPABILITIES_FILE} lists as available for its layer.` };
          }
        } else if (file === 'culture-directions.json') {
          run.directions = staged.directions; state.directionScores = staged.scores; Object.assign(pipeline, { specifiedAt: now, status: 'specified' });
          this.event(job, run, 'taste', staged.scores.recommendedId ? `Directions saved; measured Qloo support is highest for ${staged.scores.recommendedId}.` : 'Directions saved from the model\'s own prediction.');
        } else if ([READING_FILE, PLAN_FILE, REVIEW_FILE].includes(file)) extra = await production.commit(file, staged);
        if (startsConstruction && !pipeline.constructionStartedAt) Object.assign(pipeline, { constructionStartedAt: now, status: 'constructing' });
        if (startsConstruction) production?.siteWritten();
        this.event(job, run, 'file', `Saved: ${file}`);
        await this.save(job);
        if (extra) return reply({ ...result.structuredContent, ...extra });
      } else if (name === 'project_read_file' && !result.isError) this.event(job, run, 'file', `Read: ${args.path}`);
      else if (name === 'project_list_files' && !result.isError) this.event(job, run, 'file', 'Listed the starter site files.');
      else if (result.isError) this.event(job, run, 'warning', `${name}: ${result.structuredContent?.error?.code || 'TOOL_EXECUTION_FAILED'} — the tool request could not be completed.`);
      return result;
    };
    const inactive = () => ({ content: [{ type: 'text', text: 'This job is no longer active.' }], isError: true });
    // Runs in the write queue: checks the request against the saved DNA and freezes the DNA like the first site file.
    const prepareImage = async args => {
      if (controller.signal.aborted || run.status !== 'running') return inactive();
      if (++calls > 100) return { content: [{ type: 'text', text: 'The per-job tool limit was reached.' }], isError: true };
      if (!images) return phaseError('Image generation is not available in this run.', 'TOOL_UNKNOWN');
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['device', 'subject', 'aspect'].includes(key))) return phaseError('project_generate_image accepts device, subject and an optional aspect only.', 'TOOL_INPUT_INVALID');
      if (!state.dna) return phaseError('Save a valid culture-dna.json with an imagery device before requesting images; the host writes each prompt from that device.');
      // With production stages a picture is requested only as the plan states it: for a generated-image step, up to its count.
      const planned = production?.gateImage(typeof args.device === 'string' ? args.device : '');
      if (planned) { this.event(job, run, 'warning', `Refused an image request the production plan does not make. ${planned}`); return phaseError(planned, 'TOOL_INPUT_INVALID'); }
      let request;
      try { request = buildImagePrompt({ dna: state.dna, names: tasteNames(), device: args.device, subject: args.subject, aspect: args.aspect ?? 'landscape', attempts: imageAttempts }); }
      catch (error) {
        if (!(error instanceof ImageRequestError)) throw error;
        this.event(job, run, 'warning', `Rejected an image request; the agent can correct it. ${error.message}`);
        return phaseError(error.message, 'TOOL_INPUT_INVALID');
      }
      imageAttempts++;
      production?.imageRequested(request.device);
      if (!pipeline.constructionStartedAt) Object.assign(pipeline, { constructionStartedAt: new Date().toISOString(), status: 'constructing' });
      return { ...request, name: `${request.device.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')}-${imageAttempts}` };
    };
    const produceImage = async request => {
      this.event(job, run, 'image', `Generating ${request.name} from ${request.device}; the host wrote the prompt from that device.`);
      await this.save(job);
      let result;
      hostWait.pause();
      try { result = await images.generate({ prompt: request.prompt, directory: path.join(directory, 'assets', 'generated'), name: request.name, signal: AbortSignal.any([controller.signal, imageController.signal]) }); }
      catch (error) {
        if (controller.signal.aborted || run.status !== 'running') return inactive();
        const message = redact(error.message, this.config).slice(0, 400);
        this.event(job, run, 'warning', `Image ${request.name} was not generated: ${message}`);
        await this.save(job);
        // A planned picture falls back to the method its step names; without a plan, to the photos and drawings any build has.
        const fallback = run.production?.plan?.steps.find(step => step.device === request.device)?.fallback;
        return { content: [{ type: 'text', text: `The image could not be generated: ${message} ${fallback ? `Make ${request.device} with the fallback your plan names, ${fallback}, unless the step's count allows another request.` : `Continue with ${library ? 'library photos or ' : ''}original SVG and CSS imagery.`}` }],
          structuredContent: { status: 'error', error: { code: 'IMAGE_GENERATION_FAILED', message, retryable: false } }, isError: true };
      } finally { hostWait.resume(); }
      if (controller.signal.aborted || run.status !== 'running') return inactive();
      if (!GENERATED_IMAGE_PATH.test(result?.path || '')) throw new Error('The image generator returned an invalid path.');
      const record = { path: result.path, device: request.device, subject: request.subject, aspect: request.aspect, prompt: request.prompt,
        provider: images.provider, version: images.version || null, format: result.format, width: result.width, height: result.height, bytes: result.bytes,
        durationMs: result.durationMs, description: result.description || '', createdAt: new Date().toISOString() };
      (run.generatedImages ||= []).push(record);
      this.event(job, run, 'image', `Generated ${record.path} from ${record.device} in ${Math.round(record.durationMs / 1000)} s.`);
      await this.save(job);
      return reply({ status: 'generated', path: record.path, width: record.width, height: record.height, aspect: record.aspect, device: record.device,
        ...(record.description ? { description: record.description } : {}),
        use: 'Reference this relative path as an img src with this width and height, or in a CSS url(), and write the alt text from the description.' });
    };
    // Ordered with the DNA and site writes, while generation itself runs outside that queue, so writes never wait for an image.
    const requestImage = async args => {
      const prepared = writeChain.then(() => prepareImage(args));
      writeChain = prepared.catch(() => {});
      const request = await prepared;
      if (request.isError) return request;
      const task = produceImage(request);
      imageTasks.add(task);
      task.finally(() => imageTasks.delete(task)).catch(() => {});
      return task;
    };
    const handle = (name, args) => {
      if (name === 'project_generate_image') return requestImage(args);
      if (!['project_write_file', 'project_get_taste', 'project_check_dna', 'project_capture_review'].includes(name)) return executeTool(name, args);
      // Prediction, reveal, DNA, site writes and captures form one ordered sequence.
      const pending = writeChain.then(() => executeTool(name, args));
      writeChain = pending.catch(() => {});
      return pending;
    };
    this.bridgeSessions.set(bridgeToken, { handle, controller, jobId: job.id });
    this.event(job, run, 'started', `Processing an independent starter copy with ${job.model} under the taste-led protocol.`);
    await this.save(job);
    try {
      await this.runner({ directory, config: this.config, model: job.model,
        prompt: makeTastePrompt({ template, brief: job.brief, mode: run.mode, kind: job.kind, cultureBrief: job.cultureBrief, audienceId: job.audienceId, selectedDirection: job.selectedDirection,
          domains, requiredAnchorCount: requiredRefs ? requiredRefs.length : job.taste.requiredAnchorCount, inheritedPrediction: inherited, photoLibrary: library ? { photos: library.images.length } : null,
          imageGeneration: images ? { perRun: IMAGE_LIMITS.perRun } : null, fontLibrary: fontLibrary ? { families: fontLibrary.families.length } : null,
          production: production ? { capabilities: job.production.capabilities, rounds: production.rounds } : null }),
        bridgeUrl: this.bridgeUrl, bridgeToken, kind: job.kind, mode: run.mode, protocol: 'taste', images: Boolean(images), signal: controller.signal,
        // The production stages add the policy's stages and, when the site can be captured, the read tool for the captures.
        production: Boolean(production), review: Boolean(production?.rounds),
        registerHostWait: wait => { hostWait = wait; },
        onEvent: event => this.event(job, run, event.type, event.message),
        project, onEvidence: evidence => this.recordEvidence(job, run, evidence), job, // dependency-injected test runner only; production runner ignores these.
      });
      await writeChain;
      // An image the agent stopped waiting for still finishes, or fails, before the site is checked.
      await Promise.allSettled([...imageTasks]);
      if (controller.signal.aborted) throw new Error('The job was cancelled.');
      if (!state.assumption) throw new Error('The taste-led protocol was not followed: no prediction (culture-assumption.json) was saved before the taste input.');
      if (!pipeline.revealedAt) throw new Error('The taste-led protocol was not followed: the taste input was never read with project_get_taste.');
      let cited;
      if (job.kind === 'plan') {
        if (!run.directions?.length) throw new Error('No valid culture-directions.json was saved; there are no directions to choose from.');
        cited = run.directions.map(direction => ({ evidenceIds: direction.anchors.map(anchor => anchor.evidenceId).filter(Boolean), anchorEntityIds: direction.anchors.map(anchor => anchor.entityId).filter(Boolean) }));
      } else {
        if (!state.dna) throw new Error('No valid culture-dna.json was saved; the site has no binding taste specification.');
        if ((await project.readFile('index.html')).trim().length < 100) throw new Error('Kiro did not save a usable HTML page.');
        const afterFiles = await project.exportFiles();
        const changedSite = Object.keys(afterFiles).some(file => !isCultureArtifactPath(file) && afterFiles[file] !== beforeFiles[file]);
        if (!changedSite || await project.fingerprint() === originalHash) throw new Error('Kiro did not change the site files; generation is incomplete.');
        assertBrandLocks(beforeFiles, afterFiles, job.cultureBrief.brand);
        assertStarterFacts(beforeFiles['index.html'], afterFiles['index.html']);
        state.conformance = checkDnaConformance(state.dna, afterFiles, { library: library ? libraryTokens : undefined, fonts: fontTokens });
        state.sketchDivergence = sketchDivergence(state.assumption.designSketch, afterFiles, { existingIds: starterIds });
        state.narrative = narrativeRetention(beforeFiles['index.html'], afterFiles['index.html']);
        if (state.narrative) this.event(job, run, 'taste', `Narrative: ${state.narrative.rewritten} of ${state.narrative.lines} starter lines rewritten in the DNA's voice; the product facts are unchanged.`);
        if (!state.conformance.meetsThreshold) this.event(job, run, 'warning', `DNA conformance ${state.conformance.score} is below ${state.conformance.threshold}: some declared devices are missing from the saved files.`);
        if (state.conformance.photos?.unknown.length) this.event(job, run, 'warning', `The site references photos the library does not contain, which will not load: ${state.conformance.photos.unknown.slice(0, 6).join(', ')}.`);
        if (state.conformance.fonts?.unknown.length) this.event(job, run, 'warning', `The site references font files the font library does not contain, which will not load: ${state.conformance.fonts.unknown.slice(0, 6).join(', ')}.`);
        const motion = state.conformance.motion;
        if (motion.undefined.length) this.event(job, run, 'warning', `The site animates with keyframes it never defines: ${motion.undefined.slice(0, 6).join(', ')}.`);
        if (motion.used.length && !motion.reducedMotion) this.event(job, run, 'warning', 'The site animates without a prefers-reduced-motion fallback.');
        if (motion.infinite.length && !motion.pauseControl) this.event(job, run, 'warning', `The site loops ${motion.infinite.slice(0, 4).join(', ')} without end but has no data-motion-toggle pause control.`);
        if (images) {
          const use = state.conformance.generatedImages = generatedImageUse(run.generatedImages, afterFiles);
          for (const image of run.generatedImages || []) image.used = use.used.includes(image.path);
          if (use.unknown.length) this.event(job, run, 'warning', `The site references generated images that do not exist, which will not load: ${use.unknown.slice(0, 6).join(', ')}.`);
          if (use.unused.length) this.event(job, run, 'warning', `${use.unused.length} generated image${use.unused.length === 1 ? ' is' : 's are'} not used by the saved site: ${use.unused.join(', ')}.`);
        }
        // Which captures the reviews cite were opened, from the Kiro session record, and whether the site changed after the last review.
        if (production) {
          const audit = await production.finish();
          if (audit.rounds) this.event(job, run, 'review', audit.audited ? `Review audit: the session opened ${audit.opened.length} of the ${audit.cited.length} captures its reviews cite.` : 'Review audit: no Kiro session record to audit, so the reviews are recorded as unaudited.');
        }
        run.decisions = dnaDecisions(state.dna, state.input);
        run.diff = { files: fileDiff(beforeFiles, afterFiles) };
        cited = run.decisions;
      }
      const portable = portableTasteRecords({ evidence: run.evidence, decisions: cited });
      contextArtifact.evidence = portable.evidence; contextArtifact.decisions = job.kind === 'plan' ? [] : portable.decisions;
      contextArtifact.provenance = run.mode === 'qloo' ? 'studio-recorded-qloo-taste-profile' : 'model-prediction-and-interpretation';
      await project.writeFile('culture-brief.json', JSON.stringify(contextArtifact, null, 2));
      if (importedResearch) await project.writeFile('culture-imported-context.json', JSON.stringify(importedResearch, null, 2));
      await writeTasteRecord();
      run.files = await project.listFiles(); run.status = 'completed'; pipeline.status = 'completed';
      this.event(job, run, 'completed', job.kind === 'plan' ? 'Taste-led directions are ready; choose one to build.' : `Site files saved; DNA conformance ${state.conformance.score}. The working preview is ready.`);
    } catch (error) {
      run.status = controller.signal.aborted ? 'cancelled' : 'failed'; pipeline.status = run.status;
      run.error = redact(error.message, this.config).slice(0, 1000);
      this.event(job, run, 'error', run.error);
    } finally {
      this.bridgeSessions.delete(bridgeToken);
      imageController.abort(); await Promise.allSettled([...imageTasks]);
      await this.save(job);
    }
  }
  async execute(job, run) {
    if (job.protocol === 'taste' && ['build', 'plan'].includes(job.kind)) return this.executeTaste(job, run);
    run.status = 'running';
    const directory = path.join(this.config.dataDir, job.id, run.mode);
    const project = this.project(job, run.mode);
    await fs.mkdir(project.directory, { recursive: true });
    const template = this.templates.find(t => t.id === job.templateId);
    const startingFiles = job.kind === 'revise' || (job.kind === 'prepare' && job.intendedKind === 'revise') ? await this.project(this.get(job.parentJobId), job.parentMode).exportFiles() : template.files;
    for (const [file, content] of Object.entries(startingFiles)) if (job.kind !== 'prepare' || !isCultureArtifactPath(file)) await project.writeFile(file, content);
    if (job.kind === 'revise') {
      const parentRun = this.get(job.parentJobId).runs.find(r => r.mode === job.parentMode);
      run.evidence = run.mode === 'qloo' ? structuredClone(parentRun.evidence || []).map(e => ({ ...e, reusedFrom: { jobId: job.parentJobId, mode: job.parentMode } })) : [];
      run.decisions = structuredClone(parentRun.decisions || []);
      run.researchDecisions = run.mode === 'qloo' ? structuredClone(parentRun.researchDecisions || []) : [];
      // The job's parent identity records reuse; keep bounded source rows and
      // their original retrieval times instead of duplicating parent metadata.
      run.webSources = structuredClone(parentRun.webSources || []).map(({ reusedFrom, ...source }) => { void reusedFrom; return source; });
      // Generated images are binary assets outside the project files, so the revision copies the ones its source recorded.
      run.generatedImages = [];
      for (const image of parentRun.generatedImages || []) {
        try {
          const target = this.assetPath(job, run.mode, image.path);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.copyFile(this.assetPath(this.get(job.parentJobId), job.parentMode, image.path), target);
          run.generatedImages.push({ ...structuredClone(image), reusedFrom: image.reusedFrom || { jobId: job.parentJobId, mode: job.parentMode } });
        } catch { this.event(job, run, 'warning', `The generated image ${image.path} could not be copied from the source variant.`); }
      }
    } else if (job.planJobId && run.mode === 'qloo' && job.planMode === 'qloo') {
      const planRun = this.get(job.planJobId).runs.find(r => r.mode === job.planMode);
      run.evidence = structuredClone(planRun.evidence || []).map(e => ({ ...e, reusedFrom: { jobId: job.planJobId, mode: job.planMode } }));
      run.researchDecisions = structuredClone(planRun.researchDecisions || []);
      run.webSources = structuredClone(planRun.webSources || []).map(({ reusedFrom, ...source }) => { void reusedFrom; return source; });
    }
    const { importedResearch, researchDecisions: authoredResearch, webSources: authoredWebSources, ...operationalBrief } = job.cultureBrief;
    const contextArtifact = {
      schemaVersion: '1.0', product: { name: template.name, templateId: template.id, brief: job.productBrief || job.brief },
      revisionRequest: job.kind === 'revise' ? job.brief : undefined,
      ...operationalBrief, selectedDirection: job.selectedDirection || undefined, audienceId: job.audienceId || undefined,
      // A revision of a taste-led variant inherits its full taste pass; the brief carries only the cited records.
      evidence: portableRunRecords({ evidence: run.evidence, decisions: run.decisions, researchDecisions: run.researchDecisions }).evidence,
      decisions: [], provenance: run.evidence.length ? 'studio-recorded-qloo-responses' : 'user-brief-and-model-interpretation',
    };
    void authoredResearch; void authoredWebSources;
    contextArtifact.researchDecisions = structuredClone(run.researchDecisions);
    contextArtifact.webSources = portableWebSources(run.webSources);
    if (importedResearch) await project.writeFile('culture-imported-context.json', JSON.stringify(importedResearch, null, 2));
    await project.writeFile('culture-brief.json', JSON.stringify(contextArtifact, null, 2));
    const beforeFiles = await project.exportFiles();
    const originalHash = await project.fingerprint();
    if (job.kind === 'prepare' && job.preparationResponse && job.preparationResponse.type !== 'references') {
      try {
        const parentPreparation = this.get(job.preparationJobId).runs.find(source => source.preparation)?.preparation;
        run.preparation = answerPreparation(parentPreparation, job.preparationResponse);
        await project.writeFile('culture-preparation.json', JSON.stringify(run.preparation, null, 2));
        contextArtifact.creativeContext = run.preparation.creativeContext;
        await project.writeFile('culture-brief.json', JSON.stringify(contextArtifact, null, 2));
        run.files = await project.listFiles(); run.status = 'completed';
        this.event(job, run, 'completed', 'Your explicit reference choice is ready. No additional model or Qloo call was needed.');
      } catch (error) { run.status = 'failed'; run.error = redact(error.message, this.config).slice(0, 1000); }
      await this.save(job); return;
    }
    const controller = new AbortController();
    const bridgeToken = crypto.randomBytes(32).toString('hex');
    const webBridgeToken = crypto.randomBytes(32).toString('hex');
    let calls = 0, qlooCalls = 0;
    const researchSnapshots = [], changedFiles = new Set();
    let writeChain = Promise.resolve();
    let nativeResearchSync = null;
    let nativeCaptureFailure = null;
    const syncNativeResearch = async () => {
      if (controller.signal.aborted && !nativeCaptureFailure) return;
      if (!nativeResearchSync) return;
      if (nativeCaptureFailure) throw nativeCaptureFailure;
      try { await nativeResearchSync(); }
      catch (error) {
        nativeCaptureFailure ||= new Error(`Native web research capture failed: ${redact(error.message, this.config).slice(0, 600)}`);
        this.event(job, run, 'error', nativeCaptureFailure.message);
        controller.abort();
        throw nativeCaptureFailure;
      }
    };
    const registerNativeResearchSync = sync => {
      if (typeof sync !== 'function' || nativeResearchSync) throw new Error('Register one private native research collector for this run.');
      nativeResearchSync = sync;
      // The runner's final flush uses the same failure/ownership semantics.
      return syncNativeResearch;
    };
    const phases = run.creativePipeline;
    let activeSourceCalls = 0;
    const phaseError = message => ({ content: [{ type: 'text', text: message }], structuredContent: { status: 'blocked', error: { code: 'CREATIVE_PHASE_REQUIRED', message, retryable: false } }, isError: true });
    const sourceGate = () => {
      if (!phases) return null;
      if (!run.provisionalPlan) return phaseError('Save culture-plan.json with a provisional approach and alternatives before cultural or web research.');
      if (phases.constructionStartedAt) return phaseError('Research must finish before construction. This run cannot add research after changing the site.');
      return null;
    };
    const beginResearch = () => {
      if (!phases) return;
      phases.researchStartedAt ||= new Date().toISOString();
      phases.status = 'researching'; phases.reconsideredAt = null; run.reconsideration = null;
    };
    const constructionGate = () => phases && (!run.reconsideration || !phases.reconsideredAt || activeSourceCalls || run.webCalls?.some(call => call.status === 'pending'))
      ? phaseError('Finish research and save culture-reconsideration.json before changing site files or producing a revision/direction artifact. Keep, refine or replace every provisional decision and explain the recorded evidence.') : null;
    const onEvidence = async evidence => {
      const id = `Q${String(run.evidence.length + 1).padStart(3, '0')}`;
      if (evidence.evidence) evidence.evidence.id = id;
      run.evidence.push({ ...evidence, id, time: new Date().toISOString() });
      this.event(job, run, 'qloo', `Qloo: ${evidence.results?.length || 0} results — ${id}`);
      await this.save(job);
    };
    const underlying = createToolHandler({
      qlooClient: run.mode === 'qloo' ? this.qlooClientFactory() : undefined,
      project, onEvidence, includeQlooTools: run.mode === 'qloo',
    });
    const executeTool = async (name, args) => {
      if (controller.signal.aborted || run.status !== 'running') return { content: [{ type: 'text', text: 'This job is no longer active.' }], isError: true };
      if (['studio_web_before', 'studio_web_after'].includes(name)) return phaseError('Native web research records require the private host hook. Agent-authored records cannot attest to a web response.');
      const sourceCost = name === 'qloo_compare_tastes' && Array.isArray(args.groups) ? Math.max(1, args.groups.length) : 1;
      if (++calls > 100 || (name.startsWith('qloo_') && qlooCalls + sourceCost > 24)) return { content: [{ type: 'text', text: 'The per-job tool limit was reached.' }], isError: true };
      if (name === 'project_get_research') {
        if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) return { content: [{ type: 'text', text: 'project_get_research accepts an empty argument object only.' }], isError: true };
        const state = { creativePipeline: phases || null, provisionalPlan: run.provisionalPlan || null, reconsideration: run.reconsideration || null,
          webCalls: run.webCalls || [], webSources: run.webSources || [] };
        return { content: [{ type: 'text', text: JSON.stringify(state) }], structuredContent: state };
      }
      if (name.startsWith('qloo_')) qlooCalls += sourceCost;
      if (run.mode === 'baseline' && name.startsWith('qloo_')) return { content: [{ type: 'text', text: 'Qloo is disabled for this run.' }], isError: true };
      if (name.startsWith('qloo_')) {
        await writeChain;
        const blocked = sourceGate(); if (blocked) return blocked;
        beginResearch();
      }
      if (name === 'project_write_file' && job.kind !== 'build') {
        const phaseFiles = ['culture-plan.json', 'culture-reconsideration.json'];
        const allowed = job.kind === 'prepare' ? ['culture-preparation.json'] : job.kind === 'plan' ? [...phaseFiles, 'culture-directions.json', 'culture-decisions.json', 'culture-research.json'] : [...phaseFiles, 'culture-revision.json', 'culture-decisions.json', 'culture-research.json'];
        if (!allowed.includes(args.path)) return { content: [{ type: 'text', text: `This ${job.kind} job may only write ${allowed.join(', ')}. Site files are protected.` }], isError: true };
      }
      let declaredApplications = [];
      let creativeArtifact;
      const startsConstruction = name === 'project_write_file' && (typeof args.path === 'string' && !isCultureArtifactPath(args.path) || ['culture-revision.json', 'culture-directions.json'].includes(args.path));
      if (startsConstruction) { const blocked = constructionGate(); if (blocked) return blocked; }
      if (name === 'project_write_file' && ['culture-plan.json', 'culture-reconsideration.json'].includes(args.path)) {
        if (phases?.constructionStartedAt || args.path === 'culture-plan.json' && phases?.researchStartedAt) return phaseError('The provisional plan cannot be rewritten after research starts, and reconsideration cannot be rewritten after construction starts.');
        if (args.path === 'culture-reconsideration.json' && (activeSourceCalls || run.webCalls?.some(call => call.status === 'pending'))) return phaseError('Wait for the recorded source calls to finish before reconsidering the plan.');
        try {
          creativeArtifact = args.path === 'culture-plan.json' ? normalizeCreativePlan(args.content)
            : normalizeCreativeReconsideration(args.content, { plan: run.provisionalPlan, evidence: run.evidence, webSources: run.webSources });
        } catch (error) { return phaseError(`Invalid ${args.path}: ${redact(error.message, this.config).slice(0, 450)}`); }
      }
      if (name === 'project_write_file' && ['culture-decisions.json', 'culture-research.json'].includes(args.path)) {
        try {
          const artifact = JSON.parse(args.content);
          if (args.path === 'culture-decisions.json') normalizeDecisions(artifact, run.evidence);
          else {
            const records = normalizeResearchDecisions(artifact, { evidence: run.evidence.filter(record => record.status === 'ok' && record.results?.length), webSources: portableWebSources(run.webSources) });
            if (phases && records.some(record => record.application) && !run.reconsideration) return phaseError('Save culture-reconsideration.json after completed research before declaring an application plan.');
            declaredApplications = snapshotResearchApplications(records, { beforeFiles, currentFiles: await project.exportFiles(), changedFiles: [...changedFiles] });
          }
        } catch (error) {
          const message = `Invalid ${args.path}: ${redact(error.message, this.config).slice(0, 450)} Correct this artifact before saving it. properties contains CSS property names only; omit an unavailable optional reuseKey.`;
          this.event(job, run, 'warning', `Rejected invalid ${args.path}; the agent can correct its record.`);
          return { content: [{ type: 'text', text: message }], structuredContent: { status: 'error', error: { code: 'CULTURE_ARTIFACT_INVALID', message, retryable: false } }, isError: true };
        }
      }
      if (name.startsWith('qloo_')) activeSourceCalls++;
      let result;
      try { result = await underlying(name, args); }
      finally { if (name.startsWith('qloo_')) activeSourceCalls--; }
      if (name === 'project_write_file' && !result.isError) {
        if (args.path === 'culture-plan.json') {
          run.provisionalPlan = creativeArtifact;
          run.reconsideration = null;
          if (phases) { phases.planSavedAt = new Date().toISOString(); phases.reconsideredAt = null; phases.status = 'planned'; }
          this.event(job, run, 'planning', 'A provisional creative plan and alternatives were saved before research.');
        }
        if (args.path === 'culture-reconsideration.json') {
          run.reconsideration = creativeArtifact;
          if (phases) { phases.reconsideredAt = new Date().toISOString(); phases.status = 'reconsidered'; }
          this.event(job, run, 'reconsideration', 'The agent reconsidered each provisional decision before construction.');
        }
        if (startsConstruction && phases) { phases.constructionStartedAt ||= new Date().toISOString(); phases.status = 'constructing'; }
        if (!isCultureArtifactPath(args.path) && args.content !== beforeFiles[args.path]) changedFiles.add(args.path);
        if (job.kind === 'revise' && args.path === 'culture-revision.json') {
          // Persisting a replacement fragment starts construction even though
          // the host applies it to the actual HTML after the runner finishes.
          changedFiles.add('index.html');
          try { if (JSON.parse(args.content).css?.trim()) changedFiles.add('styles.css'); }
          catch { changedFiles.add('styles.css'); }
        }
        for (const snapshot of declaredApplications) {
          if (researchSnapshots.length < 256 && !researchSnapshots.some(existing => existing.id === snapshot.id && existing.signature === snapshot.signature)) researchSnapshots.push(snapshot);
        }
      }
      if (name.startsWith('qloo_')) {
        const outcome = result.structuredContent || {};
        const validRequest = !['TOOL_INPUT_INVALID', 'QLOO_INPUT_INVALID', 'QLOO_KEY_MISSING', 'TOOL_UNKNOWN'].includes(outcome.error?.code);
        const query = Object.fromEntries(['query', 'types', 'seedEntityIds', 'resultType', 'candidateEntityIds', 'location', 'limit', 'explainability', 'tagTypes', 'parentTypes', 'groups'].filter(field => Object.hasOwn(args, field)).map(field => [field, args[field]]));
        run.researchCalls ||= [];
        run.researchCalls.push({ tool: name, time: new Date().toISOString(), status: outcome.status || (result.isError ? 'error' : 'unknown'),
          sourceRequestAttempted: validRequest, ...(validRequest ? { query: JSON.parse(redact(JSON.stringify(query), this.config)) } : {}),
          ...(outcome.error ? { error: outcome.error } : {}), ...(outcome.failedGroups ? { failedGroups: outcome.failedGroups } : {}) });
      }
      if (name === 'culture_assess_decision' && !result.isError) {
        run.assessmentCalls ||= [];
        if (run.assessmentCalls.length < 16) run.assessmentCalls.push({ decision: structuredClone(args.decision), result: result.structuredContent });
        this.event(job, run, 'assessment', `Creative decision: ${result.structuredContent?.action || 'assessed'}.`);
      }
      if (name === 'project_write_file' && !result.isError) this.event(job, run, 'file', `Saved: ${args.path}`);
      else if (name === 'project_read_file' && !result.isError) this.event(job, run, 'file', `Read: ${args.path}`);
      else if (name === 'project_list_files' && !result.isError) this.event(job, run, 'file', 'Listed the starter site files.');
      else if (result.isError) this.event(job, run, 'warning', `${name}: ${result.structuredContent?.error?.code || 'TOOL_EXECUTION_FAILED'} — the tool request could not be completed.`);
      return result;
    };
    const handle = async (name, args) => {
      // The collector can use the private source handler, which awaits previous
      // writes. Flush it before enqueueing this write to avoid waiting on itself.
      await syncNativeResearch();
      if (name !== 'project_write_file') return executeTool(name, args);
      // Snapshot, validate and persist as one ordered mutation. Source requests
      // and reads stay independent; all bridge writes share this queue.
      const pending = writeChain.then(() => executeTool(name, args));
      writeChain = pending.catch(() => {});
      return pending;
    };
    const webPending = new Map();
    const handleWebHook = async (name, args) => {
      if (controller.signal.aborted || run.status !== 'running') return phaseError('This job is no longer active.');
      if (!['studio_web_before', 'studio_web_after'].includes(name)) return phaseError('The private web hook is restricted to native research events.');
      if (job.kind === 'prepare') return phaseError('Preparation does not perform web or Qloo research.');
      if (!args || !['web_search', 'web_fetch'].includes(args.toolName) || !args.input || typeof args.input !== 'object' || Array.isArray(args.input)) return phaseError('A recognized native web tool and its actual input are required.');
      const inputText = JSON.stringify(args.input);
      if (inputText.length > 6000) return phaseError('Native web research input exceeded its bound.');
      const input = JSON.parse(redact(inputText, this.config));
      if (typeof input.query === 'string' && input.query.length > 1000) return phaseError('Native web research queries may contain at most 1000 characters.');
      const observational = args.captureMode === 'kiro-native-session';
      if (observational && phases) {
        phases.captureMode = 'kiro-native-session';
        const limitation = 'Native web calls are observed from the private Kiro session log. Ordering and budget violations fail generation after invocation; this capture does not prevent an upstream native request.';
        if (!phases.limitations.includes(limitation)) phases.limitations.push(limitation);
      }
      const key = args.toolName + ':' + canonical(input) + (observational && typeof args.nativeToolCallId === 'string' ? ':' + args.nativeToolCallId.slice(0, 160) : '');
      if (name === 'studio_web_before') {
        await writeChain;
        const rejectSource = async result => {
          this.event(job, run, 'warning', result.structuredContent.error.message);
          if (observational) {
            let query = input;
            if (args.toolName === 'web_fetch') { try { query = { url: validatePublicResearchUrl(input.url) }; } catch { query = {}; } }
            run.webCalls ||= [];
            if (run.webCalls.length < 20) run.webCalls.push({ id: `web-call-${run.webCalls.length + 1}`, tool: args.toolName, startedAt: new Date().toISOString(),
              status: 'error', query, captureMode: 'kiro-native-session', observedAfterInvocation: true,
              limitation: 'This native request was already invoked before the observer detected a phase, URL or budget violation. No usable source is attributed to it.' });
            if (phases && !phases.limitations.includes(result.structuredContent.error.message)) phases.limitations.push(result.structuredContent.error.message);
            await this.save(job);
          }
          return result;
        };
        const blocked = sourceGate(); if (blocked) return rejectSource(blocked);
        if ((run.webCalls || []).length >= 6) return rejectSource(phaseError('The balanced research budget allows at most six web searches or page fetches per run.'));
        if (args.toolName === 'web_fetch') {
          try { validatePublicResearchUrl(input.url); }
          catch (error) { return rejectSource(phaseError(`Web research requires a public reference URL: ${error.message}`)); }
        }
        if (webPending.has(key)) return phaseError('This native web request is already waiting for its response.');
        beginResearch();
        const call = { id: `web-call-${(run.webCalls || []).length + 1}`, tool: args.toolName, startedAt: new Date().toISOString(), status: 'pending', query: input,
          ...(observational ? { captureMode: 'kiro-native-session', observedAfterInvocation: true } : {}) };
        run.webCalls ||= []; run.webCalls.push(call); webPending.set(key, call);
        this.event(job, run, 'web-research', `Native ${args.toolName}: ${observational ? 'an invoked reference request was observed' : 'reference research started'}.`);
        await this.save(job);
        return { content: [{ type: 'text', text: 'Native web research is allowed.' }], structuredContent: { status: 'allowed', callId: call.id } };
      }
      const call = webPending.get(key);
      if (!call) return phaseError('No authorized native web request matches this response. Agent-authored citations are not captured sources.');
      webPending.delete(key); call.finishedAt = new Date().toISOString();
      const records = extractNativeWebSources({ ...args, input, response: JSON.parse(redact(JSON.stringify(args.response ?? null), this.config)) });
      const room = Math.max(0, 24 - (run.webSources || []).length);
      run.webSources ||= [];
      const sourceQuery = Object.fromEntries(['query', 'url'].filter(field => typeof input[field] === 'string').map(field => [field, input[field]]));
      const sources = [];
      for (const record of records.slice(0, room)) {
        const source = boundedWebSource({ ...record, id: `W${String(run.webSources.length + 1).padStart(3, '0')}`, tool: args.toolName, query: sourceQuery,
          retrievedAt: call.finishedAt, provenance: 'studio-recorded-native-web-response' }, run.webSources);
        if (!source) continue;
        run.webSources.push(source); sources.push(source);
      }
      call.status = sources.length ? 'ok' : args.status === 'error' || args.response?.isError === true ? 'error' : 'empty';
      call.sourceIds = sources.map(source => source.id);
      if (!sources.length) call.limitation = 'The native response did not contain a usable, attributable public web source. No successful reference research is claimed.';
      if (records.length > sources.length) call.limitation = 'Additional returned source text or records were omitted after the per-run source count or aggregate 64 KiB capture bound.';
      this.event(job, run, 'web-research', `Native ${args.toolName}: ${sources.length} attributable web sources recorded.`);
      await this.save(job);
      return { content: [{ type: 'text', text: 'The native response was recorded separately from model interpretation.' }], structuredContent: { status: 'recorded', callId: call.id, sourceIds: call.sourceIds } };
    };
    this.bridgeSessions.set(bridgeToken, { handle, controller, jobId: job.id });
    this.bridgeSessions.set(webBridgeToken, { handle: handleWebHook, controller, jobId: job.id });
    this.event(job, run, 'started', `Processing an independent starter copy with ${job.model}.`);
    await this.save(job);
    try {
      await this.runner({ directory, config: this.config, model: job.model,
        prompt: makeDesignPrompt({ template, brief: job.brief, mode: run.mode, kind: job.kind, cultureBrief: job.cultureBrief, selectedDirection: job.selectedDirection, audienceId: job.audienceId, targetSelector: job.targetSelector,
          preparationResponse: job.preparationResponse, preparationRound: job.preparationRound,
          parentPreparation: job.kind === 'prepare' && job.preparationJobId ? this.get(job.preparationJobId).runs.find(source => source.preparation)?.preparation : undefined,
          targetHtml: job.kind === 'revise' ? findHtmlTarget(beforeFiles['index.html'], job.targetSelector).html : undefined }),
        bridgeUrl: this.bridgeUrl, bridgeToken, webBridgeToken, registerNativeResearchSync, kind: job.kind, mode: run.mode, signal: controller.signal,
        onEvent: event => this.event(job, run, event.type, event.message),
        project, onEvidence, job, // dependency-injected test runner only; production runner ignores these.
      });
      await syncNativeResearch();
      await writeChain;
      if (controller.signal.aborted) throw new Error('The job was cancelled.');
      if (phases && (!run.provisionalPlan || !run.reconsideration || run.webCalls?.some(call => call.status === 'pending'))) throw new Error('The provisional plan, completed research and reconsideration stages were not completed. This run cannot claim the creative research protocol.');
      const actualInsight = run.evidence.some(e => e.tool === 'qloo_get_insights' && e.status === 'ok' && e.results?.length > 0);
      const skippedResearch = run.assessmentCalls.length > 0 && run.assessmentCalls.every(call => call.result?.action === 'skip') && qlooCalls === 0;
      if (run.mode === 'qloo' && !actualInsight && !skippedResearch) throw new Error('No usable Qloo insights were received; this run cannot be presented as Qloo-supported.');
      if (run.mode === 'qloo' && skippedResearch) this.event(job, run, 'assessment', actualInsight ? 'No new Qloo research was added for this decision. Existing research provenance is retained.' : 'Cultural research was skipped for this decision. This output has no Qloo research support.');
      if (job.kind === 'prepare') {
        const afterFiles = await project.exportFiles();
        if (Object.entries(beforeFiles).some(([name, content]) => !isCultureArtifactPath(name) && afterFiles[name] !== content)
          || Object.keys(afterFiles).some(name => !isCultureArtifactPath(name) && !Object.hasOwn(beforeFiles, name))) throw new Error('Preparation changed a protected starter file.');
        const parentPreparation = job.preparationJobId ? this.get(job.preparationJobId).runs.find(source => source.preparation)?.preparation : undefined;
        run.preparation = normalizePreparation(JSON.parse(await project.readFile('culture-preparation.json')), {
          cultureBrief: job.cultureBrief, brief: job.brief, reply: job.preparationResponse?.text || '', parentPreparation,
          response: job.preparationResponse, assessments: run.assessmentCalls,
        });
        contextArtifact.creativeContext = run.preparation.creativeContext;
        await project.writeFile('culture-preparation.json', JSON.stringify(run.preparation, null, 2));
      } else if (job.kind === 'plan') {
        run.directions = normalizeDirections(JSON.parse(await project.readFile('culture-directions.json')), { evidence: run.evidence, audiences: job.cultureBrief.audiences });
        if (run.mode === 'qloo' && !skippedResearch && !run.directions.some(d => d.anchors.length)) throw new Error('The direction plan is not linked to actual cultural records.');
      } else {
        if (job.kind === 'revise') {
          const revision = JSON.parse(await project.readFile('culture-revision.json'));
          if (revision.selector !== job.targetSelector) throw new Error('The revision exceeded the selected section.');
          const revised = applyScopedRevision(beforeFiles, revision);
          for (const file of ['index.html', 'styles.css']) await project.writeFile(file, revised[file]);
        }
        if ((await project.readFile('index.html')).trim().length < 100) throw new Error('Kiro did not save a usable HTML page.');
        const afterFiles = await project.exportFiles();
        const changedSite = Object.keys(afterFiles).some(file => !isCultureArtifactPath(file) && afterFiles[file] !== beforeFiles[file]);
        if (!changedSite || await project.fingerprint() === originalHash) throw new Error('Kiro did not change the site files; generation is incomplete.');
        assertBrandLocks(beforeFiles, afterFiles, job.cultureBrief.brand);
        if (job.kind === 'revise') {
          // A scoped edit must keep all pre-existing interactive IDs outside its target.
          const beforeTarget = findHtmlTarget(beforeFiles['index.html'], job.targetSelector).html;
          const ids = [...beforeTarget.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
          const fragment = findHtmlTarget(afterFiles['index.html'], job.targetSelector).html;
          for (const id of ids) if (!new RegExp(`\\bid\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(fragment)) throw new Error(`The revision removed an existing element ID: ${id}`);
        }
        run.diff = { files: fileDiff(beforeFiles, afterFiles) };
      }
      if (job.kind !== 'prepare') try {
        const raw = JSON.parse(await project.readFile('culture-decisions.json'));
        const freshDecisions = normalizeDecisions(raw, run.evidence);
        run.decisions = job.kind === 'revise' ? [...freshDecisions, ...run.decisions.filter(d => !d.selectors?.includes(job.targetSelector))].slice(0, 8) : freshDecisions;
      } catch { this.event(job, run, 'warning', 'The model did not save valid decision records; decision explanations could not be verified.'); }
      if (job.kind !== 'prepare') {
        try {
          const raw = JSON.parse(await project.readFile('culture-research.json'));
          run.researchDecisions = normalizeResearchDecisions(raw, { evidence: run.evidence.filter(record => record.status === 'ok' && record.results?.length), webSources: portableWebSources(run.webSources) });
          run.researchVerification = verifyResearchApplications(run.researchDecisions, { beforeFiles, afterFiles: await project.exportFiles(), snapshots: researchSnapshots, kind: job.kind });
        } catch (error) {
          run.researchDecisions ||= [];
          this.event(job, run, 'warning', 'Research decision records were absent or invalid; no cultural decision trace is claimed.');
        }
      }
      const portable = portableRunRecords({ evidence: run.evidence, decisions: run.decisions, researchDecisions: run.researchDecisions });
      contextArtifact.evidence = portable.evidence; contextArtifact.decisions = portable.decisions;
      contextArtifact.researchDecisions = run.researchDecisions || [];
      contextArtifact.webSources = portableWebSources(run.webSources);
      contextArtifact.provenance = run.evidence.length ? 'studio-recorded-qloo-responses' : 'user-brief-and-model-interpretation';
      await project.writeFile('culture-brief.json', JSON.stringify(contextArtifact, null, 2));
      run.files = await project.listFiles(); run.status = 'completed';
      if (phases) phases.status = 'completed';
      this.event(job, run, 'completed', job.kind === 'prepare' ? run.preparation.status === 'needs_input' ? 'Creative preparation is ready for your reference answer.' : 'Creative context is ready for production.' : job.kind === 'plan' ? 'Creative directions are ready; choose one to generate a site.' : 'Site files saved; the working preview is ready.');
    } catch (error) {
      run.status = nativeCaptureFailure ? 'failed' : controller.signal.aborted ? 'cancelled' : 'failed';
      if (phases) phases.status = run.status;
      run.error = redact((nativeCaptureFailure || error).message, this.config).slice(0, 1000);
      this.event(job, run, 'error', run.error);
    } finally {
      for (const call of run.webCalls || []) if (call.status === 'pending') {
        call.status = 'error'; call.finishedAt = new Date().toISOString();
        call.limitation = 'The native research request did not return a capturable response before this job ended. No successful source read is claimed.';
      }
      this.bridgeSessions.delete(bridgeToken); this.bridgeSessions.delete(webBridgeToken); await this.save(job);
    }
  }
  async cancel(id) {
    const job = this.get(id);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    job.status = 'cancelled'; job.error = 'The user cancelled the job.';
    for (const session of this.bridgeSessions.values()) if (session.jobId === id) session.controller.abort();
    this.characterControllers.get(id)?.abort();
    for (const run of job.runs) if (run.status === 'queued') run.status = 'cancelled';
    await this.save(job); return job;
  }
  async close() {
    this.closing = true; this.queue.length = 0;
    for (const session of this.bridgeSessions.values()) session.controller.abort();
    for (const controller of this.characterControllers.values()) controller.abort();
    while (this.draining) await new Promise(resolve => setTimeout(resolve, 10));
    await Promise.allSettled([...this.saves.values()]);
  }
}
