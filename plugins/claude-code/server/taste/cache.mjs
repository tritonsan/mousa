// A Qloo client that remembers answers in the project's .mousa/cache/qloo folder, so a second design for the same
// audience, a repeated question or a retried session costs no request. Entries are keyed by the method, its arguments
// and the API address, and expire after a week; refresh skips them. Errors are never stored. The folder carries its
// own .gitignore: raw Qloo answers stay on this computer.
//
// A budget caps the requests one project folder sends to Qloo, counted in .mousa/usage.json across sessions. Each
// request is counted before it is sent, failed ones too, and the cache keeps answering for free once it is spent.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { QlooError } from '../qloo/client.mjs';

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

/** The Qloo requests a project folder has sent, from its usage record; 0 before the first. */
export async function readQlooUsage(file) {
  try { const usage = JSON.parse(await fs.readFile(file, 'utf8')); return Number.isInteger(usage?.qlooRequests) && usage.qlooRequests > 0 ? usage.qlooRequests : 0; } catch { return 0; }
}

export function createCachingClient({ client, dir, baseUrl = '', ttlMs = CACHE_TTL_MS, refresh = false, now = Date.now, budget = null } = {}) {
  if (!client || !dir) throw new Error('A Qloo client and a cache folder are required.');
  const stats = { hits: 0, misses: 0 };
  // The count is loaded once and then checked and raised in one step, so requests sent in parallel cannot pass it.
  let used = null, loading = null, writing = Promise.resolve();
  const load = () => loading ||= (budget?.file ? readQlooUsage(budget.file) : Promise.resolve(0)).then(value => { used = value; });
  async function spend(method) {
    await load();
    if (budget?.limit && used >= budget.limit) {
      throw new QlooError('QLOO_BUDGET', `This project's Qloo budget of ${budget.limit} requests (MOUSA_QLOO_BUDGET) is spent, so ${method} was not sent. Cached answers still work; ask the person before raising the budget.`);
    }
    used++;
    // Writes queue behind each other and read the count when they run, so the record ends with the latest count.
    if (budget?.file) {
      writing = writing.then(async () => {
        await fs.mkdir(path.dirname(budget.file), { recursive: true });
        await fs.writeFile(budget.file, `${JSON.stringify({ qlooRequests: used, updatedAt: new Date(now()).toISOString(), ...(budget.limit ? { budget: budget.limit } : {}) }, null, 2)}
`);
      }).catch(() => {});
      await writing;
    }
  }
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
    await spend(method);
    const result = await client[method](args);
    stats.misses++;
    await prepare();
    const savedAt = new Date(now()).toISOString();
    await fs.writeFile(file, JSON.stringify({ method, savedAt, result })).catch(() => {});
    return { ...result, cache: { hit: false, savedAt } };
  }

  return Object.fromEntries([...METHODS.map(method => [method, args => cached(method, args)]), ['stats', stats]]);
}
