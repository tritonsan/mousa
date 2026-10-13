// The capability list a host gives the agent: the library materials, generators and review it offers for one medium,
// and from them which production methods are available, each unavailable one with its reason. Both arms of a
// comparison receive the same list. A hosted server without an image generator says so here, and plans fall back to
// methods that need none.

import { mediumProfile } from './media.mjs';
import { fail, plain, parsed, object, text, list, choice, ident, integer } from './fields.mjs';

export const PRODUCTION_SCHEMA_VERSION = '1.0';
export const ENVIRONMENTS = Object.freeze(['local', 'hosted']);
/** Why a hosted server lists every generator as unavailable, whatever is installed on it. */
export const HOSTED_IMAGE_REASON = 'A hosted server has no image generator: Codex runs only on a machine where it is installed and signed in.';
export const CAPTURE_LIMITS = Object.freeze({ rounds: 2, maxRounds: 3, perRound: 6, maxPerRound: 8, maxViews: 4, minSide: 240, maxSide: 2400 });
const KEY = /^[a-z][a-z0-9-]{0,30}$/u;

function availability(value, path, extra) {
  object(value, path, ['available', 'reason', ...extra]);
  if (typeof value.available !== 'boolean') fail(`${path}.available`, 'Use true or false.');
  const result = { available: value.available };
  if (value.reason !== undefined || !value.available) result.reason = text(value.reason, `${path}.reason`, { min: 10, max: 300 });
  return result;
}

function materials(value, path) {
  if (value === undefined) return {};
  if (!plain(value)) fail(path, 'An object keyed by material, such as fonts or photos, is required.');
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (!KEY.test(key)) fail(`${path}.${key.slice(0, 30)}`, 'Use a lowercase material name such as fonts.');
    const at = `${path}.${key}`, result = availability(item, at, ['count', 'catalog', 'license']);
    if (item.count !== undefined) result.count = integer(item.count, `${at}.count`, [0, 10000]);
    if (item.catalog !== undefined) result.catalog = text(item.catalog, `${at}.catalog`, { max: 160 });
    if (item.license !== undefined) result.license = text(item.license, `${at}.license`, { max: 160 });
    return [key, result];
  }));
}

function generators(value, path) {
  if (value === undefined) return {};
  if (!plain(value)) fail(path, 'An object keyed by generator, such as image, is required.');
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (!KEY.test(key)) fail(`${path}.${key.slice(0, 30)}`, 'Use a lowercase generator name such as image.');
    const at = `${path}.${key}`, result = availability(item, at, ['perRun', 'provider']);
    if (result.available) result.perRun = integer(item.perRun, `${at}.perRun`, [1, 20]);
    if (item.provider !== undefined) result.provider = text(item.provider, `${at}.provider`, { max: 60 });
    return [key, result];
  }));
}

function review(value, path, profile) {
  if (value === undefined) return { capture: { available: false, reason: 'This host does not capture the result for review.' } };
  object(value, path, ['capture']);
  const at = `${path}.capture`, result = availability(value.capture ?? { available: false, reason: 'This host does not capture the result for review.' }, at, ['views', 'rounds', 'perRound']);
  if (!result.available) return { capture: result };
  const ids = new Set();
  const views = value.capture.views === undefined ? profile.views.map(view => ({ ...view })) : list(value.capture.views, `${at}.views`, { min: 1, max: CAPTURE_LIMITS.maxViews }).map((view, index) => {
    object(view, `${at}.views[${index}]`, ['id', 'width', 'height']);
    const id = ident(view.id, `${at}.views[${index}].id`, { max: 30 });
    if (ids.has(id)) fail(`${at}.views[${index}].id`, 'Use each view ID once.');
    ids.add(id);
    return { id, width: integer(view.width, `${at}.views[${index}].width`, [CAPTURE_LIMITS.minSide, CAPTURE_LIMITS.maxSide]), height: integer(view.height, `${at}.views[${index}].height`, [CAPTURE_LIMITS.minSide, CAPTURE_LIMITS.maxSide]) };
  });
  if (!views.length) fail(`${at}.views`, 'A capture needs at least one view.');
  return { capture: { ...result, views, rounds: value.capture.rounds === undefined ? CAPTURE_LIMITS.rounds : integer(value.capture.rounds, `${at}.rounds`, [1, CAPTURE_LIMITS.maxRounds]),
    perRound: value.capture.perRound === undefined ? CAPTURE_LIMITS.perRound : integer(value.capture.perRound, `${at}.perRound`, [1, CAPTURE_LIMITS.maxPerRound]) } };
}

/** Whether one method can run here: code always can; a material or generator method only when the host offers it. */
function methodStatus(item, { materials: offered, generators: makers }) {
  if (item.kind === 'material') {
    const material = offered[item.material];
    return material?.available ? { available: true } : { available: false, reason: material?.reason || `This host offers no ${item.material} library.` };
  }
  if (item.kind === 'generator') {
    const generator = makers[item.generator];
    return generator?.available ? { available: true, perRun: generator.perRun } : { available: false, reason: generator?.reason || `This host has no ${item.generator} generator.` };
  }
  return { available: true };
}

/**
 * Validate a host's capability list and derive its methods. `required` names methods a study requires of both arms;
 * a required method must be available. `methods` in the input is ignored and recomputed, so the list the agent reads
 * always agrees with the materials and generators it describes.
 */
export function normalizeCapabilities(raw, { medium } = {}) {
  const source = parsed(raw, 'capabilities');
  object(source, 'capabilities', ['schemaVersion', 'medium', 'environment', 'materials', 'generators', 'review', 'required', 'methods', 'notes']);
  if (source.schemaVersion !== PRODUCTION_SCHEMA_VERSION) fail('capabilities.schemaVersion', "Use schemaVersion '1.0'.");
  const profile = mediumProfile(source.medium ?? medium ?? 'web');
  if (medium !== undefined && source.medium !== undefined && mediumProfile(medium).id !== profile.id) fail('capabilities.medium', `This run's medium is ${mediumProfile(medium).id}.`);
  const environment = source.environment === undefined ? 'local' : choice(source.environment, ENVIRONMENTS, 'capabilities.environment');
  const offered = materials(source.materials, 'capabilities.materials'), makers = generators(source.generators, 'capabilities.generators');
  const capture = review(source.review, 'capabilities.review', profile);
  const methods = profile.methods.map(item => ({ id: item.id, kind: item.kind, layers: [...item.layers], description: item.description,
    ...(item.material ? { material: item.material } : {}), ...(item.generator ? { generator: item.generator } : {}), ...methodStatus(item, { materials: offered, generators: makers }) }));
  const required = [...new Set(list(source.required, 'capabilities.required', { max: 4 }).map((id, index) => {
    const found = methods.find(item => item.id === id);
    if (!found) fail(`capabilities.required[${index}]`, `Use a method of the ${profile.label} medium: ${methods.map(item => item.id).join(', ')}.`);
    if (!found.available) fail(`capabilities.required[${index}]`, `A study cannot require ${id} here: ${found.reason}`);
    return id;
  }))];
  const notes = list(source.notes, 'capabilities.notes', { max: 6 }).map((note, index) => text(note, `capabilities.notes[${index}]`, { min: 3, max: 300 }));
  return { schemaVersion: PRODUCTION_SCHEMA_VERSION, medium: profile.id, environment, materials: offered, generators: makers, review: capture, required, methods, ...(notes.length ? { notes } : {}) };
}

/** Methods that can make a layer here, as a plan's error messages and the agent's reading list them. */
export function methodsFor(capabilities, layer, { generators = true } = {}) {
  return capabilities.methods.filter(item => item.available && item.layers.includes(layer) && (generators || item.kind !== 'generator')).map(item => item.id);
}

/** The methods of a capability list, for a host's prompt: those available for each layer, and those that are not, with their reasons. */
export function methodSummary(capabilities, layers) {
  const available = layers.map(layer => `${layer}: ${capabilities.methods.filter(item => item.available && item.layers.includes(layer)).map(item => item.id).join(', ') || 'none'}`);
  const unavailable = capabilities.methods.filter(item => !item.available).map(item => `${item.id} (${item.reason.replace(/[.\s]+$/u, '')})`);
  return { available, unavailable };
}

/**
 * The list for a standalone plugin session: the plugin's own font library, no photo or music library, Codex images
 * when it is installed and signed in on this machine (never on a hosted server), and capture when a Chromium-based
 * browser is installed.
 */
export function standaloneCapabilities({ medium = 'web', environment = 'local', fonts = null, image = null, browser = null, imagesPerRun = 4 } = {}) {
  const profile = mediumProfile(medium);
  const hosted = environment === 'hosted';
  return normalizeCapabilities({ schemaVersion: PRODUCTION_SCHEMA_VERSION, medium: profile.id, environment,
    materials: { fonts: fonts?.families?.length ? { available: true, count: fonts.families.length, catalog: 'culture_find_materials', license: 'OFL-1.1' }
      : { available: false, reason: 'The plugin font library was not found. Set MOUSA_LIBRARY_ROOT to the folder that holds library/fonts.' },
    photos: { available: false, reason: 'The portable plugin carries no photo library; draw imagery or generate it instead.' } },
    generators: { image: hosted ? { available: false, reason: HOSTED_IMAGE_REASON }
      : image?.available ? { available: true, perRun: imagesPerRun, provider: image.provider || 'codex' } : { available: false, reason: image?.reason || 'No image generator was found on this machine.' } },
    review: { capture: browser?.available ? { available: true } : { available: false, reason: browser?.reason || 'No Chromium-based browser was found to capture the result.' } } });
}
