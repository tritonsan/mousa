// The Tailwind example: the Vite and Tailwind CSS 4 site the packaged plugin restyles. What the plugin reads in it
// (a Tailwind 4 web project whose @theme its classes name), that a DNA in its own values binds through that theme, and
// that its packages are pinned and its build output is left out of the check. No build, model or request is made.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rootDir } from '../src/config.mjs';
import { checkDnaConformance } from '../plugin/server/culture/taste.mjs';
import { collectProjectFiles, detectDesignSystem, checkDesignSystem } from '../plugin/server/design/systems.mjs';
import { tailwindTheme, utilityNames } from '../plugin/server/design/tailwind.mjs';
import { colorValues } from '../plugin/server/design/colors.mjs';

const example = path.join(rootDir, 'examples', 'tailwind-site');
const device = (id, layer, tokens) => ({ id, layer, device: `${layer} device`, tokens: { colors: [], fonts: [], css: [], ids: [], copy: [], images: [], keyframes: [], svg: [], ...tokens } });

test('the Tailwind example is read as a Tailwind 4 web project, and a DNA in its own values binds through its theme', async () => {
  const files = await collectProjectFiles(example);
  assert.deepEqual(Object.keys(files).sort(), ['index.html', 'src/main.js', 'src/screenings.js', 'src/style.css', 'vite.config.js'], 'no README, package files or build output');
  const detected = detectDesignSystem(files);
  assert.deepEqual([detected.system, detected.medium, detected.entry], ['tailwind', 'web', 'index.html']);
  const theme = tailwindTheme(files);
  assert.equal(theme.version, 4);
  assert.deepEqual([...theme.colors.keys(), ...theme.fonts.keys()], ['brand', 'brand-dark', 'display']);
  const used = utilityNames(files);
  assert.ok(used.colors.has('brand') && used.colors.has('brand-dark') && used.fonts.has('display'), 'the page and the script name the theme');

  const [brand, dark] = ['brand', 'brand-dark'].map(name => colorValues(theme.colors.get(name))[0]);
  const dna = { devices: [device('dna1', 'palette', { colors: [brand, dark] })] };
  const report = checkDesignSystem(dna, files, checkDnaConformance(dna, files), detected);
  assert.equal(report.devices.find(item => item.id === 'dna1').status, 'present', 'the oklch theme values are the DNA\'s hex colours');
  assert.deepEqual(report.system.bindings.map(item => item.name), ['brand', 'brand-dark']);
});

test('the Tailwind example pins its packages, builds to dist and keeps its facts in one module', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(example, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(example, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.scripts.build, 'vite build');
  for (const name of ['vite', 'tailwindcss', '@tailwindcss/vite']) {
    assert.ok(pkg.devDependencies[name], `${name} is a dev dependency`);
    assert.ok(lock.packages[`node_modules/${name}`]?.version, `${name} is pinned in the lock file`);
  }
  assert.match(lock.packages['node_modules/tailwindcss'].version, /^4\./u);
  assert.deepEqual((await fs.readFile(path.join(example, '.gitignore'), 'utf8')).split(/\r?\n/u).filter(Boolean), ['node_modules/', 'dist/'], 'Tailwind\'s source scan skips both');
  const { days, screenings } = await import(new URL(`file:///${path.join(example, 'src', 'screenings.js').replace(/\\/gu, '/')}`).href);
  assert.equal(screenings.length, 4);
  assert.ok(screenings.every(film => film.times.every(slot => days.includes(slot.day))), 'every screening is on an opening day');
});
