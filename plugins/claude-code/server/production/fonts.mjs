import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Host font library: open-licence (SIL OFL 1.1) families as Latin-subset WOFF2 files under library/fonts/, read-only
 * and identical for every run and both comparison arms. Sites load them with @font-face from the local fonts/ path,
 * so the type a Design DNA names is the type every visitor sees, whatever fonts their system has.
 * scripts/fetch-font-library.mjs built the catalog; families whose licence reserves their name are not included.
 * The Studio reads it from the repository; the portable plugin carries a copy in its own library/ folder.
 */
export const FONT_FILE_PATH = /^fonts\/[a-z0-9][a-z0-9-]{0,80}\.woff2$/u;
const FAMILY_NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,58}$/u;
const FILE_NAME = /^[a-z0-9][a-z0-9-]{0,80}\.woff2$/u;
const MAX_FONT_BYTES = 200 * 1024;
let cache = new Map();

function invalid(message) { throw new Error(`Font library: ${message}`); }

async function readFonts(rootDir) {
  const directory = path.join(rootDir, 'library', 'fonts');
  let raw;
  try { raw = await fs.readFile(path.join(directory, 'fonts.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const catalog = JSON.parse(raw);
  if (catalog?.schemaVersion !== '1.0' || !Array.isArray(catalog.families) || !catalog.families.length || catalog.families.length > 60) invalid('fonts.json needs schemaVersion 1.0 and 1-60 families.');
  const names = new Set(), files = new Set(), families = [];
  for (const entry of catalog.families) {
    const family = typeof entry?.family === 'string' ? entry.family : '';
    if (!FAMILY_NAME.test(family) || names.has(family.toLowerCase())) invalid(`each family needs a unique plain name (${family.slice(0, 60) || 'missing name'}).`);
    names.add(family.toLowerCase());
    if (entry.license !== 'OFL-1.1' || typeof entry.licenseFile !== 'string' || !/^[a-z0-9][a-z0-9-]{0,60}\.OFL\.txt$/u.test(entry.licenseFile)) invalid(`${family} needs the OFL-1.1 licence and its licence file.`);
    const license = await fs.readFile(path.join(directory, entry.licenseFile), 'utf8').catch(() => '');
    if (!/SIL OPEN FONT LICENSE/iu.test(license)) invalid(`${family}: ${entry.licenseFile} is missing or is not the OFL.`);
    if (typeof entry.category !== 'string' || !entry.category.trim() || entry.category.length > 60
      || !Array.isArray(entry.character) || !entry.character.length || entry.character.length > 6 || !entry.character.every(word => typeof word === 'string' && word.trim() && word.length <= 40)) {
      invalid(`${family} needs a category and 1-6 character words.`);
    }
    if (!Array.isArray(entry.files) || !entry.files.length || entry.files.length > 4) invalid(`${family} needs 1-4 font files.`);
    const faces = [];
    for (const face of entry.files) {
      if (!FILE_NAME.test(face?.file || '') || files.has(face.file)) invalid(`${family} lists an invalid or repeated file.`);
      files.add(face.file);
      if (!['normal', 'italic'].includes(face.style) || !/^\d{3,4}(?: \d{3,4})?$/u.test(face.weight || '')) invalid(`${face.file} needs a normal or italic style and a weight or weight range.`);
      const bytes = await fs.readFile(path.join(directory, face.file)).catch(() => null);
      if (!bytes || bytes.length > MAX_FONT_BYTES || bytes.subarray(0, 4).toString('latin1') !== 'wOF2') invalid(`${face.file} is missing, is not WOFF2 or is larger than 200 KiB.`);
      if (typeof face.sha256 === 'string' && crypto.createHash('sha256').update(bytes).digest('hex') !== face.sha256) invalid(`${face.file} does not match its recorded checksum.`);
      faces.push(Object.freeze({ path: `fonts/${face.file}`, file: path.join(directory, face.file), style: face.style, weight: face.weight, bytes: bytes.length }));
    }
    families.push(Object.freeze({ family, category: entry.category, character: Object.freeze([...entry.character]),
      similarTo: Object.freeze((Array.isArray(entry.similarTo) ? entry.similarTo : []).filter(name => typeof name === 'string' && name.trim()).slice(0, 6)),
      faces: Object.freeze(faces), license: entry.license, licenseRepositoryPath: `library/fonts/${entry.licenseFile}`,
      copyright: typeof entry.copyright === 'string' ? entry.copyright : null, source: typeof entry.source === 'string' ? entry.source : null }));
  }
  return Object.freeze({ source: typeof catalog.source === 'string' ? catalog.source : '', families: Object.freeze(families) });
}

/** The validated font library, or null when the repository has none. Loaded once per process; a failed load is retried. */
export function loadFontLibrary(rootDir) {
  if (!cache.has(rootDir)) cache.set(rootDir, readFonts(rootDir).catch(error => { cache.delete(rootDir); throw error; }));
  return cache.get(rootDir);
}
/** Tests that edit a library on disk start from a fresh read. */
export function clearFontLibraryCache() { cache = new Map(); }

/**
 * The folder holding library/fonts for the portable plugin: MOUSA_LIBRARY_ROOT when set, else the packaged plugin's own
 * folder, else the repository the plugin sits in. Null when none of them has a font catalog.
 */
export async function fontLibraryRoot({ env = process.env } = {}) {
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (const candidate of [env.MOUSA_LIBRARY_ROOT, pluginRoot, path.dirname(pluginRoot)]) {
    if (typeof candidate === 'string' && candidate && await fs.access(path.join(candidate, 'library', 'fonts', 'fonts.json')).then(() => true, () => false)) return candidate;
  }
  return null;
}

/** The rule a site copies to load one file of a family; the path is relative to the site root. */
export function fontFaceRule(family, face) {
  return `@font-face{font-family:'${family.family}';src:url('${face.path}') format('woff2');font-weight:${face.weight};font-style:${face.style};font-display:swap}`;
}

/** One listed font file by its site path, for the preview route; unlisted names are never served. */
export function fontLibraryFile(library, name) {
  if (typeof name !== 'string' || !FONT_FILE_PATH.test(name)) return null;
  for (const family of library?.families || []) for (const face of family.faces) if (face.path === name) return face;
  return null;
}

/** What the agent reads as culture-fonts.json: each family's design class, character, weights and @font-face rules. */
export function fontsArtifact(library) {
  return { schemaVersion: '1.0', provenance: 'host-font-library',
    usage: 'Open-licence fonts served with every site, identical in every run. Typography uses only these families, with a generic fallback such as serif or sans-serif. Copy the fontFace rules of each family you use into your CSS; the files are local, so the type you choose is the type every visitor sees.',
    character: 'category and character describe each typeface; they are not taste data. similarTo names system fonts the family can stand in for.',
    families: library.families.map(family => ({ family: family.family, category: family.category, character: [...family.character],
      ...(family.similarTo.length ? { similarTo: [...family.similarTo] } : {}),
      weights: [...new Set(family.faces.map(face => face.weight.replace(' ', '-')))].join(', '), italic: family.faces.some(face => face.style === 'italic'),
      fontFace: family.faces.map(face => fontFaceRule(family, face)) })) };
}

/** Each family with its file paths and stand-ins, as normalizeDesignDna and checkDnaConformance expect them. */
export function fontsForDna(library) {
  return library ? library.families.map(family => ({ family: family.family, files: family.faces.map(face => face.path), similarTo: [...family.similarTo] })) : [];
}

/** Font files a site references, with their licences, for downloads that carry text files only. */
export function fontFilesUsed(library, files) {
  if (!library) return [];
  const text = Object.entries(files || {}).filter(([file, content]) => typeof content === 'string' && !/^culture-.*\.json$/u.test(file)).map(([, content]) => content).join('\n');
  return library.families.flatMap(family => family.faces.filter(face => text.includes(face.path)).map(face => ({ path: face.path, family: family.family,
    repositoryPath: `library/fonts/${path.basename(face.file)}`, license: family.license, licenseRepositoryPath: family.licenseRepositoryPath, copyright: family.copyright })));
}
