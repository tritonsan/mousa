// Kiro's own read tool in a session that reviews captures of its result, for the Studio and the game harness alike:
// the agent setting that points it at the review folder and keeps the session's other files closed, and the audit of
// which captures it opened, read from the session records Kiro keeps under <KIRO_HOME>/sessions/cli/<uuid>.jsonl.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The read tool of a session that reviews captures. Observed live with kiro-cli 2.24.0 and 2.27.1 (agent engine v2,
 * scripts/verify-kiro-review-read-live.mjs): allowedPaths does not narrow the tool, which opens any file in its working
 * folder that deniedPaths does not name; a denied path or pattern is rejected as forbidden, and a read outside the
 * folder needs an approval a non-interactive run cannot give, so it fails. The session goes on after either refusal.
 * So the session's other folders (`denied`) and files (`files`), relative to `dir`, are denied by name, and so are the
 * repository's .env and the user's credential folders, which lie outside it.
 */
export function reviewReadSettings({ dir, denied = [], files = [], review = 'review', rootDir = repositoryRoot, home = os.homedir() }) {
  const glob = value => value.replaceAll('\\', '/');
  return { allowedPaths: [`./${review}/**`],
    deniedPaths: [...denied.map(folder => `${glob(path.join(dir, folder))}/**`), ...files.map(file => glob(path.join(dir, file))), glob(path.join(rootDir, '.env')),
      ...['.codex', '.aws', '.ssh', '.kiro'].map(folder => `${glob(path.join(home, folder))}/**`)] };
}

/** Every string in a tool call's input, however it nests its paths. */
function strings(value, found = [], depth = 0) {
  if (typeof value === 'string') found.push(value);
  else if (value && typeof value === 'object' && depth < 8 && found.length < 400) for (const item of Object.values(value)) strings(item, found, depth + 1);
  return found;
}

/**
 * The captures a Kiro session opened: successful calls of its built-in read tool whose input names a capture file
 * (<id>.png). Kiro records such a call as BuiltIn FileRead {operations:[{mode:'Image', paths:[...]}]}, by the relative
 * or absolute path the model gave, before its next MCP call reaches the host (observed live). Null when the session has
 * no record, as in a scripted dry run or a test runner, so a review there is recorded as unaudited rather than refused.
 */
export async function openedCaptures({ home, captures }) {
  const directory = path.join(home, 'sessions', 'cli');
  let names;
  try { names = (await fs.readdir(directory)).filter(name => /^[a-f0-9-]{36}\.jsonl$/iu.test(name)); } catch { return null; }
  if (!names.length) return null;
  const byFile = new Map(captures.map(capture => [`${capture.id}.png`.toLowerCase(), capture.id]));
  const opened = new Set();
  for (const name of names.slice(0, 8)) {
    const text = await fs.readFile(path.join(directory, name), 'utf8').catch(() => '');
    for (const line of text.split(/\r?\n/u)) {
      if (!line.includes('"BuiltIn"')) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record?.kind !== 'ToolResults') continue;
      for (const item of Object.values(record.data?.results || {})) {
        const builtIn = item?.tool?.kind?.BuiltIn;
        if (!builtIn || typeof builtIn !== 'object' || !item.result || !Object.hasOwn(item.result, 'Success')) continue;
        for (const [tool, input] of Object.entries(builtIn)) {
          if (!/read/iu.test(tool)) continue;
          for (const value of strings(input)) {
            const file = value.replaceAll('\\', '/').split('/').pop().toLowerCase();
            if (byFile.has(file)) opened.add(byFile.get(file));
          }
        }
      }
    }
  }
  return opened;
}

/**
 * As openedCaptures, read once more after `waitMs` when the record does not yet show every capture of `expected`: Kiro
 * may write a tool result to its session record shortly after the tool returns.
 */
export async function openedCapturesSettled({ home, captures, expected = [], waitMs = 1500 }) {
  const opened = await openedCaptures({ home, captures });
  if (!opened || expected.every(id => opened.has(id))) return opened;
  await new Promise(resolve => setTimeout(resolve, waitMs));
  return openedCaptures({ home, captures });
}

/**
 * The host's account of a session's reviews, after the run: which cited captures its read tool opened, from the
 * session record in `home`, and what changed after the last review, from `changed(review)`. A scripted session has no
 * record, so its reviews are unaudited.
 */
export async function auditReviews({ home, reviews = [], captures = [], changed }) {
  const cited = [...new Set(reviews.flatMap(review => review.criteria.map(item => item.capture)))];
  const opened = captures.length ? await openedCaptures({ home, captures }) : null;
  const last = reviews.at(-1);
  const after = last ? (last.repairs || changed(last)) : null;
  return { rounds: reviews.length, captures: captures.length, cited,
    ...(opened ? { audited: true, opened: cited.filter(id => opened.has(id)), unopened: cited.filter(id => !opened.has(id)) } : { audited: false }),
    ...(after ? { afterLastReview: after } : {}) };
}
