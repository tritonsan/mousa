import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { redact } from './config.mjs';
const exec = promisify(execFile);

export async function inspectKiro(config) {
  const common = { timeout: 15000, windowsHide: true, maxBuffer: 100000, env: { ...process.env, ...(config.kiroApiKey ? { KIRO_API_KEY: config.kiroApiKey } : {}) } };
  const result = { available: false, authenticated: false, version: '', authentication: 'missing', error: null, defaultModel: config.model || '' };
  try {
    const version = await exec(config.kiroPath, ['--version'], common);
    result.available = true; result.version = version.stdout.trim().slice(0, 120);
  } catch (e) {
    result.error = e.code === 'ENOENT' ? 'Kiro CLI not found.' : 'Kiro CLI could not be executed.';
    return result;
  }
  if (config.kiroApiKey) {
    // Presence is not verification. The first real job checks validity with Kiro.
    result.authenticated = true; result.authentication = 'api_key_present';
  } else {
    try {
      await exec(config.kiroPath, ['whoami'], common);
      result.authenticated = true; result.authentication = 'local_login_present';
    } catch (e) {
      const msg = redact(e.stderr || '', config);
      result.authentication = /os error 5|access denied|erişim engellendi/i.test(msg) ? 'inspection_blocked' : 'missing';
      result.error = result.authentication === 'inspection_blocked' ? 'The Kiro session cannot be inspected with the current process permissions.' : 'A Kiro session or headless API key is required.';
    }
  }
  if (!result.defaultModel) {
    try {
      const model = await exec(config.kiroPath, ['settings', 'chat.defaultModel'], common);
      const candidate = model.stdout.trim().replace(/\s+\((global|local)\)$/, '');
      if (/^[a-zA-Z0-9._:/-]{1,120}$/.test(candidate)) result.defaultModel = candidate;
    } catch { /* UI reports an explicit model requirement. */ }
  }
  return result;
}
