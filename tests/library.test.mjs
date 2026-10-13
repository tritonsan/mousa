import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { LIBRARY_LICENSES, loadLibrary, libraryArtifact, libraryForDna, libraryPhoto, libraryPhotosUsed, jpegSize } from '../src/library.mjs';
import { FONT_FILE_PATH, loadFontLibrary, clearFontLibraryCache, fontsArtifact, fontsForDna, fontLibraryFile, fontFilesUsed } from '../src/fonts.mjs';
import { getTemplate } from '../src/templates.mjs';
import { rootDir } from '../src/config.mjs';

test('the local food photo library is complete, openly licensed and matches the starter catalogue', async () => {
  const library = await loadLibrary(rootDir, 'local-food');
  assert.equal(library.images.length, 21);
  const artifact = libraryArtifact(library, getTemplate('local-food').files['index.html']);
  const products = [...new Set(artifact.photos.map(photo => photo.product))].sort();
  assert.deepEqual(products, ['jam', 'lentil', 'olive-oil', 'pasta', 'tahini', 'tomato'], 'Every catalogue product has photos, and every photo shows a catalogue product.');
  for (const product of products) assert.ok(artifact.photos.filter(photo => photo.product === product).length >= 3, `${product} offers a choice of looks`);
  assert.ok(artifact.photos.every(photo => photo.productName && /^library\/[a-z0-9-]+\.jpg$/u.test(photo.path) && photo.alt.length >= 10 && photo.tags.length));
  assert.equal(artifact.photos.find(photo => photo.product === 'olive-oil').productName, 'Virgin olive oil');
  assert.ok(library.images.every(image => Object.hasOwn(LIBRARY_LICENSES, image.license) && image.licenseUrl === LIBRARY_LICENSES[image.license] && image.sourceUrl.startsWith('https://')));
  const bytes = (await Promise.all(library.images.map(image => fs.stat(image.file)))).reduce((sum, stat) => sum + stat.size, 0);
  assert.ok(bytes < 3 * 1024 * 1024, 'The library stays small enough to ship in the repository.');
  assert.ok(Buffer.byteLength(JSON.stringify(artifact, null, 2)) < 16000, 'The agent-facing catalog stays compact.');
  // Tags span light, dark and vivid looks, so different taste inputs can choose different photos of the same product.
  assert.deepEqual([...new Set(library.images.map(image => image.tone))].sort(), ['dark', 'light', 'mid', 'vivid']);
  assert.deepEqual(libraryForDna(library)[0], { path: 'library/olive-oil-1.jpg', tags: [...library.images[0].tags] });
  assert.deepEqual(libraryForDna(null), []);
});

test('only listed photos resolve, and starters without a library have none', async () => {
  const library = await loadLibrary(rootDir, 'local-food');
  assert.equal(libraryPhoto(library, 'library/jam-2.jpg').id, 'jam-2'); assert.equal(libraryPhoto(library, 'jam-2').id, 'jam-2');
  for (const name of ['library/jam-9.jpg', '../library.json', 'library/../jam-2.jpg', '']) assert.equal(libraryPhoto(library, name), null, name);
  assert.equal(await loadLibrary(rootDir, 'indie-game'), null);
  for (const id of ['../local-food', 'Local-Food', '']) assert.equal(await loadLibrary(rootDir, id), null, id);
  const used = libraryPhotosUsed(library, { 'index.html': '<img src="library/jam-2.jpg" alt="Fresh figs">', 'culture-dna.json': '{"images":["library/jam-1.jpg"]}' });
  assert.deepEqual(used, [{ path: 'library/jam-2.jpg', repositoryPath: 'library/local-food/jam-2.jpg', license: 'CC0 1.0', licenseUrl: LIBRARY_LICENSES['CC0 1.0'],
    creator: null, provider: 'rawpixel', sourceUrl: 'https://www.rawpixel.com/image/5918550/image-public-domain-fruit-food' }], 'Culture records do not count as showing a photo.');
});

test('a library loads only JPEGs whose name, size, license and tags match its catalog', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'library', 'fixture-shop');
  await fs.mkdir(directory, { recursive: true });
  const original = await fs.readFile(path.join(rootDir, 'library', 'local-food', 'jam-2.jpg'));
  assert.deepEqual(jpegSize(original), { width: 1024, height: 768 });
  assert.equal(jpegSize(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), null, 'A WebP file with a .jpg name is not a JPEG.');
  await fs.writeFile(path.join(directory, 'fig-1.jpg'), original);
  const image = { id: 'fig-1', file: 'fig-1.jpg', subject: 'jam', alt: 'Whole and halved fresh figs on white', width: 1024, height: 768, tone: 'light', tags: ['Bright'], license: 'CC0 1.0', sourceUrl: 'https://example.org/fig' };
  const save = catalog => fs.writeFile(path.join(directory, 'library.json'), JSON.stringify({ schemaVersion: '1.0', templateId: 'fixture-shop', images: [image], ...catalog }));
  for (const [catalog, pattern] of [
    [{ templateId: 'other-shop' }, /its own templateId/],
    [{ images: [image, image] }, /unique lowercase id/],
    [{ images: [{ ...image, file: 'fig-2.jpg' }] }, /the file <id>\.jpg/],
    [{ images: [{ ...image, license: 'CC BY 4.0' }] }, /CC0 1\.0 or Public Domain Mark 1\.0/],
    [{ images: [{ ...image, alt: 'Figs' }] }, /alt text of 10-200 characters/],
    [{ images: [{ ...image, tags: [] }] }, /1-8 tags/],
    [{ images: [{ ...image, width: 1000 }] }, /JPEG of the listed 1000x768 pixels/],
  ]) {
    await save(catalog);
    await assert.rejects(loadLibrary(root, 'fixture-shop'), pattern);
  }
  await save({});
  await fs.writeFile(path.join(directory, 'fig-1.jpg'), Buffer.from('RIFF\0\0\0\0WEBPVP8 '));
  await assert.rejects(loadLibrary(root, 'fixture-shop'), /must be a JPEG/);
  await fs.writeFile(path.join(directory, 'fig-1.jpg'), original);
  const library = await loadLibrary(root, 'fixture-shop');
  assert.deepEqual(library.images.map(item => [item.path, item.width, item.height, item.licenseUrl]), [['library/fig-1.jpg', 1024, 768, LIBRARY_LICENSES['CC0 1.0']]]);
  assert.equal(await loadLibrary(root, 'fixture-shop'), library, 'A valid library is loaded once per process.');
});

test('the font library ships open-licence WOFF2 families, and culture-fonts.json gives each its @font-face rules', async () => {
  const library = await loadFontLibrary(rootDir);
  assert.equal(library.families.length, 33);
  assert.ok(library.families.every(family => family.license === 'OFL-1.1' && /^library\/fonts\/[a-z0-9-]+\.OFL\.txt$/u.test(family.licenseRepositoryPath)
    && family.faces.length && family.faces.every(face => FONT_FILE_PATH.test(face.path) && face.bytes <= 200 * 1024)));
  const bytes = library.families.flatMap(family => family.faces).reduce((sum, face) => sum + face.bytes, 0);
  assert.ok(bytes < 3 * 1024 * 1024, 'The library stays small enough to ship in the repository.');
  const artifact = fontsArtifact(library);
  assert.equal(artifact.provenance, 'host-font-library');
  assert.ok(Buffer.byteLength(JSON.stringify(artifact, null, 2)) < 32000, 'The agent-facing catalog stays compact.');
  const jost = artifact.families.find(family => family.family === 'Jost');
  assert.deepEqual([jost.category, jost.similarTo, jost.weights, jost.italic], ['geometric sans', ['Futura', 'Century Gothic'], '100-900', true]);
  assert.deepEqual(jost.fontFace, ["@font-face{font-family:'Jost';src:url('fonts/jost-latin-wght-normal.woff2') format('woff2');font-weight:100 900;font-style:normal;font-display:swap}",
    "@font-face{font-family:'Jost';src:url('fonts/jost-latin-wght-italic.woff2') format('woff2');font-weight:100 900;font-style:italic;font-display:swap}"]);
  assert.equal(Object.hasOwn(artifact.families.find(family => family.family === 'Bebas Neue'), 'similarTo'), false, 'A family that stands in for no system font lists none.');
  assert.deepEqual(fontsForDna(library).find(family => family.family === 'Gelasio'), { family: 'Gelasio', files: ['fonts/gelasio-latin-wght-normal.woff2', 'fonts/gelasio-latin-wght-italic.woff2'], similarTo: ['Georgia'] });
  assert.deepEqual(fontsForDna(null), []);
  assert.equal(fontLibraryFile(library, 'fonts/jost-latin-wght-italic.woff2').style, 'italic');
  for (const name of ['fonts/jost-latin-wght-bold.woff2', 'fonts/../fonts.json', 'jost-latin-wght-normal.woff2', 'fonts/fonts.json', '']) assert.equal(fontLibraryFile(library, name), null, name);
  const used = fontFilesUsed(library, { 'styles.css': "@font-face{font-family:'Jost';src:url('fonts/jost-latin-wght-normal.woff2') format('woff2')}", 'culture-fonts.json': 'fonts/gelasio-latin-wght-normal.woff2' });
  assert.deepEqual(used.map(item => [item.path, item.family, item.repositoryPath, item.license, item.licenseRepositoryPath]),
    [['fonts/jost-latin-wght-normal.woff2', 'Jost', 'library/fonts/jost-latin-wght-normal.woff2', 'OFL-1.1', 'library/fonts/jost.OFL.txt']], 'Culture records do not count as loading a font.');
  assert.deepEqual(fontFilesUsed(null, {}), []);
});

test('a font library loads only OFL families whose WOFF2 files match their checksums', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-fonts-'));
  t.after(() => { clearFontLibraryCache(); return fs.rm(root, { recursive: true, force: true }); });
  assert.equal(await loadFontLibrary(root), null, 'A repository without a font library has none.');
  const directory = path.join(root, 'library', 'fonts');
  await fs.mkdir(directory, { recursive: true });
  const source = path.join(rootDir, 'library', 'fonts');
  const woff2 = await fs.readFile(path.join(source, 'jost-latin-wght-normal.woff2')), license = await fs.readFile(path.join(source, 'jost.OFL.txt'));
  await fs.writeFile(path.join(directory, 'jost-latin-wght-normal.woff2'), woff2); await fs.writeFile(path.join(directory, 'jost.OFL.txt'), license);
  const face = { style: 'normal', weight: '100 900', file: 'jost-latin-wght-normal.woff2', sha256: crypto.createHash('sha256').update(woff2).digest('hex') };
  const family = { family: 'Jost', category: 'geometric sans', character: ['clean'], license: 'OFL-1.1', licenseFile: 'jost.OFL.txt', files: [face] };
  const save = catalog => fs.writeFile(path.join(directory, 'fonts.json'), JSON.stringify({ schemaVersion: '1.0', families: [family], ...catalog }));
  for (const [catalog, pattern] of [
    [{ schemaVersion: '2.0' }, /schemaVersion 1\.0/],
    [{ families: [family, { ...family, family: 'jost' }] }, /unique plain name/],
    [{ families: [{ ...family, family: 'Jost<script>' }] }, /unique plain name/],
    [{ families: [{ ...family, license: 'Apache-2.0' }] }, /OFL-1\.1 licence/],
    [{ families: [{ ...family, character: [] }] }, /a category and 1-6 character words/],
    [{ families: [{ ...family, files: [{ ...face, file: 'jost.ttf' }] }] }, /invalid or repeated file/],
    [{ families: [{ ...family, files: [{ ...face, style: 'oblique' }] }] }, /normal or italic style/],
    [{ families: [{ ...family, files: [{ ...face, sha256: '0'.repeat(64) }] }] }, /does not match its recorded checksum/],
  ]) {
    clearFontLibraryCache(); await save(catalog);
    await assert.rejects(loadFontLibrary(root), pattern);
  }
  await save({});
  await fs.writeFile(path.join(directory, 'jost.OFL.txt'), 'All rights reserved.');
  await assert.rejects(loadFontLibrary(root), /is missing or is not the OFL/);
  await fs.writeFile(path.join(directory, 'jost.OFL.txt'), license);
  await fs.writeFile(path.join(directory, 'jost-latin-wght-normal.woff2'), Buffer.concat([Buffer.from('wOFF'), woff2.subarray(4)]));
  await assert.rejects(loadFontLibrary(root), /is not WOFF2/);
  await fs.writeFile(path.join(directory, 'jost-latin-wght-normal.woff2'), woff2);
  const loaded = await loadFontLibrary(root);
  assert.deepEqual(loaded.families.map(item => [item.family, item.faces.map(file => file.path), item.licenseRepositoryPath]), [['Jost', ['fonts/jost-latin-wght-normal.woff2'], 'library/fonts/jost.OFL.txt']]);
  assert.equal(await loadFontLibrary(root), loaded, 'A valid library is loaded once per process.');
});
