import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Builds library/fonts: open-licence (SIL OFL 1.1) Google Fonts families as Latin-subset WOFF2 files from Fontsource,
 * each with its upstream OFL.txt from the google/fonts repository. Variable families keep only their weight axis.
 * Run once with --run; the result is committed so Studio runs never fetch fonts.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'library', 'fonts');

// category describes the design class; character words describe its feel; similarTo names the system faces it stands in for.
const FAMILIES = [
  { id: 'literata', category: 'book serif', character: ['literary', 'warm', 'bookish'], similarTo: ['Iowan Old Style', 'Charter'] },
  { id: 'eb-garamond', category: 'old-style serif', character: ['classical', 'elegant', 'literary'], similarTo: ['Garamond'] },
  { id: 'baskervville', category: 'transitional serif', character: ['refined', 'traditional', 'crisp'], similarTo: ['Baskerville'] },
  { id: 'gelasio', category: 'transitional serif', character: ['sturdy', 'familiar', 'plain'], similarTo: ['Georgia'] },
  { id: 'cormorant-garamond', category: 'display old-style serif', character: ['delicate', 'luxurious', 'high-contrast'], similarTo: ['Garamond Display'] },
  { id: 'prata', category: 'didone display serif', character: ['dramatic', 'fashion', 'high-contrast'], similarTo: ['Didot'], weights: [400] },
  { id: 'bodoni-moda', category: 'didone serif', character: ['luxurious', 'sharp', 'formal'], similarTo: ['Bodoni'] },
  { id: 'dm-serif-display', category: 'display serif', character: ['bold', 'warm', 'editorial'], weights: [400], italic: [400] },
  { id: 'fraunces', category: 'soft display serif', character: ['soft', 'retro', 'quirky'], similarTo: ['Cooper Black', 'Windsor'] },
  { id: 'rozha-one', category: 'fat face display serif', character: ['heavy', 'poster', 'theatrical'], weights: [400] },
  { id: 'instrument-serif', category: 'condensed display serif', character: ['editorial', 'condensed', 'contemporary'], weights: [400], italic: [400] },
  { id: 'zilla-slab', category: 'slab serif', character: ['solid', 'mechanical', 'friendly'], similarTo: ['Rockwell'], weights: [400, 700], italic: [400] },
  { id: 'jost', category: 'geometric sans', character: ['geometric', 'modernist', 'clean'], similarTo: ['Futura', 'Century Gothic'] },
  { id: 'league-spartan', category: 'geometric sans', character: ['bold', 'constructivist', 'poster'], similarTo: ['Futura Bold'] },
  { id: 'cabin', category: 'humanist sans', character: ['humanist', 'warm', 'British'], similarTo: ['Gill Sans', 'Johnston'] },
  { id: 'alegreya-sans', category: 'humanist sans', character: ['calligraphic', 'literary', 'friendly'], similarTo: ['Optima', 'Myriad'], weights: [400, 700], italic: [400] },
  { id: 'inter', category: 'neo-grotesque sans', character: ['neutral', 'technical', 'contemporary'], similarTo: ['Helvetica', 'Arial'] },
  { id: 'libre-franklin', category: 'grotesque sans', character: ['sturdy', 'editorial', 'American'], similarTo: ['Franklin Gothic'] },
  { id: 'space-grotesk', category: 'grotesque sans', character: ['quirky', 'technical', 'contemporary'] },
  { id: 'bricolage-grotesque', category: 'expressive grotesque sans', character: ['expressive', 'playful', 'contemporary'] },
  { id: 'oswald', category: 'condensed gothic sans', character: ['condensed', 'bold', 'poster'], similarTo: ['Alternate Gothic', 'Impact'] },
  { id: 'bebas-neue', category: 'condensed capitals', character: ['condensed', 'loud', 'headline'], weights: [400] },
  { id: 'big-shoulders-display', category: 'condensed display sans', character: ['industrial', 'tall', 'civic'] },
  { id: 'syne', category: 'wide display sans', character: ['artistic', 'wide', 'avant-garde'] },
  { id: 'unbounded', category: 'wide geometric display sans', character: ['wide', 'rounded', 'futurist'] },
  { id: 'poiret-one', category: 'art deco display sans', character: ['art deco', 'elegant', 'light'], weights: [400] },
  { id: 'courier-prime', category: 'typewriter monospace', character: ['typewriter', 'screenplay', 'classic'], similarTo: ['Courier New', 'Courier'], weights: [400, 700], italic: [400] },
  { id: 'cutive-mono', category: 'typewriter monospace', character: ['typewriter', 'vintage', 'light'], similarTo: ['American Typewriter'], weights: [400] },
  { id: 'dm-mono', category: 'monospace', character: ['engineered', 'technical', 'calm'], weights: [400, 500], italic: [400] },
  { id: 'space-mono', category: 'geometric monospace', character: ['retro-futurist', 'geometric', 'technical'], weights: [400, 700], italic: [400] },
  { id: 'caveat', category: 'handwriting', character: ['handwritten', 'casual', 'notebook'] },
  { id: 'pinyon-script', category: 'formal script', character: ['formal', 'calligraphic', 'elegant'], weights: [400] },
  { id: 'nunito', category: 'rounded sans', character: ['rounded', 'soft', 'friendly'], similarTo: ['VAG Rounded'] },
];

/**
 * Names the licence reserves. A Latin subset is a Modified Version under the OFL, which may not carry a Reserved Font
 * Name, so families whose own name contains one are left out rather than renamed.
 */
function reservedNames(license) {
  const header = license.split(/This Font Software is licensed/iu)[0];
  return [...header.matchAll(/Reserved Font Names?\s+([^\n]+)/giu)].flatMap(match => {
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

async function fetchFamily(spec) {
  const meta = await get(`https://api.fontsource.org/v1/fonts/${spec.id}`);
  if (meta.license !== 'OFL-1.1') throw new Error(`${spec.id} is licensed ${meta.license}, not OFL-1.1.`);
  if (!meta.subsets?.includes('latin')) throw new Error(`${spec.id} has no Latin subset.`);
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
  // Everything is downloaded and checked before anything is written, so a failed family leaves no files behind.
  const downloads = [];
  for (const item of wanted) {
    const bytes = await get(item.url, 'binary');
    if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`${item.url} is not a WOFF2 file.`);
    downloads.push({ ...item, bytes });
  }
  for (const item of downloads) await fs.writeFile(path.join(target, item.file), item.bytes);
  await fs.writeFile(path.join(target, `${spec.id}.OFL.txt`), license);
  const files = downloads.map(({ style, weight, file, bytes }) => ({ style, weight, file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }));
  const copyright = license.split('\n').map(line => line.trim()).find(line => /^Copyright/iu.test(line)) || null;
  return { id: spec.id, family: meta.family, category: spec.category, character: spec.character, ...(spec.similarTo ? { similarTo: spec.similarTo } : {}),
    files, license: 'OFL-1.1', licenseFile: `${spec.id}.OFL.txt`, copyright, version: meta.version, source: `https://fonts.google.com/specimen/${meta.family.replace(/ /gu, '+')}` };
}

if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ families: FAMILIES.length, target: path.relative(root, target), instruction: 'Pass --run to download the families from Fontsource and google/fonts.' }, null, 2));
} else {
  await fs.mkdir(target, { recursive: true });
  // A rebuild starts clean; only the files this script writes are removed.
  for (const name of await fs.readdir(target)) if (/\.(?:woff2|OFL\.txt)$/u.test(name) || name === 'fonts.json') await fs.rm(path.join(target, name));
  const families = [], failures = [];
  for (const spec of FAMILIES) {
    try { const family = await fetchFamily(spec); families.push(family); console.log(`${family.family}: ${family.files.map(file => `${file.file} ${Math.round(file.bytes / 1024)} KB`).join(', ')}`); }
    catch (error) { failures.push({ id: spec.id, error: error.message }); console.log(`FAILED ${spec.id}: ${error.message}`); }
  }
  const catalog = { schemaVersion: '1.0', source: 'Google Fonts families as Latin-subset WOFF2 files from Fontsource (https://fontsource.org); licence files from https://github.com/google/fonts.',
    license: 'SIL Open Font License 1.1', retrievedAt: new Date().toISOString(), families };
  await fs.writeFile(path.join(target, 'fonts.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  const total = families.flatMap(family => family.files).reduce((sum, file) => sum + file.bytes, 0);
  console.log(`${families.length} families, ${families.flatMap(family => family.files).length} files, ${Math.round(total / 1024)} KB${failures.length ? `; ${failures.length} failed` : ''}.`);
  if (failures.length) process.exitCode = 1;
}
