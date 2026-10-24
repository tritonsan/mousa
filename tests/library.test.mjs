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
import { createDesignTools } from '../plugin/server/design/tools.mjs';
import { FAMILIES, checkFamilies, reservedNames, mergeCatalog } from '../scripts/fetch-font-library.mjs';
import { fontWordMatch } from '../plugin/server/production/fonts.mjs';

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
  assert.equal(library.families.length, 55);
  assert.ok(library.families.every(family => family.license === 'OFL-1.1' && /^library\/fonts\/[a-z0-9-]+\.OFL\.txt$/u.test(family.licenseRepositoryPath)
    && family.faces.length && family.faces.every(face => FONT_FILE_PATH.test(face.path) && face.bytes <= 200 * 1024)));
  const bytes = library.families.flatMap(family => family.faces).reduce((sum, face) => sum + face.bytes, 0);
  assert.ok(bytes < 3 * 1024 * 1024, 'The library stays small enough to ship in the repository.');
  const artifact = fontsArtifact(library);
  assert.equal(artifact.provenance, 'host-font-library');
  // About 590 bytes a family: the 60 families the loader accepts come to some 36 KB.
  assert.ok(Buffer.byteLength(JSON.stringify(artifact, null, 2)) < 40000, 'The agent-facing catalog stays compact.');
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

test('the font catalog is the script\'s list: the same families in the same order with the same category, character words, stand-ins and overused flags', async () => {
  checkFamilies();
  const catalog = JSON.parse(await fs.readFile(path.join(rootDir, 'library', 'fonts', 'fonts.json'), 'utf8'));
  assert.deepEqual(catalog.families.map(family => family.id), FAMILIES.map(spec => spec.id), 'Run scripts/fetch-font-library.mjs --add after changing its list.');
  for (const [index, spec] of FAMILIES.entries()) {
    const family = catalog.families[index];
    assert.deepEqual([family.category, family.character, family.similarTo, family.overused], [spec.category, spec.character, spec.similarTo, spec.overused], spec.id);
    assert.ok(family.character.length >= 3 && family.character.length <= 6, `${spec.id} has 3-6 character words`);
    assert.equal([family.category, ...family.character, family.family].some(value => /editorial/iu.test(value)), false, `${spec.id} is not tagged editorial`);
  }
  assert.deepEqual(catalog.families.filter(family => family.overused).map(family => family.family).sort(),
    ['DM Mono', 'DM Serif Display', 'Fraunces', 'Instrument Serif', 'Inter', 'Libre Franklin', 'Space Grotesk'], 'The families designs reach for by default are flagged, not removed.');
});

test('no family in the font library has its own name reserved by its licence, because a Latin subset may not keep a Reserved Font Name', async () => {
  const catalog = JSON.parse(await fs.readFile(path.join(rootDir, 'library', 'fonts', 'fonts.json'), 'utf8'));
  const squash = value => value.toLowerCase().replace(/[^a-z0-9]+/gu, '');
  for (const family of catalog.families) {
    const license = await fs.readFile(path.join(rootDir, 'library', 'fonts', family.licenseFile), 'utf8');
    assert.deepEqual(reservedNames(license).filter(name => squash(family.family).includes(squash(name))), [], family.family);
  }
  const dmSerif = catalog.families.find(family => family.id === 'dm-serif-display');
  assert.deepEqual(reservedNames(await fs.readFile(path.join(rootDir, 'library', 'fonts', dmSerif.licenseFile), 'utf8')), ['Source'], 'A reserved name that is not the family\'s own is no obstacle.');
});

test('the font script reads every wording of a Reserved Font Name and refuses a list the catalog cannot hold', () => {
  const header = line => `${line}\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.`;
  assert.deepEqual(reservedNames(header('Copyright 2012 The Graduate Project Authors (https://github.com/etunni/graduate) with Reserved Font Name "Graduate"')), ['Graduate']);
  assert.deepEqual(reservedNames(header('Copyright 2018 The Orbitron Project Authors (https://github.com/theleagueof/orbitron), with Reserved Font Name: "Orbitron"')), ['Orbitron'], 'A colon after Name is still a reservation.');
  assert.deepEqual(reservedNames(header("Copyright (c) 2011 Foo, with Reserved Font Names 'Alpha' and 'Beta'")), ['Alpha', 'Beta']);
  assert.deepEqual(reservedNames(header('Copyright (c) 2011 by Sorkin Type Co, with Reserved Font Name Rye.')), ['Rye']);
  assert.deepEqual(reservedNames(header('Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git)')), []);
  assert.deepEqual(reservedNames('Copyright 2020 Foo.\n\nThis Font Software is licensed under the SIL Open Font License.\nThe Reserved Font Name "Elsewhere" is described in the licence text, not here.'), [], 'Only the copyright header reserves names.');
  const spec = { id: 'sample', category: 'sample class', character: ['one', 'two', 'three'] };
  assert.doesNotThrow(() => checkFamilies([spec]));
  for (const [bad, pattern] of [
    [[spec, spec], /own id/u],
    [[{ ...spec, id: 'Bad Id' }], /own id/u],
    [[{ ...spec, category: '' }], /category/u],
    [[{ ...spec, character: ['one', 'two'] }], /3-6 character words/u],
    [[{ ...spec, character: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }], /3-6 character words/u],
    [[{ ...spec, character: ['one', 'two', 'x'.repeat(41)] }], /3-6 character words/u],
    [[{ ...spec, overused: 'yes' }], /overused/u],
    [Array.from({ length: 61 }, (_, index) => ({ ...spec, id: `sample-${index}` })), /more than the 60/u],
  ]) assert.throws(() => checkFamilies(bad), pattern);
});

test('an incremental font run keeps catalogued files, refreshes their metadata and merges new families in list order', () => {
  const face = name => ({ style: 'normal', weight: '400', file: `${name}.woff2`, bytes: 10, sha256: 'a'.repeat(64) });
  const entry = (id, extra = {}) => ({ id, family: id.toUpperCase(), category: 'old class', character: ['old', 'words', 'here'], files: [face(id)], license: 'OFL-1.1', licenseFile: `${id}.OFL.txt`,
    copyright: 'Copyright 2020 Sample', version: 'v1', source: `https://fonts.example/${id}`, ...extra });
  const catalogued = [entry('b', { similarTo: ['Old Face'], overused: true }), entry('a'), entry('gone')];
  const specs = [
    { id: 'a', category: 'new class', character: ['one', 'two', 'three'], similarTo: ['New Face'], overused: true },
    { id: 'c', category: 'c class', character: ['x', 'y', 'z'] },
    { id: 'b', category: 'old class', character: ['old', 'words', 'here'] },
    { id: 'd', category: 'd class', character: ['x', 'y', 'z'] },
  ];
  const added = [{ ...entry('c'), category: 'c class', character: ['x', 'y', 'z'] }];
  const merged = mergeCatalog({ catalogued, specs, added });
  assert.deepEqual(merged.map(item => item.id), ['a', 'c', 'b', 'gone'], 'Specs in order, a failed download left out, a family no spec lists kept at the end.');
  const [a, c, b, gone] = merged;
  assert.deepEqual([a.category, a.character, a.similarTo, a.overused], ['new class', ['one', 'two', 'three'], ['New Face'], true], 'A catalogued family takes its metadata from its spec.');
  assert.deepEqual([b.similarTo, b.overused], [undefined, undefined], 'A stand-in or flag the spec no longer has is dropped.');
  for (const family of [a, b]) {
    const old = catalogued.find(item => item.id === family.id);
    assert.deepEqual([family.files, family.license, family.licenseFile, family.copyright, family.version, family.source], [old.files, old.license, old.licenseFile, old.copyright, old.version, old.source], `${family.id} keeps its files`);
  }
  assert.deepEqual(Object.keys(a), ['id', 'family', 'category', 'character', 'similarTo', 'overused', 'files', 'license', 'licenseFile', 'copyright', 'version', 'source'], 'Fields keep the order fonts.json lists them in.');
  assert.equal(c, added[0], 'A downloaded family is taken as fetched.');
  assert.equal(gone, catalogued[2]);
  assert.deepEqual(mergeCatalog({ catalogued: [], specs, added: [] }), [], 'With nothing catalogued and nothing downloaded there is nothing to list.');
  assert.deepEqual(mergeCatalog({ catalogued: merged, specs: specs.slice(0, 3), added: [] }).map(item => item.id), ['a', 'c', 'b', 'gone'], 'A second run changes nothing.');
});

test('the genre words designs search for reach the families made for them, and editorial reaches none', async () => {
  const library = await loadFontLibrary(rootDir);
  const tools = createDesignTools({ fonts: async () => library });
  const find = words => tools.handle('materials', { action: 'find', words }, {});
  const REACHES = {
    sports: ['Anton', 'Barlow Condensed', 'Bebas Neue', 'Chakra Petch', 'Oswald'],
    broadcast: ['Anton', 'Barlow Condensed', 'Bebas Neue'],
    varsity: ['Bevan', 'Holtwood One SC'],
    mixtape: ['Anton', 'Caveat', 'Sedgwick Ave Display'],
    arcade: ['Pixelify Sans', 'Silkscreen'],
    western: ['Holtwood One SC', 'Sancreek'],
    blackletter: ['Fruktur', 'Grenze Gotisch'],
    stencil: ['Big Shoulders Stencil Display', 'Black Ops One'],
    techno: ['Chakra Petch', 'Oxanium', 'Zen Dots'],
    zine: ['Caveat', 'Courier Prime', 'Cutive Mono', 'Sedgwick Ave Display'],
    civic: ['Barlow Condensed', 'Big Shoulders Display', 'Big Shoulders Stencil Display'],
    signage: ['Barlow Condensed', 'Big Shoulders Display', 'Big Shoulders Stencil Display', 'Bungee'],
    screenplay: ['Courier Prime', 'Cutive Mono'],
    newspaper: ['Gelasio', 'Grenze Gotisch', 'Libre Franklin'],
    fashion: ['Bodoni Moda', 'Cormorant Garamond', 'Poiret One', 'Prata'],
    '70s': ['Fraunces', 'Shrikhand'],
    y2k: ['Fredoka', 'Unbounded', 'Zen Dots'],
    luxury: ['Bodoni Moda', 'Cormorant Garamond', 'Prata'],
    literary: ['Alegreya Sans', 'EB Garamond', 'Literata'],
    children: ['Fredoka', 'Nunito'],
  };
  for (const [word, expected] of Object.entries(REACHES)) {
    const found = await find([word]);
    const reached = found.families.filter(family => family.matches?.length).map(family => family.family);
    for (const name of expected) assert.ok(reached.includes(name), `${word} reaches ${name}`);
    assert.ok(expected.includes(found.families[0].family), `${word} is led by ${found.families[0].family}`);
  }
  assert.equal((await find(['editorial'])).families.some(family => family.matches?.length), false, 'No family carries the word designs use for taste in general.');
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

test('a font search word matches a whole word, a phrase or a variant of its stem, never five shared letters alone', () => {
  for (const [word, value] of [['luxury', 'luxurious'], ['minimal', 'minimalist'], ['condense', 'condensed'], ['sport', 'sports'], ['high-contrast', 'high-contrast'], ['art deco', 'art deco'], ['retro', 'retro-futurist'], ['Black', 'Archivo Black']]) {
    assert.equal(fontWordMatch(word, value), true, `${word} names ${value}`);
  }
  for (const [word, value] of [['blackletter', 'Archivo Black'], ['basketball', 'Baskervville'], ['deco', 'decorative'], ['wedding', 'wedge'], ['art deco', 'art'], ['', 'serif']]) {
    assert.equal(fontWordMatch(word, value), false, `${word} does not name ${value}`);
  }
});
