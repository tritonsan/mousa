// The Moûsa plugin's own MCP surface, which the Claude Code and Codex packages start through plugin/server/mousa.mjs.
// It is lean on purpose: short instructions (Claude Code cuts server instructions at 2,048 characters), few tools,
// compact text results (Codex drops images from a result that also carries structuredContent), and records kept in
// the project's .mousa folder rather than passed back and forth. The older standalone surface of index.mjs stays as
// it is for Studio's /mcp endpoint, the Kiro example and their tests.

import { createConnectionStore, ConnectionStoreError } from '../connections/store.mjs';
import { resolveQlooConnection, hostName, testQlooKey } from '../connections/config.mjs';
import { createConnectionPage } from '../connections/page.mjs';
import { resolveProjectRoot, checkProjectFolder, readState, workspaceRoot, WORKSPACE_FIELD, ProjectScopeError, CODEX_SANDBOX_META } from '../production/project-files.mjs';
import { inspectImageProviders, ImageRequestError } from '../production/images.mjs';
import { inspectBrowser, verifyBrowser } from '../production/capture.mjs';
import { fontLibraryRoot, loadFontLibrary } from '../production/fonts.mjs';
import { QlooError } from '../qloo/client.mjs';
import { TasteProtocolError } from '../culture/taste.mjs';
import { createTasteTools, TasteToolError, qlooBudget } from '../taste/tools.mjs';
import { readQlooUsage } from '../taste/cache.mjs';
import { createDesignTools, DesignToolError } from '../design/tools.mjs';
import { collectProjectFiles, detectDesignSystem } from '../design/systems.mjs';

export const MOUSA_SERVER_NAME = 'mousa';
export const MOUSA_SERVER_VERSION = '0.6.0';
export const MOUSA_PROTOCOL_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
export const MOUSA_INSTRUCTIONS_LIMIT = 2048;

export const MOUSA_INSTRUCTIONS = [
  'Moûsa grounds design work in measured cultural taste from Qloo: what an audience loves, what those works share, and what that means for palette, type, imagery, motion, voice and structure.',
  'Before you design or restyle anything for a particular audience, load the Moûsa taste-brief skill and follow it; once you have the Taste Brief, the Moûsa design skill takes you through the stages.',
  'Start every design session with mousa_status. It reports whether Qloo is connected, which project folder the tools use and what this session can make.',
  'If Qloo is not connected, call mousa_connect and give the person the link it returns: they enter their own Qloo API key on a page on this computer, so the key never passes through the chat.',
  'If no project folder is set, ask the person which folder to design in, then call mousa_open_project.',
  'To measure an audience: taste_profile with dryRun:true plans the Qloo questions without a request; save your own prediction with design_validate (stage prediction) before any data; then taste_profile measures and returns the Taste Brief. While designing, ask taste_ask, writing your own guess first.',
  'Then design_validate the reading, the Design DNA and the production plan, build in the project\'s own design system, run design_check, look at design_capture (specimen:true for work a browser cannot open) and design_validate your review.',
  'Finish with design_report: the Taste Provenance page that shows where each choice came from. Give the person its path.',
  'Never invent Qloo results, entities or affinities. Report missing connections, unresolved names and empty results as they are.',
].join(' ');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
export const MOUSA_SETUP_TOOLS = Object.freeze([
  {
    name: 'mousa_status',
    description: 'Start here. Reports whether Qloo is connected and from where, the project folder the tools use, which image generators this session can use, whether results can be captured for review, and a one-line fix for anything missing. Makes no network request unless check is true, which tests the Qloo key with one request.',
    inputSchema: { type: 'object', properties: { check: { type: 'boolean', description: 'Also test the Qloo key with one search request.' }, workspace: WORKSPACE_FIELD }, additionalProperties: false },
    annotations: { ...READ_ONLY, openWorldHint: true },
  },
  {
    name: 'mousa_connect',
    description: 'Open a one-time page on this computer where the person enters their own Qloo API key. Give them the returned link; the key never passes through the chat. The page tests the key with one Qloo request, saves it for this user (encrypted on Windows) and closes. Call mousa_status after they save it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'mousa_open_project',
    description: 'Set the project folder when mousa_status reports none: the absolute path of the folder the person wants to design in. Ask them first; some hosts also ask them to approve this call. The file tools then read and write only inside that folder.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 3, maxLength: 1000, description: 'Absolute path of an existing folder.' } }, required: ['path'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
]);

/** A compact text result: one JSON object, no structuredContent copy. */
export function textResult(value) { return { content: [{ type: 'text', text: JSON.stringify(value) }] }; }
export function errorResult(code, message, retryable = false) {
  return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: { code, message, retryable } }) }], isError: true };
}

// The validators this surface shares with Studio name Studio's files and tools; here their messages name this
// surface's own: the Taste Brief, the materials tool and pictures made with the image tool.
const HOST_TERMS = [
  [/Use a photo ID or path listed in culture-library\.json, such as library\/olive-oil-1\.jpg, or a picture generated for this device, such as (generated\/[a-z0-9_-]+\.png)\./gu,
    'List only pictures made for this device with the image tool, such as $1.'],
  [/This run has no host photo library, so a device cannot list photos\. Use original SVG or CSS imagery instead\./gu,
    'This session has no photo library: list only pictures made with the image tool, such as generated/dna5-1.png, or draw the imagery with SVG or CSS.'],
  [/(\S+) is not in culture-library\.json\. Use a listed photo path\./gu, '$1 is not a picture made in this session. List only pictures made with the image tool.'],
  [/exactly as returned by project_get_taste/gu, 'as the Taste Brief names it'],
  [/project_get_taste/gu, 'the Taste Brief'],
  [/culture-fonts\.json/gu, 'the Moûsa font library (materials find)'],
  [/your saved culture-dna\.json/gu, 'your saved Design DNA'],
];
export function inHostTerms(message) {
  return HOST_TERMS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(message ?? ''));
}

/** Argument checks for this surface's JSON Schema subset: object, string, boolean, integer, number, array, enum. */
export function checkArguments(value, schema, at = 'arguments') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ArgumentError(`${at} must be an object.`);
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new ArgumentError(`${at}.${key} is required.`);
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(schema.properties ?? {}, key)) checkArguments(value[key], schema.properties[key], `${at}.${key}`);
      else if (schema.additionalProperties === false) throw new ArgumentError(`${at}.${key} is not a supported field.`);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) throw new ArgumentError(`${at} must be a string of ${schema.minLength ?? 0}-${schema.maxLength ?? '∞'} characters.`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new ArgumentError(`${at} must be true or false.`);
  } else if (schema.type === 'integer' || schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new ArgumentError(`${at} is outside the allowed range.`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new ArgumentError(`${at} has an invalid length.`);
    value.forEach((item, index) => checkArguments(item, schema.items, `${at}[${index}]`));
  }
  if (schema.enum && !schema.enum.includes(value)) throw new ArgumentError(`${at} must be one of: ${schema.enum.join(', ')}.`);
}
export class ArgumentError extends Error { constructor(message) { super(message); this.name = 'ArgumentError'; this.code = 'TOOL_INPUT_INVALID'; } }

/** One-line fixes for what is missing, in the words of the host the person uses. */
function setupHints({ host, qloo, project, images, capture }) {
  const hints = [];
  if (!qloo.connected) {
    hints.push(host === 'claude-code'
      ? 'Qloo is not connected: run /plugin configure mousa@mousa and enter the Qloo API key, or call mousa_connect for a local page.'
      : 'Qloo is not connected: call mousa_connect and give the person the link; they enter their Qloo API key on a page on this computer.');
  }
  if (qloo.problem) hints.push(qloo.problem);
  if (!project.folder) hints.push('No project folder is set: ask the person which folder to design in, then call mousa_open_project with its absolute path.');
  if (!images.some(item => item.id !== 'off' && item.status === 'available')) {
    hints.push(images.some(item => item.status === 'depends')
      ? 'Pictures: use this session\'s own image tool if it has one; otherwise plans use an SVG illustration or CSS art.'
      : 'No image generator here: plans use an SVG illustration or CSS art instead.');
  }
  if (!capture.available) hints.push(`Captures for the visual review are unavailable: ${capture.reason}`);
  return hints;
}

/**
 * The server. `store`, `page` and `inspect` ({browser, codex, fonts}) replace the machine parts in tests and other
 * hosts; `fetchImpl` reaches Qloo for the key test; `generate`, `capture` and `shoot` stand in for Codex and the browser.
 */
export function createMousaServer({ env = process.env, platform = process.platform, store, page, inspect = {}, fetchImpl, generate, capture, shoot } = {}) {
  const host = hostName(env);
  const environment = env.MOUSA_ENVIRONMENT === 'hosted' ? 'hosted' : 'local';
  const connections = store || createConnectionStore({ env, platform });
  const connectPage = page || createConnectionPage({ store: connections, ...(fetchImpl ? { fetchImpl } : {}) });
  const session = { root: null };
  let browser = null, images = null, fonts = null;
  const browserStatus = () => browser ||= (inspect.browser ? inspect.browser() : inspectBrowser({ env, platform }).then(found => verifyBrowser(found, { env })))
    .catch(() => ({ available: false, reason: 'The browser could not be checked on this machine.' }));
  const imageStatus = () => images ||= inspectImageProviders({ host, environment, env, platform, codex: inspect.codex })
    .catch(() => [{ id: 'off', status: 'available', note: 'No picture: the plan\'s fallback method.' }]);
  const fontStatus = () => fonts ||= (inspect.fonts ? inspect.fonts() : fontLibraryRoot({ env }).then(root => root ? loadFontLibrary(root) : null)).catch(() => null);

  async function projectStatus(meta) {
    try { const { root, source } = await resolveProjectRoot({ env, meta, session }); return { folder: root, source }; }
    catch (error) { return { folder: null, problem: error instanceof ProjectScopeError ? error.message : 'The project folder could not be checked.' }; }
  }
  // A tool's workspace, when it names one, is a folder inside the project with its own .mousa records.
  const projectFolder = async (meta, workspace) => workspaceRoot((await resolveProjectRoot({ env, meta, session })).root, workspace);
  const taste = createTasteTools({ env, connections, fetchImpl, fonts: fontStatus, project: projectFolder });
  const design = createDesignTools({ env, host, version: MOUSA_SERVER_VERSION, project: projectFolder, fonts: fontStatus, images: imageStatus, browser: browserStatus, generate, capture, shoot });
  const tools = [...MOUSA_SETUP_TOOLS, ...taste.definitions, ...design.definitions];

  async function status(args, meta) {
    const connection = await resolveQlooConnection({ env, store: connections });
    const qloo = { connected: Boolean(connection.apiKey), source: connection.source, api: connection.baseUrl,
      ...(connection.savedAt ? { savedAt: connection.savedAt } : {}), ...(connection.problem ? { problem: connection.problem } : {}) };
    if (args.check && connection.apiKey) {
      const checked = await testQlooKey({ apiKey: connection.apiKey, baseUrl: connection.baseUrl, ...(fetchImpl ? { fetchImpl } : {}) });
      qloo.check = checked.ok ? { ok: true } : { ok: false, code: checked.code, message: checked.message };
    }
    const [project, imageProviders, browserCheck, library] = await Promise.all([projectStatus(meta), imageStatus(), browserStatus(), fontStatus()]);
    const review = browserCheck.available ? { available: true, browser: browserCheck.label || browserCheck.name } : { available: false, reason: browserCheck.reason };
    const setup = setupHints({ host, qloo, project, images: imageProviders, capture: review });
    const ready = qloo.connected && (!qloo.check || qloo.check.ok) && Boolean(project.folder);
    // Where the project keeps its design values, and how far this design session has come.
    let designSystem = null, stage = null, workspace = null;
    if (project.folder) {
      const folder = await workspaceRoot(project.folder, args.workspace);
      if (args.workspace !== undefined) workspace = args.workspace;
      designSystem = detectDesignSystem(await collectProjectFiles(folder));
      // The Qloo requests this folder has sent, and the budget the person set for it.
      qloo.requests = await readQlooUsage(`${folder}/.mousa/usage.json`);
      if (qlooBudget(env)) qloo.budget = qlooBudget(env);
      stage = (await readState(folder, 'session').catch(() => null))?.stage || null;
    }
    return { status: ready ? 'ready' : 'needs-setup', version: MOUSA_SERVER_VERSION, host, environment, qloo, project, ...(workspace ? { workspace } : {}),
      ...(designSystem ? { designSystem } : {}), ...(stage ? { stage } : {}),
      images: imageProviders.map(({ path: file, ...item }) => { void file; return item; }), capture: review, materials: { fonts: library?.families?.length ?? 0 }, ...(setup.length ? { setup } : {}) };
  }

  async function connect() {
    if (environment === 'hosted') return errorResult('CONNECT_UNAVAILABLE', 'A hosted server cannot open a page on the person\'s computer. Set QLOO_API_KEY in its environment instead.');
    const opened = await connectPage.open();
    const connection = await resolveQlooConnection({ env, store: connections });
    return textResult({ status: 'open', url: opened.url, expiresAt: opened.expiresAt,
      message: 'Give the person this link. They paste their Qloo API key on that page on this computer; it never passes through the chat. Call mousa_status after they save it.',
      ...(connection.source === 'environment' ? { note: 'QLOO_API_KEY is already set in the environment and takes precedence over a key saved on this page.' }
        : connection.source === 'plugin settings' ? { note: 'A key is already set in the plugin\'s settings and takes precedence over a key saved on this page.' } : {}) });
  }

  async function openProject(args, meta) {
    const current = await projectStatus(meta);
    if (current.source === 'environment' || current.source === 'host') {
      return textResult({ status: 'unchanged', folder: current.folder, source: current.source, note: 'The host already names the project folder, so it is used instead.' });
    }
    session.root = await checkProjectFolder(args.path);
    return textResult({ status: 'opened', folder: session.root, source: 'approved', note: 'Moûsa\'s file tools now read and write only inside this folder.' });
  }

  async function callTool(name, args = {}, meta = null) {
    const tool = tools.find(item => item.name === name);
    if (!tool) return errorResult('TOOL_UNKNOWN', 'This tool is not available in this session.');
    try {
      checkArguments(args, tool.inputSchema);
      if (name === 'mousa_status') return textResult(await status(args, meta));
      if (name === 'mousa_connect') return await connect();
      if (name === 'mousa_open_project') return await openProject(args, meta);
      // The prediction stage belongs with the taste plan; every later stage with the design tools.
      if (name === 'design_validate' && args.stage === 'prediction') return textResult(await taste.handle(name, args, meta));
      if (taste.names.includes(name) && name !== 'design_validate') return textResult(await taste.handle(name, args, meta));
      if (design.names.includes(name)) {
        const value = await design.handle(name, args, meta);
        // A result that already carries content, such as captures with their pictures, goes out as it is.
        return Array.isArray(value?.content) ? value : textResult(value);
      }
      return errorResult('TOOL_UNKNOWN', 'This tool is not available in this session.');
    } catch (error) {
      if (error instanceof ArgumentError || error instanceof ProjectScopeError || error instanceof ConnectionStoreError
        || error instanceof TasteToolError || error instanceof TasteProtocolError || error instanceof ImageRequestError) return errorResult(error.code, inHostTerms(error.message));
      if (error instanceof DesignToolError || error instanceof QlooError) return errorResult(error.code, inHostTerms(error.message), Boolean(error.retryable));
      return errorResult('TOOL_EXECUTION_FAILED', 'The tool could not complete. Call mousa_status to check the setup.');
    }
  }

  function initialize(params = {}) {
    const requested = params.protocolVersion;
    return {
      protocolVersion: MOUSA_PROTOCOL_VERSIONS.includes(requested) ? requested : MOUSA_PROTOCOL_VERSIONS[0],
      // The Codex capability asks Codex to send its sandbox state, whose working folder names the project.
      capabilities: { tools: { listChanged: false }, experimental: { [CODEX_SANDBOX_META]: {} } },
      serverInfo: { name: MOUSA_SERVER_NAME, version: MOUSA_SERVER_VERSION },
      instructions: MOUSA_INSTRUCTIONS,
    };
  }

  return { initialize, listTools: () => structuredClone(tools), callTool, session, host, connections, page: connectPage };
}
