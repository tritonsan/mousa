// A Qloo client that remembers answers in the project's .mousa/cache/qloo folder, so a second design for the same
// audience, a repeated question or a retried session costs no request. Entries are keyed by the method, its arguments
// and the API address, and expire after a week; refresh skips them. Errors are never stored. The folder carries its
// own .gitignore: raw Qloo answers stay on this computer.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const METHODS = Object.freeze(['searchEntities', 'searchTags', 'searchAudiences', 'getInsights']);

/** JSON with sorted keys, so the same arguments always give the same key. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export function cacheKey(method, args, baseUrl = '') {
  return crypto.createHash('sha256').update(`${baseUrl}\n${method}\n${canonical(args ?? {})}`).digest('hex');
}

export function createCachingClient({ client, dir, baseUrl = '', ttlMs = CACHE_TTL_MS, refresh = false, now = Date.now } = {}) {
  if (!client || !dir) throw new Error('A Qloo client and a cache folder are required.');
  const stats = { hits: 0, misses: 0 };
  let prepared = null;
  const prepare = () => prepared ||= fs.mkdir(dir, { recursive: true }).then(() => fs.writeFile(path.join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch(() => {}));

  async function cached(method, args) {
    const key = cacheKey(method, args, baseUrl), file = path.join(dir, `${key}.json`);
    if (!refresh) {
      try {
        const entry = JSON.parse(await fs.readFile(file, 'utf8'));
        if (entry?.method === method && Number.isFinite(Date.parse(entry.savedAt)) && now() - Date.parse(entry.savedAt) <= ttlMs) {
          stats.hits++;
          return { ...structuredClone(entry.result), cache: { hit: true, savedAt: entry.savedAt } };
        }
      } catch { /* A missing or unreadable entry is a miss. */ }
    }
    if (typeof client[method] !== 'function') throw Object.assign(new Error(`${method} is not available.`), { code: 'QLOO_INPUT_INVALID' });
    const result = await client[method](args);
    stats.misses++;
    await prepare();
    const savedAt = new Date(now()).toISOString();
    await fs.writeFile(file, JSON.stringify({ method, savedAt, result })).catch(() => {});
    return { ...result, cache: { hit: false, savedAt } };
  }

  return Object.fromEntries([...METHODS.map(method => [method, args => cached(method, args)]), ['stats', stats]]);
}
