// Where the plugin finds its connections. The environment wins: hosts put the person's settings there (Claude Code
// substitutes its install-time fields into the MCP server's env; Codex passes the variables its env_vars list names).
// Otherwise the connections file the person filled on the connection page is used.

import { QlooClient } from '../qloo/client.mjs';

export const DEFAULT_QLOO_BASE_URL = 'https://hackathon.api.qloo.com';
export const QLOO_ENDPOINTS = Object.freeze([
  Object.freeze({ id: 'hackathon', label: 'Qloo hackathon API', url: 'https://hackathon.api.qloo.com' }),
  Object.freeze({ id: 'production', label: 'Qloo production API', url: 'https://api.qloo.com' }),
  Object.freeze({ id: 'staging', label: 'Qloo staging API', url: 'https://staging.api.qloo.com' }),
]);
export const HOSTS = Object.freeze(['claude-code', 'codex', 'kiro']);

/**
 * A setting as the host passed it, or '' when it is empty or an unfilled placeholder: a host that substitutes
 * configuration passes an unset option through literally, such as ${user_config.qloo_api_key} or ${CLAUDE_PROJECT_DIR}.
 */
export function envValue(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || /^\$\{[^}]*\}$/u.test(text) || /^\$[A-Za-z_][A-Za-z0-9_]*$/u.test(text) || /^%[A-Za-z_][A-Za-z0-9_]*%$/u.test(text)) return '';
  return text;
}

/** The host the plugin package declared in MOUSA_HOST, or 'unknown'. */
export function hostName(env = process.env) {
  const value = envValue(env.MOUSA_HOST).toLowerCase();
  return HOSTS.includes(value) ? value : 'unknown';
}

/** Only the documented HTTPS endpoints shape: an invalid base URL falls back to the default rather than failing later. */
function baseUrlOf(value) {
  const text = envValue(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href.replace(/\/$/u, '') : '';
  } catch { return ''; }
}

/** The Qloo connection to use now: {apiKey, baseUrl, source: 'environment'|'connections file'|null, savedAt?, problem?}. */
export async function resolveQlooConnection({ env = process.env, store } = {}) {
  const envKey = envValue(env.QLOO_API_KEY), envBase = baseUrlOf(env.QLOO_BASE_URL);
  if (envKey) return { apiKey: envKey, baseUrl: envBase || DEFAULT_QLOO_BASE_URL, source: 'environment' };
  const saved = store ? await store.read() : null;
  if (saved?.qloo?.apiKey) {
    return { apiKey: saved.qloo.apiKey, baseUrl: envBase || baseUrlOf(saved.qloo.baseUrl) || DEFAULT_QLOO_BASE_URL, source: 'connections file',
      savedAt: saved.qloo.savedAt, protection: saved.qloo.protection };
  }
  return { apiKey: '', baseUrl: envBase || DEFAULT_QLOO_BASE_URL, source: null, ...(saved?.problem ? { problem: saved.problem } : {}) };
}

/**
 * One Qloo request that tells whether a key works: an entity search for a well-known film. Returns {ok:true} or
 * {ok:false, code, message} in the person's terms; never the key.
 */
export async function testQlooKey({ apiKey, baseUrl = DEFAULT_QLOO_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
  let client;
  try { client = new QlooClient({ apiKey, baseUrl, fetchImpl }); } catch { return { ok: false, code: 'QLOO_INPUT_INVALID', message: 'That Qloo address is not valid.' }; }
  try {
    await client.searchEntities({ query: 'Paterson', limit: 1 });
    return { ok: true };
  } catch (error) {
    const code = error?.code || 'QLOO_NETWORK';
    const message = code === 'QLOO_KEY_MISSING' ? 'Enter a Qloo API key.'
      : code === 'QLOO_AUTH' || code === 'QLOO_FORBIDDEN' ? 'Qloo did not accept this key for the selected API. Check the key and the API address.'
        : code === 'QLOO_RATE_LIMIT' ? 'Qloo is limiting requests right now. Wait a minute and try again.'
          : code === 'QLOO_TIMEOUT' || code === 'QLOO_NETWORK' ? 'Qloo could not be reached from this computer.'
            : 'Qloo answered with an error. Try again in a moment.';
    return { ok: false, code, message };
  }
}
