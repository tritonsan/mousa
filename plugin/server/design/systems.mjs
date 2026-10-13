// The project's own design system. detectDesignSystem reads what kind of project it is and where its values live; the
// CSS variable adapter then checks, beyond the literal conformance check, that each palette and typography value of
// the Design DNA is the value of a custom property the styles actually use through var(), names the property that
// carries it, and resolves var() chains so a CSS token written as letter-spacing: var(--tracking) still counts.
// Projects without custom properties are checked as text, and the specimen board shows any design for review.

import fs from 'node:fs/promises';
import path from 'node:path';
import { cssDeclarations, colorsIn, normalizeTasteName } from '../culture/taste.mjs';

export const PROJECT_FILE_LIMITS = Object.freeze({ files: 80, fileBytes: 200 * 1024, depth: 6 });
const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'fonts', 'generated']);
const TEXT = /\.(?:html?|css|m?js|cjs|jsx|tsx?|vue|svelte|astro|json|svg)$/iu;
const COMPONENTS = /\.(?:jsx|tsx|vue|svelte|astro)$/iu;

/** The project's design-relevant text files, bounded: pages, styles, scripts, token files and SVG drawings. */
export async function collectProjectFiles(root, { limits = PROJECT_FILE_LIMITS } = {}) {
  const files = {};
  let count = 0;
  async function walk(dir, depth) {
    if (depth > limits.depth || count >= limits.files) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    // Files of a folder before its subfolders, so the pages at the top are never crowded out.
    entries.sort((a, b) => Number(a.isDirectory()) - Number(b.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (count >= limits.files) return;
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) { if (!SKIP.has(entry.name.toLowerCase())) await walk(path.join(dir, entry.name), depth + 1); continue; }
      if (!entry.isFile() || !TEXT.test(entry.name) || /^culture-.*\.json$/u.test(entry.name) || /^package(?:-lock)?\.json$/u.test(entry.name)) continue;
      const file = path.join(dir, entry.name);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat || stat.size > limits.fileBytes) continue;
      files[path.relative(root, file).split(path.sep).join('/')] = await fs.readFile(file, 'utf8');
      count++;
    }
  }
  await walk(root, 0);
  return files;
}

/**
 * What kind of project this is: the medium the checks use (web for pages and stylesheets, app-ui for pages with a
 * design token file, generic for component sources such as JSX and anything else), whether its values live in CSS
 * custom properties, and its entry page.
 */
export function detectDesignSystem(files) {
  const names = Object.keys(files);
  const pages = names.filter(name => /\.html?$/iu.test(name));
  const components = names.some(name => COMPONENTS.test(name));
  const tokensFile = names.find(name => /(?:^|\/)tokens\.json$/iu.test(name)) || null;
  const custom = new Set(cssDeclarations(files).filter(rule => rule.property.startsWith('--')).map(rule => rule.property));
  const tailwind = names.some(name => /(?:^|\/)tailwind\.config\.(?:js|cjs|mjs|ts)$/iu.test(name))
    || Object.entries(files).some(([name, text]) => /\.css$/iu.test(name) && /@tailwind\b|@import\s+["']tailwindcss|@theme\b/u.test(text));
  const medium = tokensFile && custom.size ? 'app-ui' : pages.length && !components ? 'web' : 'generic';
  const notes = [];
  if (tailwind) notes.push('Tailwind found: there is no Tailwind adapter yet, so its values are checked as text and shown on the specimen board.');
  if (components) notes.push('Component sources found (JSX, Vue, Svelte or Astro): the project is checked as source text; the specimen board shows the design.');
  if (!pages.length && !components) notes.push('No page found: the specimen board is the visual review.');
  return { system: custom.size >= 3 ? 'css-vars' : 'text', medium, entry: pages.includes('index.html') ? 'index.html' : pages[0] || null, pages: pages.length,
    customProperties: custom.size, ...(tokensFile ? { tokensFile } : {}), ...(notes.length ? { notes } : {}) };
}

/** One merged page for the literal checks, which read a single page: element IDs, drawings and copy of every page count. */
export function mergedPages(files) {
  const pages = Object.entries(files).filter(([name, text]) => /\.html?$/iu.test(name) && typeof text === 'string');
  if (pages.length < 2) return files;
  const rest = Object.fromEntries(Object.entries(files).filter(([name]) => !/\.html?$/iu.test(name)));
  return { ...rest, 'index.html': pages.map(([, text]) => text).join('\n') };
}

const compactValue = value => String(value).toLowerCase().replace(/\s+/gu, '').replace(/["']/gu, '');
const varNames = value => [...String(value).matchAll(/var\(\s*--([A-Za-z0-9_-]+)/gu)].map(match => match[1].toLowerCase());

/** Custom properties with every value they are declared with, the names the styles use, and var() resolution. */
function variableModel(files) {
  const rules = cssDeclarations(files);
  const declared = new Map();
  for (const rule of rules) if (rule.property.startsWith('--')) {
    const name = rule.property.slice(2);
    if (!declared.has(name)) declared.set(name, []);
    declared.get(name).push(rule.value);
  }
  // Used: referenced by a real property, then everything those custom properties reference in turn.
  const used = new Set(rules.filter(rule => !rule.property.startsWith('--')).flatMap(rule => varNames(rule.value)));
  for (let changed = true; changed;) {
    changed = false;
    for (const name of [...used]) for (const value of declared.get(name) || []) for (const ref of varNames(value)) if (!used.has(ref)) { used.add(ref); changed = true; }
  }
  const resolve = (value, depth = 0) => depth > 4 ? value : String(value).replace(/var\(\s*--([A-Za-z0-9_-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/gu, (whole, name, fallback) => {
    const found = declared.get(name.toLowerCase());
    return found ? resolve(found[0], depth + 1) : fallback ? resolve(fallback.trim(), depth + 1) : whole;
  });
  return { rules, declared, used, resolve };
}

/**
 * The CSS variable adapter on top of a web conformance report: for palette and typography devices, each color and font
 * must be the value of a custom property that is used through var(), directly or through another custom property. A
 * CSS token the literal check missed counts when var() resolves to it. Reports which property carries each value.
 */
export function checkCssVariables(dna, files, report) {
  const model = variableModel(files);
  const holders = (value, kind) => [...model.declared.entries()].filter(([, values]) => values.some(raw => {
    const resolved = model.resolve(raw);
    return kind === 'color' ? colorsIn(resolved).includes(value.toLowerCase())
      : resolved.split(',').some(part => normalizeTasteName(part.replace(/["']/gu, '')) === normalizeTasteName(value));
  })).map(([name]) => name);
  const bindings = [];
  const devices = report.devices.map(result => {
    const device = dna.devices.find(item => item.id === result.id);
    if (!device) return result;
    let { found, tokens } = result;
    // A CSS value written through var() is the same value.
    const missing = result.missing.filter(item => {
      if (item.kind !== 'css') return true;
      const index = item.value.indexOf(':'), property = item.value.slice(0, index).trim(), wanted = compactValue(item.value.slice(index + 1));
      const resolved = model.rules.some(rule => rule.property === property && /var\(/u.test(rule.value) && compactValue(model.resolve(rule.value)).includes(wanted));
      if (resolved) found++;
      return !resolved;
    });
    const extra = [];
    if (['palette', 'typography'].includes(device.layer)) {
      for (const [kind, values] of [['color', device.tokens.colors || []], ['font', device.tokens.fonts || []]]) for (const value of values) {
        const names = holders(value, kind), live = names.find(name => model.used.has(name));
        bindings.push({ device: device.id, kind, value, ...(live ? { property: `--${live}` } : names.length ? { declaredAs: names.map(name => `--${name}`), used: false } : { property: null }) });
        extra.push({ kind: 'variable', value, present: Boolean(live),
          detail: live ? `--${live}` : names.length ? `${names.map(name => `--${name}`).join(' or ')} holds it but nothing uses it through var()` : `no custom property holds ${value}; declare it as one and use it through var()` });
      }
    }
    tokens += extra.length;
    found += extra.filter(item => item.present).length;
    const status = !tokens ? 'missing' : found === tokens ? 'present' : found ? 'partial' : 'missing';
    return { ...result, status, tokens, found, missing: [...missing, ...extra.filter(item => !item.present).map(({ kind, value, detail }) => ({ kind, value, detail }))] };
  });
  const present = devices.filter(device => device.status === 'present').length, partial = devices.filter(device => device.status === 'partial').length;
  const score = devices.length ? Number(((present + partial / 2) / devices.length).toFixed(3)) : 0;
  return { ...report, devices, present, partial, missing: devices.length - present - partial, score, meetsThreshold: score >= report.threshold,
    system: { name: 'css-vars', customProperties: model.declared.size, used: [...model.declared.keys()].filter(name => model.used.has(name)).length, bindings },
    limitation: `${report.limitation} With CSS custom properties it also checks that each palette and typography value is held by a custom property the styles use through var().` };
}
