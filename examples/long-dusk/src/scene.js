// The open art direction of the moment. Lore, layout and gameplay stay fixed; a character file may set the scene's
// colours, weather, mist and the style of the beacons, the render style of the whole frame and the music. This module
// holds the vocabularies and turns a scene's few anchor colours into every colour the world draws with. It has no DOM
// access, so the harness can check and measure scenes in Node.

import { clamp, lerp, parseHex, toHex } from './math.js';

export const WEATHER_KINDS = Object.freeze(['fireflies', 'snow', 'rain', 'petals', 'leaves', 'embers', 'ash', 'motes', 'none']);
export const TOWER_STYLES = Object.freeze(['stone', 'spire', 'pagoda', 'ruin']);
export const TOWER_NOTES = Object.freeze({
  stone: 'squat banded stone with a shallow bowl (the default)',
  spire: 'a slender needle ringed with bands, the fire held in a cradle of prongs',
  pagoda: 'stacked tiers under upturned eaves, the fire in a lantern room at the top',
  ruin: 'a broken, leaning shaft missing blocks, the fire in a cracked dish',
});
export const WEATHER_NOTES = Object.freeze({
  fireflies: 'glowing points drifting low over the road (the default)', snow: 'flakes falling slowly in three depths, drifting with the wind',
  rain: 'fast slanted streaks', petals: 'petals tumbling down on the wind', leaves: 'larger leaves tumbling down', embers: 'glowing sparks rising',
  ash: 'grey flakes sinking slowly', motes: 'soft dust motes hanging in the air', none: 'clear air',
});
const WEATHER_COLORS = { fireflies: '#d6f0dc', snow: '#eef2f7', rain: '#a9b8c9', petals: '#f2b8c6', leaves: '#d9883f', embers: '#ffad5c', ash: '#9a9590', motes: '#f3e6c8', none: '#ffffff' };
export const defaultWeatherColor = kind => WEATHER_COLORS[kind] || '#ffffff';

/**
 * Render styles for the whole frame, each with the art-style words that name it. A Qloo art-style tag such as
 * "Cel-Shaded" or "Pixel Art" on a measured game, film or show names exactly one of them, so a measured tag can choose
 * the render style without the model's own preference in between.
 */
export const RENDER_PRESETS = Object.freeze({
  lit: Object.freeze({ label: 'Lit dusk', note: 'soft light pools in the dusk, a fine grain and a vignette (the default)', words: Object.freeze([]) }),
  ink: Object.freeze({ label: 'Ink and paper', note: 'dark ink outlines on every shape, a warm paper grain and a muted, sepia-leaning tone; the lines boil slightly as if redrawn each frame',
    words: Object.freeze(['hand drawn', 'traditional animation', 'ink', 'sketch', 'sketchy', 'line art', 'storybook', 'illustrated', 'illustration', 'comic', 'manga', 'woodcut', 'engraving', 'pencil', 'linework']) }),
  watercolor: Object.freeze({ label: 'Watercolour', note: 'soft washes that bleed at the edges, pale pigment and a rough paper texture',
    words: Object.freeze(['watercolor', 'watercolour', 'painterly', 'painted', 'gouache', 'pastel', 'impressionist', 'oil painting', 'brushstroke', 'brushwork']) }),
  cel: Object.freeze({ label: 'Cel-shaded', note: 'bold outlines, light in two or three hard bands, a banded sky and saturated colour',
    words: Object.freeze(['cel shaded', 'cell shaded', 'cel shading', 'cel', 'toon', 'anime', 'cartoon', 'cartoony', 'pop art']) }),
  pixel: Object.freeze({ label: 'Pixel art', note: 'the frame drawn at a low resolution with hard pixels, a reduced palette and ordered dithering',
    words: Object.freeze(['pixel', 'pixel art', 'pixelated', '8 bit', '16 bit', 'sprite', 'spritework', 'retro', 'hd 2d']) }),
  neon: Object.freeze({ label: 'Neon', note: 'deep shadows, glowing edges and lights that bloom, with faint scanlines',
    words: Object.freeze(['neon', 'synthwave', 'cyberpunk', 'vaporwave', 'retrowave', 'glowing']) }),
  flat: Object.freeze({ label: 'Flat minimal', note: 'flat colour without grain or vignette, light and sky in a few clean steps',
    words: Object.freeze(['minimalist', 'minimalistic', 'minimal', 'minimalism', 'flat', 'low poly', 'poly', 'geometric', 'vector', 'clean']) }),
  cinematic: Object.freeze({ label: 'Cinematic', note: 'a widescreen letterbox, blooming highlights, a deep vignette, film grain and a graded contrast',
    words: Object.freeze(['cinematic', 'realistic', 'photorealistic', 'high fidelity', 'filmic', 'noir', 'film noir']) }),
});
export const RENDER_NAMES = Object.freeze(Object.keys(RENDER_PRESETS));

const words = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
// A one-word art-style term matches a whole word, or the start of a longer one from five letters ("spritework").
const wordMatches = (term, word) => term === word || (term.length >= 5 && word.startsWith(term));
function phraseIn(phrase, tokens) {
  const parts = phrase.split(' ');
  for (let i = 0; i + parts.length <= tokens.length; i++) if (parts.every((part, k) => (parts.length > 1 ? tokens[i + k] === part : wordMatches(part, tokens[i + k])))) return true;
  return false;
}
/**
 * The render style an art-style name stands for, or null. Longer phrases are tried first, so "Cel-shaded visuals"
 * is cel and "Stylized anime-inspired 3D" is cel too, while "Stylized" or "3D" names no render style.
 */
export function presetForArtStyle(name) {
  const tokens = words(name);
  if (!tokens.length) return null;
  const terms = RENDER_NAMES.flatMap(preset => RENDER_PRESETS[preset].words.map(term => ({ preset, term }))).sort((a, b) => b.term.length - a.term.length);
  return terms.find(({ term }) => phraseIn(term, tokens))?.preset ?? null;
}

// ---------- Colour ----------

const toLinear = value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const toGamma = value => (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
export function hexToLab(hex) {
  const [r, g, b] = parseHex(hex).map(channel => toLinear(channel / 255));
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function labToHex([l, a, b]) {
  const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inverse = t => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = inverse(fx) * 0.95047, y = inverse(fy), z = inverse(fz) * 1.08883;
  const rgb = [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z];
  return toHex(rgb.map(channel => clamp(toGamma(clamp(channel, 0, 1)), 0, 1) * 255));
}
export const lightness = hex => hexToLab(hex)[0];

/**
 * The current look of the Vesper Cliffs as a scene. Every world colour belongs to one anchor: the sky (from zenith to
 * horizon), the sun, the cloud sea, the basalt, the foliage or the sunlit rim. A scene moves an anchor and the
 * colours that belong to it follow by the same CIE Lab shift, so a violet dusk keeps the hand-tuned contrasts of the
 * teal one. The default scene draws exactly the original colours.
 */
export const DEFAULT_SCENE = Object.freeze({
  sky: Object.freeze(['#19213a', '#80a99d']), sun: '#efe7d6', clouds: '#96a5b5', rock: '#2a3044', foliage: '#4a6855', rim: '#93b9ad',
  flags: Object.freeze(['#6b7fa1', '#cfc7b4', '#79a49a', '#9b6e5f', '#5f6c54']),
  // Density 0.4 is the original thirty fireflies.
  weather: Object.freeze({ kind: 'fireflies', density: 0.4, color: WEATHER_COLORS.fireflies }), fog: 0, towers: 'stone',
});

// Each world colour: its original value and the anchor it follows. A sky colour names its place between zenith (0) and
// horizon (1); a far spire mixes the horizon's shift with the basalt's, more of the basalt the nearer it stands.
const BASE = {
  zenith: ['#19213a', 'sky', 0], upper: ['#25385a', 'sky', 0.33], middle: ['#466879', 'sky', 0.66], horizon: ['#80a99d', 'sky', 1], haze: ['#d1d9c9', 'sky', 1], cirrus: ['#d6dfd2', 'sky', 1],
  sun: ['#efe7d6', 'sun'], sunEdge: ['#cfc5b2', 'sun'], sunGlow: ['#b9c9bd', 'sunHorizon'], sunBands: ['#8fa8a2', 'sunHorizon'],
  skyBottom: ['#3a4762', 'clouds'],
  basalt: ['#2a3044', 'rock'], basaltDeep: ['#1d2232', 'rock'], basaltFace: ['#252b3d', 'rock'], stone: ['#3a4054', 'rock'], iron: ['#22262f', 'rock'],
  silhouette: ['#111724', 'rock'], bird: ['#1b2232', 'rock'], midMass: ['#232a3c', 'rock'], midJoint: ['#0f131d', 'rock'], bowl: ['#2b2a2c', 'rock'], chain: ['#191c24', 'rock'],
  roadDeep: ['#0c1019', 'rock'], roadJoint: ['#0a0d15', 'rock'], glassCold: ['#2e3648', 'rock'], towerShade: ['#10141f', 'rock'], smoke: ['#5d6476', 'rock'],
  lichen: ['#4e6d5b', 'foliage'], moss: ['#3d574a', 'foliage'], grassFront: ['#26372f', 'foliage'], mossStroke: ['#33503f', 'foliage'], vine: ['#26352e', 'foliage'],
  rim: ['#93b9ad', 'rim'], spireRim: ['#d9e2d4', 'rim'],
};
const LISTS = {
  road: [['#2b3246', '#262c3f', '#30374c'], 'rock'], grass: [['#3c5646', '#4a6855', '#58785f'], 'foliage'],
  bandLit: [['#c5cec4', '#abb9bd', '#96a5b5', '#7f8ea7', '#68778f'], 'clouds'], bandShade: [['#93a6aa', '#6f8397', '#55667f', '#3c4964', '#283249'], 'clouds'],
};
const SPIRES = [['#7a939a', 0.3], ['#5b7383', 0.5], ['#3e5167', 0.7]];
// Colours that are materials or fire, not light: they stay as they are in every scene.
const FIXED = { ambientWarm: '#e2cdb7', wood: '#4d3d32', woodDark: '#2f261f', rope: '#6a5a49', star: '#e8eef6', coldEmber: '#9a4c34', coldGlow: '#8a3a2c', coals: '#3b2724', coalsWarm: '#3a2a24', emberCold: '#7a3a2a' };
const AMBIENT = '#7f88a8';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mixDelta = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const zero = delta => Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) < 1e-6;
function shift(hex, delta) {
  if (zero(delta)) return hex;
  const lab = hexToLab(hex);
  return labToHex([clamp(lab[0] + delta[0], 0, 100), lab[1] + delta[1], lab[2] + delta[2]]);
}

/** A scene with every optional field filled from the default look. */
export function completeScene(scene) {
  const source = scene || {};
  const weather = source.weather || DEFAULT_SCENE.weather;
  return {
    sky: source.sky ? [...source.sky] : [...DEFAULT_SCENE.sky], sun: source.sun || DEFAULT_SCENE.sun, clouds: source.clouds || DEFAULT_SCENE.clouds,
    rock: source.rock || DEFAULT_SCENE.rock, foliage: source.foliage || DEFAULT_SCENE.foliage, rim: source.rim || DEFAULT_SCENE.rim,
    flags: source.flags ? [...source.flags] : [...DEFAULT_SCENE.flags],
    weather: { kind: weather.kind, density: weather.density ?? 0.4, color: weather.color || defaultWeatherColor(weather.kind) },
    fog: source.fog ?? 0, towers: source.towers || 'stone',
  };
}

/** Every colour the world draws with, for one scene. */
export function scenePalette(scene) {
  const spec = completeScene(scene);
  const anchors = {
    zenith: sub(hexToLab(spec.sky[0]), hexToLab(DEFAULT_SCENE.sky[0])), horizon: sub(hexToLab(spec.sky[1]), hexToLab(DEFAULT_SCENE.sky[1])),
    sun: sub(hexToLab(spec.sun), hexToLab(DEFAULT_SCENE.sun)), clouds: sub(hexToLab(spec.clouds), hexToLab(DEFAULT_SCENE.clouds)),
    rock: sub(hexToLab(spec.rock), hexToLab(DEFAULT_SCENE.rock)), foliage: sub(hexToLab(spec.foliage), hexToLab(DEFAULT_SCENE.foliage)),
    rim: sub(hexToLab(spec.rim), hexToLab(DEFAULT_SCENE.rim)),
  };
  const deltaFor = (family, t = 0) => family === 'sky' ? mixDelta(anchors.zenith, anchors.horizon, t)
    : family === 'sunHorizon' ? mixDelta(anchors.sun, anchors.horizon, 0.5) : anchors[family];
  const palette = { ...FIXED };
  for (const [key, [hex, family, t]] of Object.entries(BASE)) palette[key] = shift(hex, deltaFor(family, t));
  for (const [key, [list, family]] of Object.entries(LISTS)) palette[key] = list.map(hex => shift(hex, deltaFor(family)));
  palette.spires = SPIRES.map(([hex, weight]) => shift(hex, mixDelta(anchors.horizon, anchors.rock, weight)));
  // The ambient light follows the sky's middle in hue, and half as much in lightness, so a pale sky does not flood the
  // road with light the lamplighter's flame should bring.
  const middle = mixDelta(anchors.zenith, anchors.horizon, 0.5);
  palette.ambient = shift(AMBIENT, [middle[0] * 0.5, middle[1], middle[2]]);
  palette.flags = [...spec.flags];
  palette.weather = spec.weather.color;
  return palette;
}

/** The colours a scene declares, for conformance and distance: sky, sun, clouds, rock, foliage, rim and flags. */
export function sceneColors(scene) {
  const spec = completeScene(scene);
  return [...new Set([...spec.sky, spec.sun, spec.clouds, spec.rock, spec.foliage, spec.rim, ...spec.flags].map(hex => hex.toLowerCase()))];
}
