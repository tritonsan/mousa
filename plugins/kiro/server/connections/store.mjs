// The person's Moûsa connections file: what they entered on the connection page, kept outside every project and
// outside the chat. On Windows each secret is encrypted for the current user with DPAPI through Windows PowerShell;
// elsewhere the file is readable by its owner only. MOUSA_CONFIG_DIR moves the folder (tests, custom setups).

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export const CONNECTIONS_SCHEMA_VERSION = '1.0';
const FILE = 'connections.json';
const ENTROPY = 'mousa-connections-v1';
const PROTECT_TIMEOUT_MS = 20000;

export class ConnectionStoreError extends Error {
  constructor(message, code = 'CONNECTIONS_UNAVAILABLE') { super(message); this.name = 'ConnectionStoreError'; this.code = code; }
}

/** The folder of the connections file: MOUSA_CONFIG_DIR, else %APPDATA%\mousa on Windows, else ~/.config/mousa. */
export function connectionsDir({ env = process.env, platform = process.platform } = {}) {
  const configured = typeof env.MOUSA_CONFIG_DIR === 'string' ? env.MOUSA_CONFIG_DIR.trim() : '';
  if (configured) return path.resolve(configured);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'mousa');
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mousa');
}

/**
 * DPAPI for the current Windows user, through Windows PowerShell 5.1, which every supported Windows has. The secret
 * travels on stdin as base64, never on a command line, and comes back as base64.
 */
export function dpapiProtector({ env = process.env, spawnImpl = spawn } = {}) {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || env.WINDIR || 'C:\\Windows';
  const shell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = direction => "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;"
    + `$e=[Text.Encoding]::UTF8.GetBytes('${ENTROPY}');$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());`
    + `$o=[Security.Cryptography.ProtectedData]::${direction}($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser);`
    + '[Console]::Out.Write([Convert]::ToBase64String($o))';
  const run = (direction, inputBase64) => new Promise((resolve, reject) => {
    const child = spawnImpl(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script(direction)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new ConnectionStoreError('Windows did not answer the encryption request in time.')); }, PROTECT_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.resume();
    child.on('error', () => finish(new ConnectionStoreError('Windows PowerShell could not be started to protect the key.')));
    child.on('close', code => code === 0 && /^[A-Za-z0-9+/=]+$/u.test(out.trim())
      ? finish(null, out.trim())
      : finish(new ConnectionStoreError(direction === 'Unprotect'
        ? 'The saved key could not be decrypted for this Windows user. Connect again.'
        : 'Windows could not encrypt the key.', direction === 'Unprotect' ? 'CONNECTIONS_UNREADABLE' : 'CONNECTIONS_UNAVAILABLE')));
    child.stdin.end(inputBase64);
  });
  return {
    scheme: 'dpapi',
    async protect(text) { return run('Protect', Buffer.from(text, 'utf8').toString('base64')); },
    async unprotect(blob) { return Buffer.from(await run('Unprotect', blob), 'base64').toString('utf8'); },
  };
}

/** No encryption; the file itself is readable by its owner only. */
export const plainProtector = Object.freeze({ scheme: 'none', async protect(text) { return text; }, async unprotect(blob) { return blob; } });

export function defaultProtector({ env = process.env, platform = process.platform } = {}) {
  return platform === 'win32' ? dpapiProtector({ env }) : plainProtector;
}

/**
 * The store. read() returns {qloo: {apiKey, baseUrl, savedAt} | null, problem?}; a missing file is empty, an unreadable
 * one reports a problem instead of throwing. Results are cached until the next save.
 */
export function createConnectionStore({ env = process.env, platform = process.platform, protector = defaultProtector({ env, platform }) } = {}) {
  const dir = connectionsDir({ env, platform }), file = path.join(dir, FILE);
  let cached = null;

  async function readFile() {
    let raw;
    try { raw = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw new ConnectionStoreError('The connections file could not be read.', 'CONNECTIONS_UNREADABLE'); }
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('shape');
      return data;
    } catch { throw new ConnectionStoreError('The connections file is damaged. Connect again to replace it.', 'CONNECTIONS_UNREADABLE'); }
  }

  async function decode(entry) {
    if (!entry || typeof entry.value !== 'string' || !entry.value) return '';
    if (entry.scheme === 'none') return entry.value;
    if (entry.scheme !== protector.scheme) throw new ConnectionStoreError('The saved key was protected on another system. Connect again.', 'CONNECTIONS_UNREADABLE');
    return protector.unprotect(entry.value);
  }

  async function read() {
    if (cached) return cached;
    try {
      const data = await readFile();
      const qloo = data?.qloo && typeof data.qloo === 'object' ? data.qloo : null;
      const apiKey = qloo ? await decode(qloo.apiKey) : '';
      cached = { file, qloo: apiKey ? { apiKey, baseUrl: typeof qloo.baseUrl === 'string' ? qloo.baseUrl : null, savedAt: qloo.savedAt || null, protection: qloo.apiKey.scheme } : null };
    } catch (error) {
      cached = { file, qloo: null, problem: error instanceof ConnectionStoreError ? error.message : 'The connections file could not be read.' };
    }
    return cached;
  }

  async function write(data) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, file);
    if (platform !== 'win32') await fs.chmod(file, 0o600).catch(() => {});
    cached = null;
  }

  async function saveQloo({ apiKey, baseUrl }) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new ConnectionStoreError('A Qloo API key is required.', 'CONNECTIONS_INPUT_INVALID');
    let current = {};
    try { current = (await readFile()) || {}; } catch { current = {}; }
    const savedAt = new Date().toISOString();
    const value = await protector.protect(apiKey.trim());
    await write({ ...current, schemaVersion: CONNECTIONS_SCHEMA_VERSION, qloo: { apiKey: { scheme: protector.scheme, value }, baseUrl, savedAt } });
    return { file, savedAt, protection: protector.scheme };
  }

  async function clearQloo() {
    let current = {};
    try { current = (await readFile()) || {}; } catch { current = {}; }
    if (!current.qloo) { cached = null; return false; }
    const { qloo, ...rest } = current;
    void qloo;
    await write({ ...rest, schemaVersion: CONNECTIONS_SCHEMA_VERSION });
    return true;
  }

  return { file, read, saveQloo, clearQloo, protection: protector.scheme };
}
