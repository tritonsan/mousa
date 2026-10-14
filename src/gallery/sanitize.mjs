// What a gallery entry may publish, and the scan that proves it published nothing else. A design's files are copied by
// web type only, without hidden files, dependencies, build configuration or server scripts, within a size bound; the
// scan then reads every text file of the entry for local paths, the run folder, the user's name, the deployment's own
// secrets and token-shaped strings, and a Qloo id or tag URN, which only Moûsa's private records hold.

import fs from 'node:fs/promises';
import path from 'node:path';

/** The types a published design plays from, with the type each is served as. */
export const PUBLIC_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
});
export const PUBLIC_LIMITS = Object.freeze({ fileBytes: 8 * 1024 * 1024, entryBytes: 40 * 1024 * 1024, files: 600 });
// Files a project carries that are not the design a visitor plays: its tooling, its notes and its records.
const LEFT_OUT = new Set(['node_modules', 'package.json', 'package-lock.json', 'vite.config.js', 'tailwind.config.js', 'postcss.config.js', 'tsconfig.json']);
// The earlier 0.4 surface kept the agent's records in the project as culture-*.json, Qloo's ids among them.
const RECORD_FILE = /^culture-[a-z-]{1,40}\.json$/u;
const TEXT = new Set(['.html', '.css', '.js', '.json', '.txt', '.svg']);

export class PublishError extends Error { constructor(message) { super(message); this.name = 'PublishError'; } }

/**
 * Copy the public files of `from` into `to`: web types only, no dot entry, no dependencies or build configuration, and
 * no folder named in `skip` (relative paths such as compare or dist). Links are not followed. `budget` is shared by the
 * entry's copies, so the entry as a whole stays within PUBLIC_LIMITS. Returns the relative paths copied.
 */
export async function copyPublic(from, to, { skip = [], budget = { bytes: 0, files: 0 } } = {}) {
  const copied = [];
  const skipped = new Set(skip.map(item => item.replaceAll('\\', '/').replace(/\/+$/u, '')));
  async function walk(dir, relative) {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.') || LEFT_OUT.has(entry.name.toLowerCase()) || RECORD_FILE.test(entry.name) || skipped.has(name) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await walk(path.join(dir, entry.name), name); continue; }
      if (!entry.isFile() || !PUBLIC_TYPES[path.extname(entry.name).toLowerCase()]) continue;
      const source = path.join(dir, entry.name);
      const { size } = await fs.stat(source);
      if (size > PUBLIC_LIMITS.fileBytes) throw new PublishError(`${name} is larger than ${PUBLIC_LIMITS.fileBytes / 1024 / 1024} MB.`);
      budget.bytes += size; budget.files += 1;
      if (budget.bytes > PUBLIC_LIMITS.entryBytes || budget.files > PUBLIC_LIMITS.files) throw new PublishError(`The entry holds more than ${PUBLIC_LIMITS.entryBytes / 1024 / 1024} MB or ${PUBLIC_LIMITS.files} files.`);
      const target = path.join(to, ...name.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      copied.push(name);
    }
  }
  await walk(from, '');
  return copied;
}

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * A built site played from a folder of the gallery rather than from an origin's root: its root-relative URLs to its
 * own files, such as Vite's /assets/index.js or a public font at /fonts/x.woff2, become relative to each file. Only a
 * URL whose first segment is one of the copied files or folders changes. Returns how many files were rewritten.
 */
export async function rebaseRootUrls(dir, copied) {
  const tops = [...new Set(copied.map(name => name.split('/')[0]))].map(escapeRegExp);
  if (!tops.length) return 0;
  const pattern = new RegExp(`(["'(=\\s])/((?:${tops.join('|')})(?=[/"'?#)\\s]|$))`, 'gu');
  let changed = 0;
  for (const name of copied.filter(file => /\.(?:html?|css|m?js)$/iu.test(file))) {
    const file = path.join(dir, ...name.split('/'));
    const text = await fs.readFile(file, 'utf8');
    const prefix = '../'.repeat(name.split('/').length - 1) || './';
    const next = text.replace(pattern, (match, lead, rest) => `${lead}${prefix}${rest}`);
    if (next !== text) { await fs.writeFile(file, next); changed++; }
  }
  return changed;
}

/**
 * What must never appear in a published file: local paths, the folder the runs live in, the user's name, the values of
 * the deployment's secrets, token-shaped strings and Qloo's ids and tag URNs. `user`, `runsDir` and `secrets` are this
 * machine's own; each pattern carries the name a finding reports.
 */
export function leakPatterns({ user = null, runsDir = null, folders = [], secrets = [] } = {}) {
  const patterns = [
    ['local path', /\b[A-Za-z]:[\\/](?:Users|mousa-live|Qloo Hackathon|Program Files|ProgramData|Windows)\b/iu],
    ['home path', /(?<![\w.-])\/(?:home|Users|root)\/[A-Za-z0-9._-]+/u],
    ['run folder', /mousa-live/iu],
    ['Qloo id', /\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b/u],
    ['Qloo URN', /\burn:(?:tag|entity|audience):/u],
    ['token', /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bksk_[A-Za-z0-9_-]{8,}|\bAKIA[0-9A-Z]{16}\b|Bearer\s+[A-Za-z0-9._-]{16,}/u],
  ];
  if (typeof user === 'string' && user.length >= 3) patterns.push(['user name', new RegExp(`\\b${escapeRegExp(user)}\\b`, 'iu')]);
  // The folders runs were kept in, such as a server's DATA_DIR/try: the path of one never belongs in what is published.
  for (const folder of [runsDir, ...folders]) {
    if (typeof folder === 'string' && folder.length >= 4) patterns.push(['run folder', new RegExp(escapeRegExp(folder.replaceAll('\\', '/')).replaceAll('/', '[\\\\/]'), 'iu')]);
  }
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 8) patterns.push(['secret', new RegExp(escapeRegExp(secret), 'u')]);
  return patterns;
}

/** Every finding of `patterns` in the text files under `dir`, as {file, pattern, sample}; an empty list means clean. */
export async function leakScan(dir, patterns) {
  const findings = [];
  async function walk(folder, relative) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { await walk(path.join(folder, entry.name), name); continue; }
      if (!entry.isFile() || !TEXT.has(path.extname(entry.name).toLowerCase())) continue;
      const text = await fs.readFile(path.join(folder, entry.name), 'utf8');
      for (const [label, pattern] of patterns) {
        const match = pattern.exec(text);
        if (match) findings.push({ file: name, pattern: label, sample: text.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30).replace(/\s+/gu, ' ') });
      }
    }
  }
  if (await fs.stat(dir).then(stat => stat.isDirectory(), () => false)) await walk(dir, '');
  return findings;
}
