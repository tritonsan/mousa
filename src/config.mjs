import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadDotEnv(file = path.join(rootDir, '.env'), env = process.env) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = raw.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || raw.trimStart().startsWith('#') || env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[match[1]] = value;
  }
}

export function isLoopback(host) { return ['127.0.0.1', 'localhost', '::1'].includes(host); }

/** An http(s) origin with nothing after it, as PUBLIC_APP_BASE_URL gives one, or ''. */
function publicOrigin(value) {
  if (!value) return '';
  try { const url = new URL(value); return /^https?:$/u.test(url.protocol) && url.pathname === '/' && !url.search && !url.username ? url.origin : ''; } catch { return ''; }
}

export function getConfig(env = process.env) {
  const host = env.HOST || '127.0.0.1';
  const token = env.DEMO_ACCESS_TOKEN || '';
  if (env.KIRO_EFFORT && !['low', 'medium', 'high', 'xhigh', 'max'].includes(env.KIRO_EFFORT)) throw new Error('Invalid KIRO_EFFORT.');
  if (env.CREATIVE_PROTOCOL && !['taste', 'research'].includes(env.CREATIVE_PROTOCOL)) throw new Error('Invalid CREATIVE_PROTOCOL. Use taste or research.');
  if (env.CODEX_IMAGES && !['auto', 'off'].includes(env.CODEX_IMAGES)) throw new Error('Invalid CODEX_IMAGES. Use auto or off.');
  if (env.PRODUCTION_STAGES && !['on', 'off'].includes(env.PRODUCTION_STAGES)) throw new Error('Invalid PRODUCTION_STAGES. Use on or off.');
  if (env.MOUSA_ENVIRONMENT && !['local', 'hosted'].includes(env.MOUSA_ENVIRONMENT)) throw new Error('Invalid MOUSA_ENVIRONMENT. Use local or hosted.');
  if (env.TRY_ACCESS_CODE && env.TRY_ACCESS_CODE.length < 12) throw new Error('TRY_ACCESS_CODE must be at least 12 characters.');
  if (env.TRY_ACCESS && !['code', 'open'].includes(env.TRY_ACCESS)) throw new Error('Invalid TRY_ACCESS. Use code or open.');
  if (env.TRY_ARMS_PARALLEL && !['on', 'off'].includes(env.TRY_ARMS_PARALLEL)) throw new Error('Invalid TRY_ARMS_PARALLEL. Use on or off.');
  if (env.LEGACY_JOBS && !['on', 'off'].includes(env.LEGACY_JOBS)) throw new Error('Invalid LEGACY_JOBS. Use on or off.');
  if (env.LOG_FORMAT && !['text', 'json'].includes(env.LOG_FORMAT)) throw new Error('Invalid LOG_FORMAT. Use text or json.');
  if (env.REQUEST_LOG && !['on', 'off'].includes(env.REQUEST_LOG)) throw new Error('Invalid REQUEST_LOG. Use on or off.');
  if (env.PUBLIC_APP_BASE_URL && !publicOrigin(env.PUBLIC_APP_BASE_URL)) throw new Error('PUBLIC_APP_BASE_URL must be an http(s) origin with no path, such as https://app.example.org.');
  if (env.PUBLIC_APP_BASE_URL && env.PUBLIC_PREVIEW_BASE_URL && publicOrigin(env.PUBLIC_APP_BASE_URL) === publicOrigin(env.PUBLIC_PREVIEW_BASE_URL)) throw new Error('The preview must use a different origin from PUBLIC_APP_BASE_URL.');
  const productionStages = (env.PRODUCTION_STAGES || 'on') === 'on';
  if (!isLoopback(host) && token.length < 24) throw new Error('Public binding requires a DEMO_ACCESS_TOKEN of at least 24 characters.');
  if (!isLoopback(host) && !env.PUBLIC_PREVIEW_BASE_URL) throw new Error('Public binding requires an explicit separate PUBLIC_PREVIEW_BASE_URL.');
  const number = (name, fallback, min, max) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}.`);
    return value;
  };
  return {
    rootDir, host, port: number('PORT', 8787, 0, 65535),
    previewPort: number('PREVIEW_PORT', 8788, 0, 65535),
    previewBaseUrl: env.PUBLIC_PREVIEW_BASE_URL || '',
    dataDir: path.resolve(rootDir, env.DATA_DIR || 'data'),
    accessToken: token,
    kiroPath: env.KIRO_CLI_PATH || (process.platform === 'win32' ? path.join(env.LOCALAPPDATA || '', 'Kiro-Cli', 'kiro-cli.exe') : 'kiro-cli'),
    kiroApiKey: env.KIRO_API_KEY || '', model: env.KIRO_MODEL || '',
    effort: env.KIRO_EFFORT || 'medium',
    // taste: host taste pass, blind prediction and binding Design DNA. research: the 0.3 plan/research/reconsider workflow with web tools.
    creativeProtocol: env.CREATIVE_PROTOCOL || 'taste',
    qlooKey: env.QLOO_API_KEY || '', qlooBaseUrl: env.QLOO_API_BASE_URL || 'https://hackathon.api.qloo.com',
    // Taste-led builds add the universal protocol's production stages: a reading of the taste input, a production plan
    // chosen from the capability list both arms share, and a review of captures of the saved site. off keeps the earlier
    // sequence. The stages take the model longer, so a run gets 15 minutes by default instead of 10.
    productionStages,
    runTimeoutMs: number('KIRO_RUN_TIMEOUT_MS', productionStages ? 900000 : 600000, 1000, 1800000),
    // local is this machine; hosted is a server without the machine's own tools, such as Codex image generation.
    environment: env.MOUSA_ENVIRONMENT || 'local',
    // Taste-led builds can request generated images from Codex when it is signed in with ChatGPT; off disables the tool in both arms.
    codexImages: env.CODEX_IMAGES || 'auto', codexCliPath: env.CODEX_CLI_PATH || '',
    // Seals the blind vote's ballots and keys its address hashes. TRUST_PROXY is how many proxies stand in front, each
    // appending to X-Forwarded-For: 1 for CloudFront or Caddy alone, 2 for CloudFront in front of Caddy.
    siteSecret: env.SITE_SECRET || '', trustProxy: number('TRUST_PROXY', 0, 0, 3),
    // The public address of the app when a proxy in front sends its own Host, as CloudFront does unless told otherwise;
    // a form's Origin may then name this address.
    appBaseUrl: publicOrigin(env.PUBLIC_APP_BASE_URL),
    // The public repository the site links to, once there is one.
    siteRepository: /^https:\/\/[^\s"'<>]+$/u.test(env.SITE_REPOSITORY_URL || '') ? env.SITE_REPOSITORY_URL : '',
    // The live try: the code jurors enter, or none when TRY_ACCESS is open (the hackathon gives jurors no field for a
    // code), whether a pair's two arms run at once, and the Qloo requests one try may send.
    tryAccessCode: env.TRY_ACCESS_CODE || '', tryOpen: env.TRY_ACCESS === 'open',
    tryArmsParallel: (env.TRY_ARMS_PARALLEL || 'on') === 'on', tryQlooBudget: number('TRY_QLOO_BUDGET', 24, 1, 60),
    // What the whole server may spend on the try in any rolling day, whoever asks: first steps, pairs and Kiro credits.
    // All three are off (0) unless set. A try open to anyone needs them: the jury's server allows 100 first steps and
    // 10 pairs a day. The credits are what Kiro's stream meters for each session; a host that meters nothing counts 0.
    tryDailyRuns: number('TRY_DAILY_RUNS', 0, 0, 100000), tryDailyPairs: number('TRY_DAILY_PAIRS', 0, 0, 100000), tryDailyCredits: number('TRY_DAILY_CREDITS', 0, 0, 10000000),
    // After this many days a finished try keeps its record, reports and designs but not its Kiro homes and session
    // streams, which only the operator reads; 0 keeps them for good, as a study on this machine wants.
    tryPrivateRetentionDays: number('TRY_PRIVATE_RETENTION_DAYS', 0, 0, 3650),
    // The longer side the engine scales a review capture to before handing it to the model; 0 leaves the engine's
    // own choice (1024 on a hosted server, 1568 elsewhere).
    captureInlineSide: env.MOUSA_CAPTURE_INLINE_SIDE ? number('MOUSA_CAPTURE_INLINE_SIDE', 0, 512, 2400) : 0,
    // text writes lines for a terminal; json writes one object a line for a log collector, and then logs each request
    // (its route pattern, never an id or a token) unless REQUEST_LOG says otherwise.
    logFormat: env.LOG_FORMAT || 'text', requestLog: (env.REQUEST_LOG || (env.LOG_FORMAT === 'json' ? 'on' : 'off')) === 'on',
    // The browser the try's sessions capture their designs with, when the machine's default one cannot run headless.
    captureBrowser: env.MOUSA_BROWSER || '', captureNoSandbox: env.MOUSA_CAPTURE_NO_SANDBOX === '1',
    // off closes the Studio's own job runs to new work, as on the jury's server; their records stay readable.
    legacyJobs: (env.LEGACY_JOBS || 'on') === 'on',
    // The commit a deployment was built from, which an image without git cannot look up; each try records it.
    commit: /^[0-9a-f]{7,40}$/u.test(env.MOUSA_COMMIT || '') ? env.MOUSA_COMMIT.slice(0, 12) : '',
    // Stored jobs, including finished ones; a local study can raise it without archiving earlier work.
    maxJobs: number('MAX_JOBS', 30, 1, 200), maxFiles: 30, maxFileBytes: 160000,
    maxProjectBytes: 1500000, maxBriefLength: 3500,
  };
}

export function redact(value, config = {}) {
  let text = String(value ?? '');
  for (const secret of [config.kiroApiKey, config.qlooKey, config.accessToken, config.tryAccessCode, config.siteSecret]) {
    if (secret) text = text.split(secret).join('[redacted]');
  }
  return text.replace(/ksk_[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}
