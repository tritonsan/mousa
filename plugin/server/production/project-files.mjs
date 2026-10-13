// The project folder a standalone plugin session may touch. MOUSA_PROJECT_DIR in the server's environment names it,
// so the person who configures the server decides where its tools read and write; a tool never takes a folder from
// the agent. Writes go only to .mousa/ (captures and the session's records) and to asset folders inside the project.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const STATE_DIR = '.mousa';
// The request _meta key under which Codex sends its sandbox state to a server that advertises the same capability.
export const CODEX_SANDBOX_META = 'codex/sandbox-state-meta';
const BLOCKED = new Set(['.git', '.env', '.aws', '.ssh', '.codex', '.agents', '.kiro', 'node_modules']);
const TEXT_TYPES = /\.(?:html?|css|m?js|jsx|tsx?|json|svg|md|txt|xml|ya?ml|swift|kt|kts|dart|java|vue|svelte|astro)$/iu;
export const PROJECT_LIMITS = Object.freeze({ files: 20, fileBytes: 200 * 1024 });

export class ProjectScopeError extends Error {
  constructor(message, code = 'PROJECT_SCOPE_INVALID') { super(message); this.name = 'ProjectScopeError'; this.code = code; }
}

/** The configured project folder, resolved and checked, or an error that says how to configure it. */
export async function projectRoot(env = process.env) {
  const configured = typeof env.MOUSA_PROJECT_DIR === 'string' ? env.MOUSA_PROJECT_DIR.trim() : '';
  if (!configured) throw new ProjectScopeError('Set MOUSA_PROJECT_DIR in the MCP server environment to the project folder; the file tools read and write only there.', 'PROJECT_DIR_MISSING');
  const root = await fs.realpath(path.resolve(configured)).catch(() => null);
  const stat = root ? await fs.stat(root).catch(() => null) : null;
  if (!stat?.isDirectory()) throw new ProjectScopeError('MOUSA_PROJECT_DIR does not name an existing folder.', 'PROJECT_DIR_MISSING');
  return root;
}

const unfilled = value => typeof value !== 'string' || !value.trim() || /^\$\{[^}]*\}$/u.test(value.trim()) || /^%[A-Za-z_][A-Za-z0-9_]*%$/u.test(value.trim());

/**
 * The working folder a host reports with a tool call. Codex sends its sandbox state under CODEX_SANDBOX_META to a
 * server that advertises that capability; sandboxCwd is a file URI such as file:///D:/Projects/site. Only the folder
 * is read; the rest of the state is not interpreted.
 */
export function sandboxCwdFromMeta(meta) {
  const state = meta && typeof meta === 'object' ? meta[CODEX_SANDBOX_META] : null;
  const value = state && typeof state === 'object' ? state.sandboxCwd : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return value.startsWith('file:') ? fileURLToPath(value) : path.isAbsolute(value) ? value : null; } catch { return null; }
}

/**
 * An existing folder the plugin may treat as a project: resolved through links, not a drive or filesystem root and
 * not the home folder itself, which would hand every personal file to the file tools.
 */
export async function checkProjectFolder(value) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value.trim())) throw new ProjectScopeError('Give the project folder as an absolute path.', 'PROJECT_DIR_INVALID');
  const root = await fs.realpath(path.resolve(value.trim())).catch(() => null);
  const stat = root ? await fs.stat(root).catch(() => null) : null;
  if (!stat?.isDirectory()) throw new ProjectScopeError('That project folder does not exist.', 'PROJECT_DIR_INVALID');
  if (path.parse(root).root === root) throw new ProjectScopeError('A drive or filesystem root is too broad for a project folder.', 'PROJECT_DIR_INVALID');
  const home = await fs.realpath(os.homedir()).catch(() => os.homedir());
  if (root.toLowerCase() === home.toLowerCase()) throw new ProjectScopeError('The home folder is too broad for a project folder; name the project inside it.', 'PROJECT_DIR_INVALID');
  return root;
}

/**
 * The project folder of a plugin session and where it came from: MOUSA_PROJECT_DIR (Claude Code fills it from
 * ${CLAUDE_PROJECT_DIR}), else the folder the host reports with the call (Codex), else the one the person approved
 * with mousa_open_project (`session.root`). The person still decides: a host setting or an approved call names it.
 */
export async function resolveProjectRoot({ env = process.env, meta = null, session = null } = {}) {
  if (!unfilled(env.MOUSA_PROJECT_DIR)) return { root: await projectRoot(env), source: 'environment' };
  const reported = sandboxCwdFromMeta(meta);
  if (reported) {
    try { return { root: await checkProjectFolder(reported), source: 'host' }; } catch { /* Fall through to an approved folder. */ }
  }
  if (session?.root) return { root: session.root, source: 'approved' };
  throw new ProjectScopeError('No project folder is set. Ask the person which folder to design in, then call mousa_open_project with it.', 'PROJECT_DIR_MISSING');
}

/**
 * A relative path inside the project: forward or back slashes, no absolute or drive paths, no "." or ".." segments,
 * and no hidden or tool folder such as .git, .env or node_modules unless `state` allows the session's own .mousa/.
 */
export function relativePath(value, { state = false, name = 'path' } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new ProjectScopeError(`${name}: use a relative path of at most 200 characters.`);
  const segments = value.trim().replaceAll('\\', '/').split('/');
  if (/^[\/]/u.test(value.trim()) || /[:\u0000-\u001f*?"<>|]/u.test(value) || segments.some(part => !part || part === '.' || part === '..')) throw new ProjectScopeError(`${name}: use a relative path inside the project, without "..".`);
  const hidden = segments.find(part => part.startsWith('.') || BLOCKED.has(part.toLowerCase()));
  if (hidden && !(state && segments[0] === STATE_DIR && segments.slice(1).every(part => !part.startsWith('.')))) throw new ProjectScopeError(`${name}: ${hidden} is outside what the plugin may touch.`);
  return segments.join('/');
}

/** The absolute path of a relative project path, refusing one that a link would take outside the project. */
export async function resolveInProject(root, relative, options) {
  const clean = relativePath(relative, options);
  const target = path.join(root, ...clean.split('/'));
  let existing = target;
  while (existing !== root && !(await fs.lstat(existing).then(() => true, () => false))) existing = path.dirname(existing);
  const real = await fs.realpath(existing);
  if (real !== root && !real.startsWith(root + path.sep)) throw new ProjectScopeError(`${clean} leads outside the project.`);
  return { relative: clean, file: target };
}

/** Text files of the project by relative path, as the conformance checks read them. */
export async function readProjectFiles(root, paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > PROJECT_LIMITS.files) throw new ProjectScopeError(`paths: name 1-${PROJECT_LIMITS.files} text files of the project.`);
  const files = {};
  for (const item of paths) {
    const { relative, file } = await resolveInProject(root, item, { name: 'paths' });
    if (!TEXT_TYPES.test(relative)) throw new ProjectScopeError(`${relative} is not a text file the checks read.`);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) throw new ProjectScopeError(`${relative} does not exist in the project.`, 'PROJECT_FILE_MISSING');
    if (stat.size > PROJECT_LIMITS.fileBytes) throw new ProjectScopeError(`${relative} is larger than ${PROJECT_LIMITS.fileBytes / 1024} KiB.`);
    files[relative] = await fs.readFile(file, 'utf8');
  }
  return files;
}

/** A JSON record the session keeps under .mousa/, such as the captures it issued; null before the first write. */
export async function readState(root, name) {
  const { file } = await resolveInProject(root, `${STATE_DIR}/${name}.json`, { state: true });
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}
export async function writeState(root, name, value) {
  const { file } = await resolveInProject(root, `${STATE_DIR}/${name}.json`, { state: true });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
