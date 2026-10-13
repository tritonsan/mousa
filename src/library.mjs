import fs from 'node:fs/promises';
import path from 'node:path';
import { jpegSize } from '../plugin/server/production/image-files.mjs';

export { jpegSize };

/**
 * Host photo libraries: openly licensed product photographs under library/<templateId>/, read-only and identical
 * for both comparison arms. Tags describe what each photo shows; they are not Qloo data. A Design DNA device may use
 * a photo only when one of its tags is among the device's qualities, so in a Qloo run the returned tags choose it.
 */
export const LIBRARY_LICENSES = Object.freeze({
  'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'Public Domain Mark 1.0': 'https://creativecommons.org/publicdomain/mark/1.0/',
});
export const LIBRARY_TONES = Object.freeze(['light', 'mid', 'dark', 'vivid']);
const PHOTO_ID = /^[a-z0-9][a-z0-9-]{0,60}$/u;
const TEMPLATE_ID = /^[a-z][a-z-]{0,40}$/u;
const MAX_PHOTO_BYTES = 400 * 1024;
const cache = new Map();

function invalid(templateId, message) { throw new Error(`Photo library ${templateId}: ${message}`); }

async function readLibrary(rootDir, templateId) {
  const directory = path.join(rootDir, 'library', templateId);
  let raw;
  try { raw = await fs.readFile(path.join(directory, 'library.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const catalog = JSON.parse(raw);
  if (catalog?.schemaVersion !== '1.0' || catalog.templateId !== templateId || !Array.isArray(catalog.images) || !catalog.images.length || catalog.images.length > 60) {
    invalid(templateId, 'library.json needs schemaVersion 1.0, its own templateId and 1-60 images.');
  }
  const seen = new Set(), images = [];
  for (const image of catalog.images) {
    const id = typeof image?.id === 'string' ? image.id : '';
    if (!PHOTO_ID.test(id) || seen.has(id) || image.file !== `${id}.jpg`) invalid(templateId, `each image needs a unique lowercase id and the file <id>.jpg (${id.slice(0, 60) || 'missing id'}).`);
    seen.add(id);
    if (!Object.hasOwn(LIBRARY_LICENSES, image.license) || typeof image.sourceUrl !== 'string' || !image.sourceUrl.startsWith('https://')) invalid(templateId, `${id} needs a CC0 1.0 or Public Domain Mark 1.0 license and an https source URL.`);
    if (typeof image.subject !== 'string' || !PHOTO_ID.test(image.subject) || typeof image.alt !== 'string' || image.alt.length < 10 || image.alt.length > 200) invalid(templateId, `${id} needs a product subject and alt text of 10-200 characters.`);
    if (!LIBRARY_TONES.includes(image.tone) || !Array.isArray(image.tags) || !image.tags.length || image.tags.length > 8 || !image.tags.every(tag => typeof tag === 'string' && tag.trim() && tag.length <= 120)) invalid(templateId, `${id} needs a tone (${LIBRARY_TONES.join(', ')}) and 1-8 tags.`);
    const file = path.join(directory, image.file);
    const bytes = await fs.readFile(file).catch(() => null);
    if (!bytes || bytes.length > MAX_PHOTO_BYTES) invalid(templateId, `${image.file} is missing or larger than 400 KiB.`);
    const size = jpegSize(bytes);
    if (!size || size.width !== image.width || size.height !== image.height) invalid(templateId, `${image.file} must be a JPEG of the listed ${image.width}x${image.height} pixels.`);
    images.push(Object.freeze({ id, path: `library/${image.file}`, file, product: image.subject, alt: image.alt, width: image.width, height: image.height, tone: image.tone,
      tags: Object.freeze([...image.tags]), license: image.license, licenseUrl: LIBRARY_LICENSES[image.license], creator: typeof image.creator === 'string' ? image.creator : null,
      provider: typeof image.provider === 'string' ? image.provider : null, sourceUrl: image.sourceUrl }));
  }
  return Object.freeze({ templateId, source: typeof catalog.source === 'string' ? catalog.source : '', usage: typeof catalog.usage === 'string' ? catalog.usage : '', images: Object.freeze(images) });
}

/** The validated library for a starter, or null when it has none. Loaded once per process; a failed load is retried. */
export function loadLibrary(rootDir, templateId) {
  if (typeof templateId !== 'string' || !TEMPLATE_ID.test(templateId)) return Promise.resolve(null);
  const key = `${rootDir}\0${templateId}`;
  if (!cache.has(key)) cache.set(key, readLibrary(rootDir, templateId).catch(error => { cache.delete(key); throw error; }));
  return cache.get(key);
}

/** One listed photo by its site path or ID, for the preview and Studio routes; unlisted names are never served. */
export function libraryPhoto(library, name) {
  const id = typeof name === 'string' ? name.replace(/^library\//u, '').replace(/\.jpg$/u, '') : '';
  return library?.images.find(image => image.id === id) || null;
}

function starterProducts(html) {
  const match = /<script type="application\/json" id="site-data">([\s\S]*?)<\/script>/u.exec(typeof html === 'string' ? html : '');
  try { return new Map((JSON.parse(match?.[1] ?? '{}').items || []).map(item => [item.id, item.name])); } catch { return new Map(); }
}

/** What the agent reads as culture-library.json: paths, products, honest alt text, sizes, tones and tags. */
export function libraryArtifact(library, starterHtml) {
  const products = starterProducts(starterHtml);
  return { schemaVersion: '1.0', provenance: 'host-photo-library',
    usage: 'Openly licensed product photographs, identical in every run. They are the only photographs available. Show one by its relative path, such as an img src or a CSS url().',
    tags: 'Tags describe what each photo shows; they are not taste data. A Design DNA device may list a photo in tokens.images only when one of the photo\'s tags is among the device\'s qualities.',
    photos: library.images.map(image => ({ path: image.path, product: image.product, ...(products.has(image.product) ? { productName: products.get(image.product) } : {}),
      alt: image.alt, width: image.width, height: image.height, tone: image.tone, tags: [...image.tags], license: image.license })) };
}

/** The path and tags of each photo, as normalizeDesignDna and checkDnaConformance expect them. */
export function libraryForDna(library) {
  return library ? library.images.map(image => ({ path: image.path, tags: [...image.tags] })) : [];
}

/** Listed photos a site references, with their credits, for downloads that carry text files only. */
export function libraryPhotosUsed(library, files) {
  if (!library) return [];
  const text = Object.entries(files || {}).filter(([file, content]) => typeof content === 'string' && !/^culture-.*\.json$/u.test(file)).map(([, content]) => content).join('\n');
  return library.images.filter(image => text.includes(image.path)).map(image => ({ path: image.path, repositoryPath: `library/${library.templateId}/${path.basename(image.file)}`,
    license: image.license, licenseUrl: image.licenseUrl, creator: image.creator, provider: image.provider, sourceUrl: image.sourceUrl }));
}
