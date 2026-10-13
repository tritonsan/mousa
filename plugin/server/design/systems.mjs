// The project's own design system. detectDesignSystem reads what kind of project it is and where its values live, and
// an adapter then checks, beyond the literal conformance check, where each palette and typography value of the Design
// DNA is bound:
// - CSS custom properties: the value of a property the styles use through var(), with var() chains resolved, so a CSS
//   token written as letter-spacing: var(--tracking) still counts.
// - Tailwind: the value of a theme entry (Tailwind 4's @theme, or Tailwind 3's config) that a class names.
// Every check accepts a colour in another notation, such as oklch() or shadcn/ui's bare HSL triplets. Other projects are
// checked as text, and the specimen board shows any design for review.

import fs from 'node:fs/promises';
import path from 'node:path';
import { cssDeclarations, normalizeTasteName, fontFileName } from '../culture/taste.mjs';
import { holdsColor } from './colors.mjs';
import { usesTailwind, tailwindBindings } from './tailwind.mjs';

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
  // A design token file: tokens.json, a *.tokens.json, or any JSON file with W3C (DTCG) $value leaves.
  const tokensFile = names.find(name => /(?:^|\/)(?:[\w-]+[.-])?tokens\.json$/iu.test(name)) || names.find(name => /\.json$/iu.test(name) && /"\$value"\s*:/u.test(files[name])) || null;
  const custom = new Set(cssDeclarations(files).filter(rule => rule.property.startsWith('--')).map(rule => rule.property));
  const tailwind = usesTailwind(files);
  const medium = components ? 'generic' : tokensFile && custom.size ? 'app-ui' : pages.length ? 'web' : 'generic';
  const notes = [];
  if (tailwind) notes.push('Tailwind found: palette and type are checked in its theme (@theme or tailwind.config) and in the classes that name them. The check reads the source; capture a built page with design_capture and root, such as dist.');
  if (components) notes.push('Component sources found (JSX, Vue, Svelte or Astro): the project is checked as source text; the specimen board shows the design.');
  if (!pages.length && !components) notes.push('No page found: the specimen board is the visual review.');
  return { system: tailwind ? 'tailwind' : custom.size >= 3 ? 'css-vars' : 'text', medium, entry: pages.includes('index.html') ? 'index.html' : pages[0] || null, pages: pages.length,
    customProperties: custom.size, ...(tokensFile ? { tokensFile } : {}), ...(notes.length ? { notes } : {}) };
}

/** The text without each block an opening pattern starts, nested braces included. */
function withoutBlocks(text, opener) {
  let out = '', last = 0;
  for (const match of text.matchAll(opener)) {
    if (match.index < last) continue;
    out += text.slice(last, match.index);
    let depth = 1, index = match.index + match[0].length;
    while (index < text.length && depth) { if (text[index] === '{') depth++; else if (text[index] === '}') depth--; index++; }
    last = index;
  }
  return out + text.slice(last);
}
// Theme entries, font faces and keyframes are CSS that no class could replace; custom properties are tokens.
const handWritten = css => [...withoutBlocks(css.replace(/\/\*[\s\S]*?\*\//gu, ' '), /@(?:theme|font-face|(?:-webkit-)?keyframes)\b[^{]*\{/giu)
  .matchAll(/(?:^|[{;])\s*[a-z][a-z-]*\s*:\s*[^;{}]+(?=[;}])/giu)].length;

/**
 * How a project styles itself: its design system, its stylesheets, how many hand-written CSS declarations it has and
 * how many class names its markup and templates use. Taken when a session starts, it shows later whether a restyle
 * stayed in the project's own way of styling.
 */
export function styleFootprint(files) {
  let declarations = 0, classes = 0;
  for (const [name, text] of Object.entries(files)) {
    if (typeof text !== 'string') continue;
    const blocks = /\.css$/iu.test(name) ? [text] : /\.(?:html?|vue|svelte|astro)$/iu.test(name) ? [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)].map(match => match[1]) : [];
    for (const block of blocks) declarations += handWritten(block);
    for (const match of text.matchAll(/\bclass(?:Name)?\s*=\s*(["'`])([^"'`]*)\1/gu)) classes += match[2].split(/\s+/u).filter(Boolean).length;
  }
  return { system: detectDesignSystem(files).system, stylesheets: Object.keys(files).filter(name => /\.css$/iu.test(name)).sort(), handWritten: declarations, classes };
}

// More hand-written declarations than this, added to a Tailwind project, move its styling out of its classes.
export const STYLE_LIMITS = Object.freeze({ handWrittenGrowth: 40 });

/** What a restyle changed in the project's way of styling, against how the session found it. */
export function styleNotes(start, now) {
  if (start?.system !== 'tailwind' || now.handWritten - start.handWritten <= STYLE_LIMITS.handWrittenGrowth) return [];
  return [`This Tailwind project had ${start.handWritten} hand-written CSS declarations when the session began and has ${now.handWritten} now, so most of the new styling bypasses its classes. Restyle through the theme and the utility classes in the markup and templates, and keep hand-written CSS for @font-face, @keyframes and what no class can say.`];
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

/** A device's result with some of its missing checks found after all and some checks added, scored again. */
function adjust(result, { recovered = () => false, extra = [] } = {}) {
  const kept = result.missing.filter(item => !recovered(item));
  const tokens = result.tokens + extra.length, found = result.found + (result.missing.length - kept.length) + extra.filter(item => item.present).length;
  const status = !tokens ? 'missing' : found === tokens ? 'present' : found ? 'partial' : 'missing';
  return { ...result, status, tokens, found, missing: [...kept, ...extra.filter(item => !item.present).map(({ kind, value, detail }) => ({ kind, value, detail }))] };
}
function rescored(report, devices, system, limitation) {
  const present = devices.filter(device => device.status === 'present').length, partial = devices.filter(device => device.status === 'partial').length;
  const score = devices.length ? Number(((present + partial / 2) / devices.length).toFixed(3)) : 0;
  return { ...report, devices, present, partial, missing: devices.length - present - partial, score, meetsThreshold: score >= report.threshold, ...(system ? { system } : {}), limitation };
}
/** A CSS value the literal check missed counts when var() resolves to it. */
function viaVariable(model, item) {
  const index = item.value.indexOf(':'), property = item.value.slice(0, index).trim(), wanted = compactValue(item.value.slice(index + 1));
  return model.rules.some(rule => rule.property === property && /var\(/u.test(rule.value) && compactValue(model.resolve(rule.value)).includes(wanted));
}
/** A colour the literal check missed counts when a stylesheet holds it in another notation, such as oklch(). */
const colorHeld = (model, value) => model.rules.some(rule => holdsColor(model.resolve(rule.value), value));
const recoveredBy = model => item => (item.kind === 'css' && viaVariable(model, item)) || (item.kind === 'color' && colorHeld(model, item.value));

/**
 * The CSS variable adapter on top of a conformance report: for palette and typography devices, each color and font
 * must be the value of a custom property that is used through var(), directly or through another custom property.
 * Reports which property carries each value.
 */
export function checkCssVariables(dna, files, report) {
  const model = variableModel(files);
  const holders = (value, kind) => [...model.declared.entries()].filter(([, values]) => values.some(raw => {
    const resolved = model.resolve(raw);
    return kind === 'color' ? holdsColor(resolved, value) : resolved.split(',').some(part => normalizeTasteName(part.replace(/["']/gu, '')) === normalizeTasteName(value));
  })).map(([name]) => name);
  const bindings = [];
  const devices = report.devices.map(result => {
    const device = dna.devices.find(item => item.id === result.id);
    if (!device) return result;
    const extra = [];
    if (['palette', 'typography'].includes(device.layer)) {
      for (const [kind, values] of [['color', device.tokens.colors || []], ['font', device.tokens.fonts || []]]) for (const value of values) {
        const names = holders(value, kind), live = names.find(name => model.used.has(name));
        bindings.push({ device: device.id, kind, value, ...(live ? { property: `--${live}` } : names.length ? { declaredAs: names.map(name => `--${name}`), used: false } : { property: null }) });
        extra.push({ kind: 'variable', value, present: Boolean(live),
          detail: live ? `--${live}` : names.length ? `${names.map(name => `--${name}`).join(' or ')} holds it but nothing uses it through var()` : `no custom property holds ${value}; declare it as one and use it through var()` });
      }
    }
    return adjust(result, { recovered: recoveredBy(model), extra });
  });
  return rescored(report, devices, { name: 'css-vars', customProperties: model.declared.size, used: [...model.declared.keys()].filter(name => model.used.has(name)).length, bindings },
    `${report.limitation} With CSS custom properties it also checks that each palette and typography value is held by a custom property the styles use through var().`);
}

/**
 * The Tailwind adapter: for palette and typography devices, each colour and family must be held by a theme entry, in
 * @theme or tailwind.config, that a class names, such as bg-mist or font-display. Reports the theme name behind each.
 */
export function checkTailwind(dna, files, report) {
  const model = variableModel(files);
  const { theme, bindings } = tailwindBindings(dna, files, { resolve: model.resolve, used: model.used });
  const devices = report.devices.map(result => {
    const own = bindings.filter(binding => binding.device === result.id);
    // A value the theme holds is in the project, wherever it is written; whether a class names it is the theme check's.
    const bound = item => own.some(binding => binding.kind === item.kind && binding.value === item.value && binding.names.length);
    const extra = own.map(binding => ({ kind: 'theme', value: binding.value, present: Boolean(binding.live),
      detail: binding.live ? `${binding.kind === 'font' ? 'font-' : ''}${binding.live}`
        : binding.names.length ? `the theme holds it as ${binding.names.join(' or ')}, but no class names it`
          : `no theme ${binding.kind} holds ${binding.value}; add it to @theme or tailwind.config and name it in a class` }));
    return adjust(result, { recovered: item => recoveredBy(model)(item) || (['color', 'font'].includes(item.kind) && bound(item)), extra });
  });
  return rescored(report, devices, { name: 'tailwind', version: theme.version, sources: theme.sources, colors: theme.colors.size, fonts: theme.fonts.size,
    bindings: bindings.map(({ device, kind, value, names, live }) => ({ device, kind, value, ...(live ? { name: live } : names.length ? { declaredAs: names, used: false } : { name: null }) })) },
    `${report.limitation} With Tailwind it also checks that each palette and typography value is held by the theme (@theme or tailwind.config) and named by a class.`);
}

// A path from the site root is served from the project folder, or from public/ or static/, where Vite, Next.js, Astro
// and SvelteKit keep the files they serve as they are.
const SERVED_ROOTS = ['', 'public/', 'static/'];

/** The project files a URL in `from` can reach: none for a remote or data URL. */
export function reachedPaths(url, from) {
  const clean = String(url).split(/[?#]/u)[0];
  if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(clean)) return [];
  const joined = clean.startsWith('/') ? SERVED_ROOTS.map(root => `${root}${clean.slice(1)}`) : [path.posix.join(path.posix.dirname(from), clean)];
  return [...new Set(joined.map(item => path.posix.normalize(item)))].filter(item => item !== '..' && !item.startsWith('../'));
}

/** Every @font-face src of the stylesheets and the pages' style elements, with the file it names and where it is written. */
export function fontFaceSources(files) {
  const faces = [];
  for (const [name, text] of Object.entries(files)) {
    if (typeof text !== 'string') continue;
    const blocks = /\.css$/iu.test(name) ? [text] : /\.html?$/iu.test(name) ? [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)].map(match => match[1]) : [];
    for (const block of blocks) for (const match of block.replace(/\/\*[\s\S]*?\*\//gu, ' ').matchAll(/@font-face\s*\{([^{}]*)\}/giu)) {
      const family = /font-family\s*:\s*([^;]+)/iu.exec(match[1])?.[1].trim().replace(/^["']|["']$/gu, '');
      if (!family) continue;
      for (const url of [...match[1].matchAll(/url\(\s*(["']?)([^"')]+?)\1\s*\)/giu)].map(item => item[2].trim())) faces.push({ family, stylesheet: name, url, file: fontFileName(url) });
    }
  }
  return faces;
}

/**
 * The library fonts whose @font-face names their file by a path that reaches no file of the project. The literal check
 * passes them, since it reads the file name, and the browser finds nothing: in a live session a stylesheet in src/
 * loaded fonts/a.woff2 while the file sat in the project's fonts/. `fonts` is the library's families with their files.
 */
export async function checkFontFiles(report, dna, files, root, fonts = []) {
  const library = new Map(fonts.map(family => [normalizeTasteName(family.family), family]));
  const faces = fontFaceSources(files);
  const exists = async relative => fs.stat(path.join(root, ...relative.split('/'))).then(item => item.isFile(), () => false);
  const broken = new Map();
  for (const device of dna.devices || []) for (const value of device.tokens?.fonts || []) {
    const family = library.get(normalizeTasteName(value));
    if (!family) continue;
    const names = new Set(family.files.map(fontFileName));
    const own = faces.filter(face => normalizeTasteName(face.family) === normalizeTasteName(family.family) && names.has(face.file));
    if (!own.length) continue;
    let reached = false;
    for (const face of own) for (const candidate of reachedPaths(face.url, face.stylesheet)) if (!reached && await exists(candidate)) reached = true;
    if (reached) continue;
    const face = own[0], tried = reachedPaths(face.url, face.stylesheet);
    const detail = `${face.stylesheet} loads ${family.family} from ${face.url}, which reaches ${tried.length ? tried.join(' or ') : 'no file of the project'}, and no font file is there. Write the path from ${face.stylesheet} to where the font was fetched; a file in public/ is served from the site root, as /fonts/….`;
    if (!broken.has(device.id)) broken.set(device.id, []);
    broken.get(device.id).push({ kind: 'font-file', value: family.family, detail });
  }
  if (!broken.size) return report;
  const devices = report.devices.map(result => {
    // Only a check the literal pass counted is taken back; a font file it already reports stays as it is.
    const fresh = (broken.get(result.id) || []).filter(item => !result.missing.some(missing => missing.kind === 'font-file' && missing.value === item.value));
    if (!fresh.length) return result;
    const found = Math.max(0, result.found - fresh.length);
    return { ...result, found, status: found === result.tokens ? 'present' : found ? 'partial' : 'missing', missing: [...result.missing, ...fresh] };
  });
  return rescored(report, devices, report.system, report.limitation);
}

/** The adapter for the project's design system, or, for any other project, the colours written in another notation. */
export function checkDesignSystem(dna, files, report, detected) {
  if (detected?.system === 'tailwind') return checkTailwind(dna, files, report);
  if (detected?.system === 'css-vars') return checkCssVariables(dna, files, report);
  const model = variableModel(files);
  return rescored(report, report.devices.map(result => adjust(result, { recovered: recoveredBy(model) })), report.system, report.limitation);
}
