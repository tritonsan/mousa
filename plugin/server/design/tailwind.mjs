// Tailwind as a design system: the theme that holds the values, and the utility classes that use them.
// Tailwind 4 keeps its theme in CSS, as custom properties inside @theme (--color-mist, --font-display, --animate-drift);
// Tailwind 3 keeps it in tailwind.config (theme.colors, theme.extend.colors, theme.fontFamily, theme.animation and
// theme.keyframes). Either way a theme value takes effect only where a class names it: bg-mist, text-mist/80,
// md:hover:border-mist-500, font-display, animate-drift, or @apply in a stylesheet.

import { normalizeTasteName, animationValueNames } from '../culture/taste.mjs';
import { holdsColor } from './colors.mjs';

const CONFIG = /(?:^|\/)tailwind\.config\.(?:js|cjs|mjs|ts)$/iu;
const MARKUP = /\.(?:html?|jsx|tsx|vue|svelte|astro|mdx?)$/iu;
const COLOR_UTILITIES = ['bg', 'text', 'border', 'border-t', 'border-r', 'border-b', 'border-l', 'border-x', 'border-y', 'ring', 'ring-offset', 'fill', 'stroke',
  'from', 'via', 'to', 'outline', 'decoration', 'accent', 'caret', 'shadow', 'divide', 'placeholder', 'inset-ring', 'inset-shadow'];
const COLOR_CLASS = new RegExp(`(?<![\\w-])(?:[\\w\\-\\[\\]]+:)*!?(?:${COLOR_UTILITIES.join('|')})-([a-z][a-z0-9-]*)(?:\\/[\\w.\\[\\]]+)?(?![\\w-])`, 'gu');
const FONT_CLASS = /(?<![\w-])(?:[\w\-[\]]+:)*!?font-([a-z][a-z0-9-]*)(?![\w-])/gu;
// animate-drift, md:animate-drift, or an arbitrary value such as animate-[drift_6s_ease-in-out_infinite].
const ANIMATE_CLASS = /(?<![\w-])(?:[\w\-[\]]+:)*!?animate-(?:([a-z][a-z0-9-]*)|\[([^\]\s]+)\])(?![\w-])/gu;
// A class that stops or keeps motion for people who ask for less: motion-reduce:animate-none, motion-safe:animate-drift.
const MOTION_VARIANT = /(?<![\w-])(?:[\w\-[\]]+:)*(?:motion-reduce:(?:animate-|transition|transform-none|duration-)|motion-safe:(?:animate-|transition))/u;

/** Whether a project uses Tailwind: a config file, or a stylesheet that imports it or declares a theme. */
export function usesTailwind(files) {
  return Object.keys(files).some(name => CONFIG.test(name))
    || Object.entries(files).some(([name, text]) => /\.css$/iu.test(name) && /@tailwind\b|@import\s+["']tailwindcss|@theme\b/u.test(text));
}

/** A small reader for the object literals of a config file: strings, numbers, arrays and nested objects. */
function readLiteral(text, start) {
  let index = start;
  const space = () => { for (;;) { const rest = text.slice(index); const skip = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/u.exec(rest); if (!skip) return; index += skip[0].length; } };
  const value = () => {
    space();
    const char = text[index];
    if (char === '{') {
      index++;
      const object = {};
      for (;;) {
        space();
        if (text[index] === '}') { index++; return object; }
        const key = /^(?:"([^"]*)"|'([^']*)'|([\w$-]+))/u.exec(text.slice(index));
        if (!key) return skipExpression(object);
        index += key[0].length;
        space();
        if (text[index] !== ':') return skipExpression(object);
        index++;
        object[key[1] ?? key[2] ?? key[3]] = value();
        space();
        if (text[index] === ',') index++;
      }
    }
    if (char === '[') {
      index++;
      const array = [];
      for (;;) {
        space();
        if (text[index] === ']') { index++; return array; }
        array.push(value());
        space();
        if (text[index] === ',') index++;
        else if (text[index] !== ']') { skipExpression(null); return array; }
      }
    }
    const string = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`$]*)`)/u.exec(text.slice(index));
    if (string) { index += string[0].length; return string[1] ?? string[2] ?? string[3]; }
    return skipExpression(null);
  };
  // Anything else, such as a function call or a spread, is skipped to the next separator at its own depth.
  const skipExpression = result => {
    let depth = 0;
    while (index < text.length) {
      const char = text[index];
      if ('{[('.includes(char)) depth++;
      else if ('}])'.includes(char)) { if (!depth) return result; depth--; }
      else if (char === ',' && !depth) return result;
      index++;
    }
    return result;
  };
  return value();
}

/** Every object a config file gives a key, such as colors in both theme and theme.extend. */
function objectsNamed(text, key) {
  const found = [];
  for (const match of text.matchAll(new RegExp(`(?<![\\w$])${key}\\s*:\\s*\\{`, 'gu'))) {
    const object = readLiteral(text, match.index + match[0].length - 1);
    if (object && typeof object === 'object' && !Array.isArray(object)) found.push(object);
  }
  return found;
}

/** The bodies of a stylesheet's @theme blocks, braces counted, since a theme may hold its own @keyframes. */
function themeBlocks(css) {
  const bodies = [];
  for (const match of css.matchAll(/@theme\b[^{;]*\{/gu)) {
    let depth = 1, index = match.index + match[0].length;
    const start = index;
    while (index < css.length && depth) { if (css[index] === '{') depth++; else if (css[index] === '}') depth--; index++; }
    bodies.push(css.slice(start, index - 1));
  }
  return bodies;
}

/** Nested theme colours as Tailwind names them: mist, mist-500 and mist for its DEFAULT. */
function flattenColors(object, prefix = '', into = new Map()) {
  for (const [key, value] of Object.entries(object || {})) {
    const name = key === 'DEFAULT' ? prefix : prefix ? `${prefix}-${key}` : key;
    if (typeof value === 'string' && name) into.set(name, value);
    else if (value && typeof value === 'object' && !Array.isArray(value)) flattenColors(value, name, into);
  }
  return into;
}

/**
 * The theme: colour and font names with their values, from Tailwind 4's @theme blocks and Tailwind 3's config.
 * `resolve` follows var() in a value, so hsl(var(--primary)) and --color-primary: var(--primary) reach the colour.
 */
export function tailwindTheme(files, { resolve = value => value } = {}) {
  const colors = new Map(), fonts = new Map(), animations = new Map(), keyframes = new Set(), sources = [];
  for (const [name, text] of Object.entries(files)) {
    if (!/\.css$/iu.test(name)) continue;
    for (const body of themeBlocks(text.replace(/\/\*[\s\S]*?\*\//gu, ' '))) {
      sources.push(name);
      // Only the block's own declarations: a nested @keyframes is left out.
      const own = body.replace(/\{[^{}]*\}/gu, ' ');
      for (const match of own.matchAll(/--(color|font|animate)-([a-z0-9-]+)\s*:\s*([^;]+);?/giu)) {
        const kind = match[1].toLowerCase();
        (kind === 'color' ? colors : kind === 'font' ? fonts : animations).set(match[2], resolve(match[3].trim()));
      }
    }
  }
  for (const [name, text] of Object.entries(files)) {
    if (!CONFIG.test(name)) continue;
    sources.push(name);
    for (const object of objectsNamed(text, 'colors')) for (const [key, value] of flattenColors(object)) colors.set(key, resolve(value));
    for (const object of objectsNamed(text, 'fontFamily')) {
      for (const [key, value] of Object.entries(object)) fonts.set(key, resolve(Array.isArray(value) ? value.filter(item => typeof item === 'string').join(', ') : String(value ?? '')));
    }
    // Tailwind 3 names its animations, and may define their keyframes as objects rather than CSS.
    for (const object of objectsNamed(text, 'animation')) for (const [key, value] of Object.entries(object)) if (typeof value === 'string') animations.set(key, resolve(value));
    for (const object of objectsNamed(text, 'keyframes')) for (const key of Object.keys(object)) keyframes.add(key);
  }
  return { colors, fonts, animations, keyframes, sources: [...new Set(sources)], version: sources.some(source => CONFIG.test(source)) ? 3 : sources.length ? 4 : null };
}

/**
 * The colour, font and animation names the project's classes use, in its markup, its scripts and @apply rules; the
 * animation values written inline as arbitrary classes; and whether a class keeps motion for those who want less of it.
 */
export function utilityNames(files) {
  const colors = new Set(), fonts = new Set(), animations = new Set(), arbitraryAnimations = [];
  let reducedMotion = false;
  for (const [name, text] of Object.entries(files)) {
    const source = MARKUP.test(name) || /\.(?:m?js|cjs|ts)$/iu.test(name) ? text : /\.css$/iu.test(name) ? [...text.matchAll(/@apply\s+([^;}]+)/gu)].map(match => match[1]).join(' ') : '';
    for (const match of source.matchAll(COLOR_CLASS)) colors.add(match[1]);
    for (const match of source.matchAll(FONT_CLASS)) fonts.add(match[1]);
    for (const match of source.matchAll(ANIMATE_CLASS)) {
      if (match[1] && match[1] !== 'none') animations.add(match[1]);
      if (match[2]) arbitraryAnimations.push(match[2].replace(/_/gu, ' '));
    }
    if (MOTION_VARIANT.test(source)) reducedMotion = true;
  }
  return { colors, fonts, animations, arbitraryAnimations, reducedMotion };
}

/**
 * How the project animates through Tailwind: the keyframes that a theme animation a class names runs (or an arbitrary
 * animate-[…] class), which of those loop forever, and whether classes keep motion for those who want less. `used` holds
 * the custom properties the styles reach through var(), so var(--animate-drift) counts as use of the drift animation.
 */
export function tailwindMotion(files, { resolve, used = new Set() } = {}) {
  const theme = tailwindTheme(files, { resolve }), classes = utilityNames(files);
  const runs = new Map();
  const add = (value, via) => {
    const { names, infinite } = animationValueNames(value);
    for (const name of names) runs.set(name, { via, infinite: Boolean(runs.get(name)?.infinite || infinite) });
  };
  for (const [name, value] of theme.animations) if (classes.animations.has(name) || used.has(`animate-${name}`)) add(value, `animate-${name}`);
  for (const value of classes.arbitraryAnimations) add(value, `animate-[${value.replace(/\s+/gu, '_')}]`);
  return { runs, keyframes: theme.keyframes, reducedMotion: classes.reducedMotion, animations: theme.animations };
}

const familyIn = (value, family) => String(value).split(',').some(part => normalizeTasteName(part.replace(/["']/gu, '')) === normalizeTasteName(family));

/**
 * Where each palette colour and typography family of the DNA is bound in Tailwind: the theme names that hold it, and
 * the one a class uses. A var() reference to the theme's custom property counts as use too.
 */
export function tailwindBindings(dna, files, { resolve, used = new Set() } = {}) {
  const theme = tailwindTheme(files, { resolve }), classes = utilityNames(files);
  const bindings = [];
  for (const device of dna.devices || []) {
    if (!['palette', 'typography'].includes(device.layer)) continue;
    for (const value of device.tokens?.colors || []) {
      const names = [...theme.colors].filter(([, held]) => holdsColor(held, value)).map(([name]) => name);
      const live = names.find(name => classes.colors.has(name) || used.has(`color-${name}`));
      bindings.push({ device: device.id, kind: 'color', value, names, live });
    }
    for (const value of device.tokens?.fonts || []) {
      const names = [...theme.fonts].filter(([, held]) => familyIn(held, value)).map(([name]) => name);
      const live = names.find(name => classes.fonts.has(name) || used.has(`font-${name}`));
      bindings.push({ device: device.id, kind: 'font', value, names, live });
    }
  }
  return { theme, bindings };
}
