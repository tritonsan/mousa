import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rootDir } from '../src/config.mjs';
import { dispatchRpc } from '../plugin/server/mcp/server.mjs';

const exec = promisify(execFile);
test('the 0.4.0 distributable contains the current self-contained plugin with matching discovery version', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-package-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const manifest = JSON.parse(await fs.readFile(path.join(rootDir, 'plugin', 'plugin.json'), 'utf8'));
  const packageInfo = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
  const initialization = await dispatchRpc({ message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } } });
  assert.equal(manifest.version, '0.4.0'); assert.equal(packageInfo.version, manifest.version);
  assert.equal(initialization.result.serverInfo.version, manifest.version);
  await exec(process.execPath, [path.join(rootDir, 'scripts', 'package-plugin.mjs')], { cwd: rootDir, env: { ...process.env, PLUGIN_PACKAGE_DIRECTORY: directory }, windowsHide: true });
  const archive = path.join(directory, `${manifest.name}-${manifest.version}.tar.gz`);
  const listing = (await exec('tar', ['-tzf', archive], { windowsHide: true })).stdout.trim().split(/\r?\n/u);
  assert.ok(listing.every(entry => entry.startsWith(manifest.name + '/') && !entry.includes('..') && !/(^|\/)(?:\.env|data|node_modules|\.git)(\/|$)/u.test(entry)));
  async function verify(relative = '') {
    for (const entry of await fs.readdir(path.join(rootDir, 'plugin', relative), { withFileTypes: true })) {
      const sourcePath = path.join(relative, entry.name);
      if (entry.isDirectory()) await verify(sourcePath);
      else {
        const archivePath = manifest.name + '/' + sourcePath.replaceAll('\\', '/');
        assert.ok(listing.includes(archivePath), `Missing archive file: ${archivePath}`);
        const actual = await exec('tar', ['-xOf', archive, archivePath], { encoding: 'buffer', windowsHide: true });
        assert.deepEqual(actual.stdout, await fs.readFile(path.join(rootDir, 'plugin', sourcePath)), `Stale archive file: ${archivePath}`);
      }
    }
  }
  await verify();
  // The font library travels with the plugin, byte for byte, so a standalone session loads the Studio's families.
  const catalog = JSON.parse(await fs.readFile(path.join(rootDir, 'library', 'fonts', 'fonts.json'), 'utf8'));
  for (const file of ['fonts.json', ...catalog.families.flatMap(family => [family.licenseFile, ...family.files.map(face => face.file)])]) {
    assert.ok(listing.includes(`${manifest.name}/library/fonts/${file}`), `Missing font library file: ${file}`);
  }
  assert.equal(listing.some(entry => /\/library\/(?:local-food|music)\//u.test(entry)), false);
});
