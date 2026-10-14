// Medium profiles: what a taste-led artifact is made of in one medium. A profile names the DNA layers, the layers a
// reading must carry, the production methods a plan may choose for each layer, the views a capture shows, and how a
// DNA is validated and checked against the saved files. Websites, app interfaces and plain project source ship here;
// a host registers its own medium, such as a game character, with registerMedium.

import { DNA_LAYERS, STRUCTURAL_DNA_LAYERS, TASTE_LIMITS, normalizeDesignDna, checkDnaConformance, normalizeDnaForCheck, cssDeclarations, normalizeTasteName } from '../culture/taste.mjs';
import { fail, plain } from './fields.mjs';

export const METHOD_KINDS = Object.freeze(['code', 'material', 'generator']);
const MEDIUM_ID = /^[a-z][a-z0-9-]{1,39}$/u;
const METHOD_ID = /^[a-z][a-z0-9-]{1,39}$/u;

const moves = tokens => (tokens.keyframes || []).length > 0 || (tokens.css || []).some(rule => /^(?:animation|transition)/u.test(rule.property));
/** What a method needs among the device's own tokens, so the build can be checked; null when the device has it. */
const NEEDS = {
  colors: tokens => (tokens.colors || []).length ? null : 'its colors in tokens.colors',
  fonts: tokens => (tokens.fonts || []).length ? null : 'the family it loads in tokens.fonts',
  photos: tokens => (tokens.images || []).length ? null : 'the library photos it shows in tokens.images',
  svg: tokens => (tokens.svg || []).length ? null : 'the id of each <svg> it draws in tokens.svg',
  motion: tokens => moves(tokens) ? null : 'its keyframes in tokens.keyframes, or an animation or transition value in tokens.css',
  copy: tokens => (tokens.copy || []).length ? null : 'lines you wrote in tokens.copy',
  values: tokens => (tokens.colors || []).length || (tokens.fonts || []).length || (tokens.css || []).length ? null : 'the colors, fonts or CSS values it defines in tokens',
};

const method = (id, layers, kind, description, extra = {}) => Object.freeze({ id, layers: Object.freeze([...layers]), kind, description, ...extra });
const FONT = method('library-font', ['typography'], 'material', 'Load a family from the font library with its @font-face rules and set it in the CSS; the device names the family in tokens.fonts.', { material: 'fonts', needs: NEEDS.fonts });
const IMAGE = method('generated-image', ['imagery'], 'generator', 'Request original pictures from the host image generator. You describe what each shows; the host writes the prompt from the device\'s name, colors and qualities.', { generator: 'image' });
const SVG = layers => method('inline-svg', layers, 'code', 'Draw an original illustration, ornament or diagram as inline SVG with real detail; the device lists the id of each <svg> in tokens.svg.', { needs: NEEDS.svg });
const ART = layers => method('css-art', layers, 'code', 'Draw with CSS alone: gradients, masks, clip paths, borders and blend modes in the device\'s colors, without image files.');
const MOTION = method('css-motion', ['motion', 'interaction'], 'code', 'Animate with CSS keyframes or transitions, with a prefers-reduced-motion fallback and a pause control for endless loops.', { needs: NEEDS.motion });
const COPY = description => method('copy', ['voice'], 'code', description, { needs: NEEDS.copy });

export const WEB_METHODS = Object.freeze([
  method('css-palette', ['palette'], 'code', 'Declare the colors as CSS custom properties and use them across the page.', { needs: NEEDS.colors }),
  FONT,
  method('css-type', ['typography'], 'code', 'Set the type with CSS alone: the families visitors have, scale, weight, case and spacing.'),
  method('css-layout', ['layout', 'structure', 'interaction'], 'code', 'Build the layout, section or component in HTML and CSS: grid, flow, proportions and order.'),
  method('interaction-script', ['interaction', 'structure'], 'code', 'Make the behavior with a small script and CSS states, such as a filter, a toggle or a reveal, keeping the content readable without it.'),
  method('library-photo', ['imagery', 'layout', 'structure'], 'material', 'Show photographs from the photo library, chosen by the device\'s qualities and treated with its palette.', { material: 'photos', needs: NEEDS.photos }),
  IMAGE,
  SVG(['imagery', 'layout', 'structure', 'interaction']),
  ART(['imagery', 'layout', 'structure']),
  MOTION,
  COPY('Write the visitor copy in the device\'s voice around the fixed facts: headline, introductions, headings, calls to action and item descriptions.'),
]);
export const APP_UI_METHODS = Object.freeze([
  method('design-tokens', ['palette', 'typography', 'layout'], 'code', 'Define the values in the design token file and consume them through CSS custom properties, so every screen shares them.', { needs: NEEDS.values }),
  FONT,
  method('screen-layout', ['layout', 'structure', 'interaction'], 'code', 'Build the screen or component in markup and CSS: navigation, lists, cards, sheets and their states.'),
  SVG(['imagery', 'layout', 'structure']),
  ART(['imagery', 'layout']),
  IMAGE,
  MOTION,
  COPY('Write the interface copy in the device\'s voice around the fixed facts: titles, onboarding, empty states, buttons and descriptions.'),
]);
export const GENERIC_METHODS = Object.freeze([
  method('source', DNA_LAYERS, 'code', 'Make the device directly in the project\'s own source, styles, assets or text, writing its tokens literally.'),
  FONT,
  SVG(['imagery', 'layout', 'structure']),
  IMAGE,
  COPY('Write the copy in the device\'s voice around the fixed facts.'),
]);

const hex = value => {
  const digits = value.toLowerCase().replace(/^#|^0x/u, '');
  return `#${digits.length === 3 ? digits.split('').map(char => char + char).join('') : digits}`;
};
const compact = value => String(value).toLowerCase().replace(/\s+/gu, '');
const score = devices => {
  const present = devices.filter(device => device.status === 'present').length, partial = devices.filter(device => device.status === 'partial').length;
  return { present, partial, missing: devices.length - present - partial, total: devices.length,
    score: devices.length ? Number(((present + partial / 2) / devices.length).toFixed(3)) : 0 };
};
const statusOf = checks => { const found = checks.filter(check => check.present).length; return { status: !checks.length ? 'missing' : found === checks.length ? 'present' : found ? 'partial' : 'missing', tokens: checks.length, found }; };
const textFiles = files => Object.entries(files || {}).filter(([file, content]) => typeof content === 'string' && !/^culture-.*\.json$/u.test(file) && !file.startsWith('.mousa/'));

/**
 * Design tokens as CSS custom property names and values: {"color":{"ink":{"$value":"#1d2a33"}}} is --color-ink, and a
 * flat {"--color-ink":"#1d2a33"} is the same token. Values are strings, numbers or W3C-style {$value} leaves.
 */
export function designTokens(json) {
  const tokens = new Map();
  const visit = (value, names, depth) => {
    if (depth > 6 || tokens.size >= 400) return;
    const leaf = plain(value) && (Object.hasOwn(value, '$value') || Object.hasOwn(value, 'value')) ? value.$value ?? value.value : value;
    if (typeof leaf === 'string' || typeof leaf === 'number') { if (names.length) tokens.set(names.join('-').replace(/^--/u, '').toLowerCase(), String(leaf)); return; }
    if (plain(leaf)) for (const [key, child] of Object.entries(leaf)) if (!key.startsWith('$') && /^[A-Za-z0-9_-]{1,60}$/u.test(key)) visit(child, [...names, key], depth + 1);
  };
  visit(json, [], 0);
  return tokens;
}

/**
 * An app interface keeps its values in a design token file and its screens consume them through CSS custom
 * properties. On top of the website checks, each color and font family of a palette or typography device must be a
 * token's value, declared as that token's custom property and used through var(), so the token file is the source.
 */
export function checkAppConformance(dna, files = {}, { library, fonts, tokensFile } = {}) {
  const report = checkDnaConformance(dna, files, { library, fonts });
  const file = tokensFile || Object.keys(files).find(name => /(?:^|\/)tokens\.json$/u.test(name)) || null;
  let tokens = new Map(), problem = file ? null : 'no design token file such as tokens/tokens.json';
  if (file) {
    try { tokens = designTokens(JSON.parse(files[file])); } catch { problem = `${file} is not valid JSON`; }
  }
  const rules = cssDeclarations(files);
  const declared = new Map(rules.filter(rule => rule.property.startsWith('--')).map(rule => [rule.property.slice(2), rule.value]));
  const used = new Set(rules.flatMap(rule => [...rule.value.matchAll(/var\(\s*--([A-Za-z0-9_-]+)/gu)].map(match => match[1].toLowerCase())));
  const byValue = (wanted, kind) => [...tokens.entries()].filter(([, value]) => kind === 'color' ? /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(value.trim()) && hex(value.trim()) === wanted
    : value.split(',').map(part => normalizeTasteName(part.replace(/["']/gu, ''))).includes(normalizeTasteName(wanted))).map(([name]) => name);
  const check = (value, kind) => {
    if (problem) return { kind: 'token', value, present: false, detail: problem };
    const names = byValue(kind === 'color' ? hex(value) : value, kind);
    if (!names.length) return { kind: 'token', value, present: false, detail: `no token in ${file} has the value ${value}` };
    const live = names.find(name => declared.has(name) && compact(declared.get(name)).includes(compact(kind === 'color' ? hex(value) : value).replace(/["']/gu, '')) && used.has(name));
    return { kind: 'token', value, present: Boolean(live), detail: live ? `--${live} from ${file}` : `${names.map(name => `--${name}`).join(' or ')} must be declared with this value in the CSS and used through var()` };
  };
  const devices = report.devices.map(result => {
    const device = dna.devices.find(item => item.id === result.id);
    if (!device || !['palette', 'typography'].includes(device.layer)) return result;
    const extra = [...(device.tokens.colors || []).map(value => check(value, 'color')), ...(device.tokens.fonts || []).map(value => check(value, 'font'))];
    if (!extra.length) return result;
    const tokens = result.tokens + extra.length, found = result.found + extra.filter(item => item.present).length;
    return { ...result, status: found === tokens ? 'present' : found ? 'partial' : 'missing', tokens, found,
      missing: [...result.missing, ...extra.filter(item => !item.present).map(({ kind, value, detail }) => ({ kind, value, detail }))] };
  });
  const totals = score(devices);
  return { ...report, ...totals, meetsThreshold: totals.score >= report.threshold, devices,
    tokens: { file, count: tokens.size, used: [...tokens.keys()].filter(name => used.has(name)).length, ...(problem ? { problem } : {}) },
    limitation: `${report.limitation} For an app interface it also checks that each palette and typography value is a design token, declared as its custom property and used through var().` };
}

const SVG_SHAPE = /<(?:path|circle|ellipse|line|polyline|polygon|rect|use)\b/giu;
const literalId = (text, id) => new RegExp(`(?:^|[^A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:$|[^A-Za-z0-9_-])`, 'u').test(text);

/**
 * Literal presence for any text project, such as a native app, a document or a slide deck: each declared token must
 * occur in the files as written. Colors also count in 0xAARRGGBB or eight-digit hex form, and an SVG token is an inline
 * <svg> with that id or a file of that name, drawing at least eight shapes.
 */
export function checkLiteralConformance(dna, files = {}) {
  if (!plain(dna) || !Array.isArray(dna.devices)) fail('dna', 'A validated Design DNA is required.');
  if (!plain(files)) fail('files', 'An object of file paths and text contents is required.');
  const entries = textFiles(files), all = entries.map(([, content]) => content).join('\n'), lower = all.toLowerCase();
  const flat = lower.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' '), squeezed = compact(all);
  const colors = new Set();
  for (const match of all.matchAll(/(?:#|0x)([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z_-])/giu)) {
    const digits = match[1].toLowerCase();
    if (digits.length === 8) { colors.add(`#${digits.slice(0, 6)}`); colors.add(`#${digits.slice(2)}`); } else colors.add(hex(digits));
  }
  const drawings = new Map();
  for (const [file, content] of entries) {
    for (const match of content.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg\s*>/giu)) {
      const id = /\sid\s*=\s*(["'])([^"']+)\1/iu.exec(` ${match[1]}`)?.[2];
      if (id && !drawings.has(id)) drawings.set(id, (match[2].match(SVG_SHAPE) || []).length);
    }
    if (file.endsWith('.svg')) drawings.set(file.split('/').pop().slice(0, -4), (content.match(SVG_SHAPE) || []).length);
  }
  const devices = dna.devices.map(device => {
    const tokens = device.tokens || {};
    const checks = [
      ...(tokens.colors || []).map(value => ({ kind: 'color', value, present: colors.has(hex(value)) })),
      ...(tokens.fonts || []).map(value => ({ kind: 'font', value, present: lower.includes(value.toLowerCase()) })),
      ...(tokens.css || []).map(rule => ({ kind: 'css', value: `${rule.property}: ${rule.value}`, present: lower.includes(rule.property) && squeezed.includes(compact(rule.value)) })),
      ...(tokens.keyframes || []).map(value => ({ kind: 'keyframes', value, present: literalId(all, value) })),
      ...(tokens.svg || []).map(value => ({ kind: 'svg', value, present: (drawings.get(value) ?? -1) >= TASTE_LIMITS.illustrationShapes,
        detail: drawings.has(value) ? `${value} draws ${drawings.get(value)} shapes; it needs at least ${TASTE_LIMITS.illustrationShapes}` : `no <svg id="${value}"> and no ${value}.svg` })),
      ...(tokens.ids || []).map(value => ({ kind: 'id', value, present: literalId(all, value) })),
      ...(tokens.copy || []).map(value => { const line = value.replace(/\s+/gu, ' ').trim().toLowerCase(); return { kind: 'copy', value, present: flat.includes(line) || lower.replace(/\s+/gu, ' ').includes(line) }; }),
      ...(tokens.images || []).map(value => ({ kind: 'image', value, present: all.includes(value) })),
      ...(tokens.literals || []).map(value => ({ kind: 'literal', value, present: all.includes(value) })),
    ];
    return { id: device.id, layer: device.layer, device: device.device, ...statusOf(checks), missing: checks.filter(check => !check.present).map(({ kind, value, detail }) => ({ kind, value, ...(detail ? { detail } : {}) })) };
  });
  const totals = score(devices);
  return { status: 'checked', ...totals, threshold: TASTE_LIMITS.conformanceThreshold, meetsThreshold: totals.score >= TASTE_LIMITS.conformanceThreshold, devices,
    limitation: 'Checks that declared colors, font families, CSS values, keyframes, element IDs, SVG drawings, copy, image paths and literals occur in the saved files as written. It does not check that they take effect, nor visual quality, motion quality, semantic fit or preference.' };
}

const VIEWS = {
  web: [{ id: 'desktop', width: 1440, height: 900 }, { id: 'mobile', width: 390, height: 844 }],
  'app-ui': [{ id: 'phone', width: 390, height: 844 }, { id: 'board', width: 1440, height: 900 }],
  generic: [{ id: 'desktop', width: 1280, height: 800 }, { id: 'mobile', width: 390, height: 844 }],
  // A game is played in a wide frame; its own review page picks what it draws, such as a pose or a walk cycle.
  game: [{ id: 'frame', width: 1440, height: 810 }],
};
const websiteDna = rules => (raw, { input, sketch, existingIds, library, fonts, maxRequiredRejections } = {}) => normalizeDesignDna(raw, { input, sketch, existingIds, library, fonts, maxRequiredRejections, rules });

const media = new Map();

/**
 * Register a medium. `layers` are its DNA layers and `requiredLayers` those every reading must carry; each method
 * makes some of the layers and is code, a library material or a generator; every layer needs a method without a
 * generator, so a plan always has a fallback. `validateDna` and `checkConformance` are optional for a host that
 * validates its DNA itself.
 */
export function registerMedium(profile) {
  if (!plain(profile) || !MEDIUM_ID.test(profile.id || '')) throw new Error('A medium needs a lowercase id.');
  const layers = Array.isArray(profile.layers) ? [...new Set(profile.layers)] : [];
  if (!layers.length || !layers.every(layer => /^[a-z][a-z-]{1,30}$/u.test(layer))) throw new Error(`Medium ${profile.id} needs its DNA layers.`);
  const requiredLayers = [...new Set(profile.requiredLayers || [])];
  if (!requiredLayers.every(layer => layers.includes(layer))) throw new Error(`Medium ${profile.id} requires a layer it does not have.`);
  const ids = new Set();
  const methods = (profile.methods || []).map(item => {
    if (!METHOD_ID.test(item?.id || '') || ids.has(item.id)) throw new Error(`Medium ${profile.id} has a missing or repeated method id.`);
    ids.add(item.id);
    if (!METHOD_KINDS.includes(item.kind)) throw new Error(`Method ${item.id} needs a kind: ${METHOD_KINDS.join(', ')}.`);
    if (item.kind === 'generator' && typeof item.generator !== 'string') throw new Error(`Method ${item.id} names no generator.`);
    if (item.kind === 'material' && typeof item.material !== 'string') throw new Error(`Method ${item.id} names no material.`);
    if (!Array.isArray(item.layers) || !item.layers.length || !item.layers.every(layer => layers.includes(layer))) throw new Error(`Method ${item.id} makes a layer the medium does not have.`);
    if (typeof item.description !== 'string' || item.description.length < 10) throw new Error(`Method ${item.id} needs a description.`);
    return Object.freeze({ ...item, layers: Object.freeze([...item.layers]) });
  });
  const bare = layers.filter(layer => !methods.some(item => item.kind !== 'generator' && item.layers.includes(layer)));
  if (bare.length) throw new Error(`Medium ${profile.id} has no method without a generator for ${bare.join(', ')}.`);
  const views = (profile.views || []).map(view => Object.freeze({ id: view.id, width: view.width, height: view.height }));
  const frozen = Object.freeze({ ...profile, layers: Object.freeze(layers), requiredLayers: Object.freeze(requiredLayers), methods: Object.freeze(methods), views: Object.freeze(views) });
  media.set(frozen.id, frozen);
  return frozen;
}

/** The registered profile of a medium; an unknown one names those that exist. */
export function mediumProfile(id = 'web') {
  if (plain(id) && media.has(id.id)) return media.get(id.id);
  if (!media.has(id)) fail('medium', `Use one of: ${[...media.keys()].join(', ')}.`);
  return media.get(id);
}

/** What an agent reads about each medium: its layers, required layers, methods and capture views. */
export function listMedia() {
  return [...media.values()].map(describeMedium);
}
export function describeMedium(profile) {
  return { id: profile.id, label: profile.label, description: profile.description, layers: [...profile.layers], requiredLayers: [...profile.requiredLayers],
    methods: profile.methods.map(item => ({ id: item.id, kind: item.kind, layers: [...item.layers], description: item.description, ...(item.generator ? { generator: item.generator } : {}), ...(item.material ? { material: item.material } : {}) })),
    views: profile.views.map(view => ({ ...view })), ...(profile.entry ? { entry: profile.entry } : {}) };
}

registerMedium({
  id: 'web', label: 'Website', artifact: 'site', entry: 'index.html',
  description: 'A static website in HTML and CSS, checked by its stylesheets, element IDs, inline SVG and visible copy.',
  layers: DNA_LAYERS, requiredLayers: ['palette', 'typography', 'voice'], structuralLayers: STRUCTURAL_DNA_LAYERS, methods: WEB_METHODS, views: VIEWS.web,
  validateDna: websiteDna(undefined), dnaForCheck: raw => normalizeDnaForCheck(raw),
  checkConformance: (dna, files, { library, fonts } = {}) => checkDnaConformance(dna, files, { library, fonts }),
});
registerMedium({
  id: 'app-ui', label: 'App interface', artifact: 'app', entry: 'index.html',
  description: 'An app interface built in HTML and CSS screens whose values live in a design token file, such as tokens/tokens.json, consumed through CSS custom properties.',
  layers: DNA_LAYERS, requiredLayers: ['palette', 'typography', 'voice'], structuralLayers: STRUCTURAL_DNA_LAYERS, methods: APP_UI_METHODS, views: VIEWS['app-ui'],
  validateDna: websiteDna(undefined), dnaForCheck: raw => normalizeDnaForCheck(raw),
  checkConformance: (dna, files, options = {}) => checkAppConformance(dna, files, options),
});
registerMedium({
  id: 'generic', label: 'Project source', artifact: 'project', entry: 'index.html',
  description: 'Any text project, such as a native app, a document or a slide deck, checked by finding each declared token in its files as written.',
  layers: DNA_LAYERS, requiredLayers: ['palette', 'typography', 'voice'], structuralLayers: STRUCTURAL_DNA_LAYERS, methods: GENERIC_METHODS, views: VIEWS.generic,
  validateDna: websiteDna({ motion: 'any', illustration: 'any', literals: true }), dnaForCheck: raw => normalizeDnaForCheck(raw, { literals: true }),
  checkConformance: (dna, files) => checkLiteralConformance(dna, files),
});
// A game, a character or game art: the look lives in the game's own data and code, such as a character file, and is
// found there as written. The type belongs to the game's fixed interface, so a typography device is optional, while
// the way it moves and speaks is required.
registerMedium({
  id: 'game', label: 'Game or character', artifact: 'game', entry: 'index.html',
  description: 'A game, a character or game art whose look, motion and voice live in the game\'s own data and code, checked by finding each declared token in its files as written.',
  layers: DNA_LAYERS, requiredLayers: ['palette', 'motion', 'voice'], structuralLayers: STRUCTURAL_DNA_LAYERS, methods: GENERIC_METHODS, views: VIEWS.game,
  validateDna: websiteDna({ motion: 'any', illustration: 'any', literals: true, typography: 'optional' }), dnaForCheck: raw => normalizeDnaForCheck(raw, { literals: true }),
  checkConformance: (dna, files) => checkLiteralConformance(dna, files),
});
