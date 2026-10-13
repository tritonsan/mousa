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

export function getConfig(env = process.env) {
  const host = env.HOST || '127.0.0.1';
  const token = env.DEMO_ACCESS_TOKEN || '';
  if (env.KIRO_EFFORT && !['low', 'medium', 'high', 'xhigh', 'max'].includes(env.KIRO_EFFORT)) throw new Error('Invalid KIRO_EFFORT.');
  if (env.CREATIVE_PROTOCOL && !['taste', 'research'].includes(env.CREATIVE_PROTOCOL)) throw new Error('Invalid CREATIVE_PROTOCOL. Use taste or research.');
  if (env.CODEX_IMAGES && !['auto', 'off'].includes(env.CODEX_IMAGES)) throw new Error('Invalid CODEX_IMAGES. Use auto or off.');
  if (env.PRODUCTION_STAGES && !['on', 'off'].includes(env.PRODUCTION_STAGES)) throw new Error('Invalid PRODUCTION_STAGES. Use on or off.');
  if (env.MOUSA_ENVIRONMENT && !['local', 'hosted'].includes(env.MOUSA_ENVIRONMENT)) throw new Error('Invalid MOUSA_ENVIRONMENT. Use local or hosted.');
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
    // Stored jobs, including finished ones; a local study can raise it without archiving earlier work.
    maxJobs: number('MAX_JOBS', 30, 1, 200), maxFiles: 30, maxFileBytes: 160000,
    maxProjectBytes: 1500000, maxBriefLength: 3500,
  };
}

export function redact(value, config = {}) {
  let text = String(value ?? '');
  for (const secret of [config.kiroApiKey, config.qlooKey, config.accessToken]) {
    if (secret) text = text.split(secret).join('[redacted]');
  }
  return text.replace(/ksk_[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}
