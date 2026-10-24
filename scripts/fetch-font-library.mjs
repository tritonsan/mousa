import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Builds library/fonts: open-licence (SIL OFL 1.1) Google Fonts families as Latin-subset WOFF2 files from Fontsource,
 * each with its upstream OFL.txt from the google/fonts repository. Variable families keep only their weight axis.
 * Without a flag it prints what it would do. The result is committed so Studio runs never fetch fonts.
 *   --run  rebuilds the whole library from scratch.
 *   --add  downloads only the families of FAMILIES that fonts.json does not list yet. Existing font and licence files are
 *          left as they are, and fonts.json is rewritten in FAMILIES order with each existing family's metadata (category,
 *          character, similarTo, overused) refreshed from FAMILIES, so a retag needs no download. To change a family's
 *          weights, remove it from fonts.json first or rebuild with --run.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'library', 'fonts');

// category describes the design class; character words describe its feel, genre, era and use (3-6 words, the most telling
// first); similarTo names the system faces it stands in for; overused marks the families that designing agents reach for
// by default, which tools may rank after equal matches.
// A search word matches a whole word of the category, the character words or the family name, or any word that shares its
// first five letters (techno also reaches technical), so character words stay short and avoid words that collide with
// the genres below (black, broad, screen and signature belong to blackletter, broadcast, screenplay and signage).
// Left out because their licence reserves the family's own name, which a subset may not keep: Graduate, Alfa Slab One,
// UnifrakturMaguntia, Pirata One, Stardos Stencil, Rye, Press Start 2P, Monoton, Righteous and Orbitron.
export const FAMILIES = [
  // Serifs, from book faces to display faces, slabs and blackletter
  { id: 'literata', category: 'book serif', character: ['literary', 'bookish', 'novel', 'ebook', 'warm'], similarTo: ['Iowan Old Style', 'Charter'] },
  { id: 'eb-garamond', category: 'old-style serif', character: ['classical', 'literary', 'renaissance', 'scholarly', 'poetry'], similarTo: ['Garamond'] },
  { id: 'baskervville', category: 'transitional serif', character: ['refined', 'traditional', 'crisp', 'academic', 'heritage'], similarTo: ['Baskerville'] },
  { id: 'gelasio', category: 'transitional serif', character: ['sturdy', 'familiar', 'newspaper', 'news', 'plain'], similarTo: ['Georgia'] },
  { id: 'cormorant-garamond', category: 'display old-style serif', character: ['luxurious', 'delicate', 'fashion', 'wedding', 'romantic', 'high-contrast'], similarTo: ['Garamond Display'] },
  { id: 'prata', category: 'didone display serif', character: ['dramatic', 'fashion', 'glamour', 'high-contrast', 'luxurious'], similarTo: ['Didot'], weights: [400] },
  { id: 'bodoni-moda', category: 'didone serif', character: ['luxurious', 'fashion', 'formal', 'sharp', 'couture'], similarTo: ['Bodoni'] },
  { id: 'dm-serif-display', category: 'display serif', character: ['bold', 'warm', 'headline'], weights: [400], italic: [400], overused: true },
  { id: 'fraunces', category: 'soft display serif', character: ['soft', 'retro', '70s', 'quirky'], similarTo: ['Cooper Black', 'Windsor'], overused: true },
  { id: 'rozha-one', category: 'fat face display serif', character: ['heavy', 'poster', 'theatrical', 'cinema'], weights: [400] },
  { id: 'instrument-serif', category: 'condensed display serif', character: ['condensed', 'high-contrast', 'tall'], weights: [400], italic: [400], overused: true },
  { id: 'zilla-slab', category: 'slab serif', character: ['solid', 'friendly', 'mechanical', 'Americana'], similarTo: ['Rockwell'], weights: [400, 700], italic: [400] },
  { id: 'bevan', category: 'heavy slab serif', character: ['varsity', 'collegiate', 'Americana', 'poster', 'bold', 'vintage'], similarTo: ['Rockwell Extra Bold', 'Clarendon'], weights: [400] },
  { id: 'holtwood-one-sc', category: 'wood type slab serif', character: ['western', 'varsity', 'poster', 'rodeo', 'heavy'], weights: [400] },
  { id: 'sancreek', category: 'tuscan display serif', character: ['western', 'saloon', 'ornate', 'vintage', 'wood type', 'rodeo'], similarTo: ['Playbill'], weights: [400] },
  { id: 'grenze-gotisch', category: 'blackletter serif', character: ['blackletter', 'gothic', 'medieval', 'fantasy', 'newspaper', 'streetwear'], similarTo: ['Old English Text MT'], weights: [400, 700] },
  { id: 'fruktur', category: 'blackletter display', character: ['blackletter', 'fraktur', 'medieval', 'masthead', 'gothic', 'fantasy'], weights: [400] },
  // Sans serifs: geometric, humanist and grotesque, then condensed, stencil, wide and techno display faces
  { id: 'jost', category: 'geometric sans', character: ['geometric', 'modernist', 'clean', 'Bauhaus', 'minimal'], similarTo: ['Futura', 'Century Gothic'] },
  { id: 'league-spartan', category: 'geometric sans', character: ['bold', 'constructivist', 'poster', 'manifesto'], similarTo: ['Futura Bold'] },
  { id: 'cabin', category: 'humanist sans', character: ['humanist', 'warm', 'British', 'wayfinding'], similarTo: ['Gill Sans', 'Johnston'] },
  { id: 'alegreya-sans', category: 'humanist sans', character: ['calligraphic', 'literary', 'friendly', 'craft'], similarTo: ['Optima', 'Myriad'], weights: [400, 700], italic: [400] },
  { id: 'inter', category: 'neo-grotesque sans', character: ['neutral', 'interface', 'dashboard', 'software'], similarTo: ['Helvetica', 'Arial'], overused: true },
  { id: 'libre-franklin', category: 'grotesque sans', character: ['sturdy', 'American', 'newspaper'], similarTo: ['Franklin Gothic'], overused: true },
  { id: 'space-grotesk', category: 'grotesque sans', character: ['quirky', 'wonky', 'proportional'], overused: true },
  { id: 'bricolage-grotesque', category: 'expressive grotesque sans', character: ['expressive', 'playful', 'contemporary', 'indie'] },
  { id: 'familjen-grotesk', category: 'grotesque sans', character: ['Scandinavian', 'quirky', 'indie', 'contemporary'], weights: [400, 700] },
  { id: 'archivo-black', category: 'heavy grotesque sans', character: ['poster', 'streetwear', 'brutalist', 'loud'], similarTo: ['Arial Black'], weights: [400] },
  { id: 'anton', category: 'heavy condensed sans', character: ['broadcast', 'sports', 'headline', 'loud', 'mixtape', 'tabloid'], similarTo: ['Impact'], weights: [400] },
  { id: 'barlow-condensed', category: 'condensed grotesque sans', character: ['sports', 'broadcast', 'stats', 'signage', 'civic', 'dashboard'], similarTo: ['Arial Narrow'], weights: [400, 700] },
  { id: 'oswald', category: 'condensed gothic sans', character: ['condensed', 'bold', 'poster', 'sports'], similarTo: ['Alternate Gothic', 'Impact'] },
  { id: 'bebas-neue', category: 'condensed capitals', character: ['condensed', 'headline', 'loud', 'broadcast', 'sports'], weights: [400] },
  { id: 'big-shoulders-display', category: 'condensed display sans', character: ['industrial', 'civic', 'signage', 'tall'] },
  { id: 'big-shoulders-stencil-display', category: 'condensed stencil display sans', character: ['stencil', 'industrial', 'civic', 'signage', 'tall'], weights: [400, 700] },
  { id: 'black-ops-one', category: 'heavy stencil display', character: ['stencil', 'military', 'tactical', 'gaming', 'streetwear', 'loud'], similarTo: ['Stencil'], weights: [400] },
  { id: 'syne', category: 'wide display sans', character: ['artistic', 'wide', 'avant-garde', 'gallery', 'experimental'] },
  { id: 'unbounded', category: 'wide geometric display sans', character: ['wide', 'rounded', 'futurist', 'Y2K'] },
  { id: 'zen-dots', category: 'wide techno display sans', character: ['Y2K', 'futuristic', 'synthwave', 'neon', 'techno', 'bold'], weights: [400] },
  { id: 'oxanium', category: 'squared techno sans', character: ['techno', 'futuristic', 'gaming', 'scifi', 'cyber'] },
  { id: 'chakra-petch', category: 'angular techno sans', character: ['techno', 'esports', 'gaming', 'futuristic', 'sports', 'cyber'], weights: [400, 700] },
  { id: 'poiret-one', category: 'art deco display sans', character: ['art deco', 'elegant', 'light', 'twenties', 'fashion'], weights: [400] },
  { id: 'bungee', category: 'urban signage display sans', character: ['signage', 'urban', 'neon', 'loud', 'streetwear'], weights: [400] },
  // Monospace: typewriter, coding and pixel faces
  { id: 'courier-prime', category: 'typewriter monospace', character: ['typewriter', 'screenplay', 'classic', 'zine', 'manuscript'], similarTo: ['Courier New', 'Courier'], weights: [400, 700], italic: [400] },
  { id: 'cutive-mono', category: 'typewriter monospace', character: ['typewriter', 'vintage', 'light', 'archive', 'screenplay', 'zine'], similarTo: ['American Typewriter'], weights: [400] },
  { id: 'dm-mono', category: 'monospace', character: ['engineered', 'calm', 'tabular'], weights: [400, 500], italic: [400], overused: true },
  { id: 'space-mono', category: 'geometric monospace', character: ['retro-futurist', 'geometric', 'quirky', 'scifi'], weights: [400, 700], italic: [400] },
  { id: 'jetbrains-mono', category: 'coding monospace', character: ['code', 'developer', 'brutalist', 'terminal', 'technical', 'precise'], similarTo: ['Consolas', 'Menlo', 'SF Mono'], weights: [400, 700] },
  { id: 'vt323', category: 'pixel monospace', character: ['terminal', 'CRT', 'hacker', 'retro', '80s', 'code'], weights: [400] },
  { id: 'silkscreen', category: 'pixel capitals', character: ['arcade', 'pixel', 'bitmap', 'retro', 'game'], weights: [400, 700] },
  { id: 'pixelify-sans', category: 'pixel sans', character: ['arcade', 'pixel', 'gaming', 'retro', 'blocky', 'playful'] },
  // Handwriting, script, italic display and rounded faces
  { id: 'caveat', category: 'handwriting', character: ['handwritten', 'casual', 'notebook', 'diary', 'mixtape', 'zine'] },
  { id: 'sedgwick-ave-display', category: 'graffiti handwriting', character: ['graffiti', 'mixtape', 'street', 'zine', 'urban', 'rap'], weights: [400] },
  { id: 'pinyon-script', category: 'formal script', character: ['formal', 'calligraphic', 'wedding', 'invitation', 'elegant'], weights: [400] },
  { id: 'shrikhand', category: 'heavy italic display', character: ['70s', '80s', 'retro', 'disco', 'groovy', 'bold'], weights: [400] },
  { id: 'nunito', category: 'rounded sans', character: ['rounded', 'soft', 'friendly', 'children'], similarTo: ['VAG Rounded'] },
  { id: 'fredoka', category: 'rounded display sans', character: ['children', 'playful', 'bubbly', 'Y2K', 'toy', 'friendly'], similarTo: ['Arial Rounded MT Bold'] },
];

// What the loader (plugin/server/production/fonts.mjs) accepts. A catalog it refuses stops every run before any model call,
// so the limits are checked here, before anything is written.
const LIMITS = { families: 60, filesPerFamily: 4, fileBytes: 200 * 1024, name: /^[A-Za-z0-9][A-Za-z0-9 ]{0,58}$/u };
const SOURCE = 'Google Fonts families as Latin-subset WOFF2 files from Fontsource (https://fontsource.org); licence files from https://github.com/google/fonts.';

/** The list itself must be one the catalog can hold: unique ids, a category, 3-6 character words. */
export function checkFamilies(specs = FAMILIES) {
  const seen = new Set();
  for (const spec of specs) {
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/u.test(spec.id || '') || seen.has(spec.id)) throw new Error(`${spec.id}: each family needs its own id of lower-case letters, digits and hyphens.`);
    seen.add(spec.id);
    if (typeof spec.category !== 'string' || !spec.category.trim() || spec.category.length > 60) throw new Error(`${spec.id}: needs a category of at most 60 characters.`);
    if (!Array.isArray(spec.character) || spec.character.length < 3 || spec.character.length > 6 || !spec.character.every(word => typeof word === 'string' && word.trim() && word.length <= 40)) throw new Error(`${spec.id}: needs 3-6 character words of at most 40 characters.`);
    if (spec.overused !== undefined && spec.overused !== true) throw new Error(`${spec.id}: overused is true or absent.`);
  }
  if (specs.length > LIMITS.families) throw new Error(`${specs.length} families are more than the ${LIMITS.families} the loader accepts.`);
}

/**
 * Names the licence reserves. A Latin subset is a Modified Version under the OFL, which may not carry a Reserved Font
 * Name, so families whose own name contains one are left out rather than renamed. Licences word it as Reserved Font
 * Name "X", Reserved Font Names 'X' and 'Y', or Reserved Font Name: "X".
 */
export function reservedNames(license) {
  const header = license.split(/This Font Software is licensed/iu)[0];
  return [...header.matchAll(/Reserved\s+Font\s+Names?[:\s]+([^\n]+)/giu)].flatMap(match => {
    const quoted = [...match[1].matchAll(/["'“‘]([^"'”’]+)["'”’]/gu)].map(item => item[1]);
    return quoted.length ? quoted : [match[1].replace(/[.,;].*$/u, '')];
  }).map(name => name.trim()).filter(Boolean);
}
const squash = value => value.toLowerCase().replace(/[^a-z0-9]+/gu, '');

async function get(url, kind = 'json') {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
    if (response.ok) return kind === 'json' ? response.json() : kind === 'text' ? response.text() : Buffer.from(await response.arrayBuffer());
    if (attempt >= 2 || response.status < 500) throw new Error(`${url} returned ${response.status}.`);
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
}

// The fields a spec decides, in the order fonts.json lists them; everything else in an entry comes from the download.
const metadata = spec => ({ category: spec.category, character: spec.character, ...(spec.similarTo ? { similarTo: spec.similarTo } : {}), ...(spec.overused ? { overused: true } : {}) });

/** A catalogued family with its metadata taken from its spec again; its files, licence, copyright, version and source stay. */
function refresh(entry, spec) {
  const { id, family, category, character, similarTo, overused, ...rest } = entry;
  return { id, family, ...metadata(spec), ...rest };
}

/**
 * The families a catalog lists after an incremental run: every spec in order, a catalogued family as it was with its
 * metadata refreshed, a family just downloaded as fetched, and a spec that was neither (its download failed) left out.
 * Catalogued families that no spec lists any more follow, unchanged, since adding never removes.
 */
export function mergeCatalog({ catalogued = [], specs, added = [] }) {
  const have = new Map(catalogued.map(entry => [entry.id, entry])), fetched = new Map(added.map(entry => [entry.id, entry]));
  const listed = new Set(specs.map(spec => spec.id));
  return [...specs.flatMap(spec => have.has(spec.id) ? [refresh(have.get(spec.id), spec)] : fetched.has(spec.id) ? [fetched.get(spec.id)] : []),
    ...catalogued.filter(entry => !listed.has(entry.id))];
}

async function fetchFamily(spec) {
  const meta = await get(`https://api.fontsource.org/v1/fonts/${spec.id}`);
  if (meta.license !== 'OFL-1.1') throw new Error(`${spec.id} is licensed ${meta.license}, not OFL-1.1.`);
  if (!meta.subsets?.includes('latin')) throw new Error(`${spec.id} has no Latin subset.`);
  if (!LIMITS.name.test(meta.family)) throw new Error(`${spec.id}: the family name ${meta.family} is not a plain name the loader accepts.`);
  // The upstream licence file carries the family's own copyright line, as the OFL requires for redistribution.
  const license = (await get(`https://raw.githubusercontent.com/google/fonts/main/ofl/${squash(meta.family)}/OFL.txt`, 'text')).replace(/\r\n/gu, '\n');
  if (!/SIL OPEN FONT LICENSE/iu.test(license)) throw new Error(`${spec.id}: the upstream licence file is not the OFL.`);
  const reserved = reservedNames(license).filter(name => squash(meta.family).includes(squash(name)));
  if (reserved.length) throw new Error(`${spec.id}: the licence reserves the name ${reserved.join(', ')}, which a subset may not keep.`);
  const wanted = [];
  if (!spec.weights && meta.variable) {
    const axes = (await get(`https://api.fontsource.org/v1/variable/${spec.id}`)).axes || {};
    if (!axes.wght) throw new Error(`${spec.id} has no weight axis.`);
    const weight = `${Number(axes.wght.min)} ${Number(axes.wght.max)}`;
    for (const style of ['normal', 'italic'].filter(value => meta.styles.includes(value))) {
      wanted.push({ url: `https://cdn.jsdelivr.net/fontsource/fonts/${spec.id}:vf@latest/latin-wght-${style}.woff2`, file: `${spec.id}-latin-wght-${style}.woff2`, style, weight });
    }
  } else {
    for (const weight of spec.weights || [400]) wanted.push({ url: `https://cdn.jsdelivr.net/fontsource/fonts/${spec.id}@latest/latin-${weight}-normal.woff2`, file: `${spec.id}-latin-${weight}-normal.woff2`, style: 'normal', weight: String(weight) });
    for (const weight of spec.italic || []) wanted.push({ url: `https://cdn.jsdelivr.net/fontsource/fonts/${spec.id}@latest/latin-${weight}-italic.woff2`, file: `${spec.id}-latin-${weight}-italic.woff2`, style: 'italic', weight: String(weight) });
  }
  if (wanted.length > LIMITS.filesPerFamily) throw new Error(`${spec.id}: ${wanted.length} files are more than the ${LIMITS.filesPerFamily} the loader accepts for one family.`);
  // Everything is downloaded and checked before anything is written, so a failed family leaves no files behind.
  const downloads = [];
  for (const item of wanted) {
    const bytes = await get(item.url, 'binary');
    if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`${item.url} is not a WOFF2 file.`);
    if (bytes.length > LIMITS.fileBytes) throw new Error(`${item.url} is ${Math.round(bytes.length / 1024)} KB, more than the ${LIMITS.fileBytes / 1024} KB the loader accepts.`);
    downloads.push({ ...item, bytes });
  }
  for (const item of downloads) await fs.writeFile(path.join(target, item.file), item.bytes);
  await fs.writeFile(path.join(target, `${spec.id}.OFL.txt`), license);
  const files = downloads.map(({ style, weight, file, bytes }) => ({ style, weight, file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }));
  const copyright = license.split('\n').map(line => line.trim()).find(line => /^Copyright/iu.test(line)) || null;
  return { id: spec.id, family: meta.family, ...metadata(spec), files, license: 'OFL-1.1', licenseFile: `${spec.id}.OFL.txt`, copyright, version: meta.version, source: `https://fonts.google.com/specimen/${meta.family.replace(/ /gu, '+')}` };
}

const describe = family => `${family.family}: ${family.files.map(file => `${file.file} ${Math.round(file.bytes / 1024)} KB`).join(', ')}`;
const totals = families => { const files = families.flatMap(family => family.files); return `${families.length} families, ${files.length} files, ${Math.round(files.reduce((sum, file) => sum + file.bytes, 0) / 1024)} KB`; };

async function readCatalog() {
  let raw;
  try { raw = await fs.readFile(path.join(target, 'fonts.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const catalog = JSON.parse(raw);
  if (!Array.isArray(catalog?.families)) throw new Error('fonts.json has no list of families.');
  return catalog;
}

async function writeCatalog(families, retrievedAt) {
  const catalog = { schemaVersion: '1.0', source: SOURCE, license: 'SIL Open Font License 1.1', retrievedAt, families };
  await fs.writeFile(path.join(target, 'fonts.json'), `${JSON.stringify(catalog, null, 2)}\n`);
}

/** Reads, never writes: an incremental run builds on files that are still what fonts.json recorded. */
async function verifyCatalogued(entry) {
  const license = await fs.readFile(path.join(target, entry.licenseFile), 'utf8').catch(() => '');
  if (!/SIL OPEN FONT LICENSE/iu.test(license)) throw new Error(`${entry.id}: ${entry.licenseFile} is missing or is not the OFL; rebuild with --run.`);
  for (const face of entry.files) {
    const bytes = await fs.readFile(path.join(target, face.file)).catch(() => null);
    if (!bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== face.sha256) throw new Error(`${entry.id}: ${face.file} is missing or does not match its recorded checksum; rebuild with --run.`);
  }
}

async function rebuild() {
  await fs.mkdir(target, { recursive: true });
  // A rebuild starts clean; only the files this script writes are removed.
  for (const name of await fs.readdir(target)) if (/\.(?:woff2|OFL\.txt)$/u.test(name) || name === 'fonts.json') await fs.rm(path.join(target, name));
  const families = [], failures = [];
  for (const spec of FAMILIES) {
    try { const family = await fetchFamily(spec); families.push(family); console.log(describe(family)); }
    catch (error) { failures.push({ id: spec.id, error: error.message }); console.log(`FAILED ${spec.id}: ${error.message}`); }
  }
  await writeCatalog(families, new Date().toISOString());
  console.log(`${totals(families)}${failures.length ? `; ${failures.length} failed` : ''}.`);
  if (failures.length) process.exitCode = 1;
}

async function addMissing() {
  await fs.mkdir(target, { recursive: true });
  const catalog = await readCatalog() || { families: [], retrievedAt: new Date().toISOString() };
  for (const entry of catalog.families) await verifyCatalogued(entry);
  const have = new Set(catalog.families.map(entry => entry.id));
  const added = [], failures = [];
  for (const spec of FAMILIES.filter(item => !have.has(item.id))) {
    try { const family = await fetchFamily(spec); added.push(family); console.log(describe(family)); }
    catch (error) { failures.push({ id: spec.id, error: error.message }); console.log(`FAILED ${spec.id}: ${error.message}`); }
  }
  const families = mergeCatalog({ catalogued: catalog.families, specs: FAMILIES, added });
  if (families.length > LIMITS.families) throw new Error(`The catalog would hold ${families.length} families, more than the ${LIMITS.families} the loader accepts.`);
  const specs = new Map(FAMILIES.map(spec => [spec.id, spec]));
  const refreshed = catalog.families.filter(entry => specs.has(entry.id) && JSON.stringify(refresh(entry, specs.get(entry.id))) !== JSON.stringify(entry));
  const dropped = catalog.families.filter(entry => !specs.has(entry.id));
  // retrievedAt says when files were last downloaded, so a run that downloads nothing leaves it as it was.
  await writeCatalog(families, added.length ? new Date().toISOString() : catalog.retrievedAt);
  console.log(`${added.length ? `Added ${totals(added)}` : 'Added nothing'}${failures.length ? `; ${failures.length} failed` : ''}; ${catalog.families.length} families kept as they were, ${refreshed.length} of them with metadata refreshed from FAMILIES.`);
  if (dropped.length) console.log(`Kept ${dropped.length} catalogued families FAMILIES no longer lists (${dropped.map(entry => entry.id).join(', ')}); rebuild with --run to drop them.`);
  console.log(`The catalog now holds ${totals(families)}.`);
  if (failures.length) process.exitCode = 1;
}

async function main(args) {
  checkFamilies();
  const run = args.includes('--run'), add = args.includes('--add');
  if (run && add) { console.error('Pass --run or --add, not both.'); process.exitCode = 1; return; }
  if (run) return rebuild();
  if (add) return addMissing();
  const catalogued = new Set(((await readCatalog())?.families || []).map(entry => entry.id));
  console.log(JSON.stringify({ families: FAMILIES.length, target: path.relative(root, target), catalogued: catalogued.size, missing: FAMILIES.filter(spec => !catalogued.has(spec.id)).map(spec => spec.id),
    instruction: 'Pass --add to download only the missing families and refresh the metadata of the catalogued ones, or --run to rebuild every family from Fontsource and google/fonts.' }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
