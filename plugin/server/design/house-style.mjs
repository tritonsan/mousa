// The look models give a page when nothing else decides it, found in a design's own files. Recorded Moûsa designs
// fell into it whatever the audience: the showcase built for a sports, hip-hop and business audience became a warm
// cream page with a condensed display serif, one italic word in clay, small uppercase monospace labels after a short
// rule and numbered cards; the other poles are a near-black page lit by one amber lamp (the venue, the comedy night and
// the record shop drew "Atmospheric" that way), and violet gradients, frosted cards and one neutral sans. Each signature here
// is one such habit, read from the stylesheets and pages; a page keeps at most HOUSE_STYLE_LIMIT of them, so its look
// comes from the audience's works, not from the model. The checks read code, not pixels: they find the habit where it
// is written, and say where.

import { colorsIn } from '../culture/taste.mjs';

export const HOUSE_STYLE_LIMIT = 2;
export const HOUSE_STYLE = Object.freeze([
  Object.freeze({ id: 'cream-ground', label: 'a warm cream or off-white page ground' }),
  Object.freeze({ id: 'stock-display-serif', label: 'a display serif model-made pages default to' }),
  Object.freeze({ id: 'mono-kicker', label: 'small uppercase letter-spaced monospace labels' }),
  Object.freeze({ id: 'italic-accent', label: 'one italic word set apart in a heading' }),
  Object.freeze({ id: 'numbered-sections', label: 'zero-padded section or card numbers (01, 02, 03)' }),
  Object.freeze({ id: 'pill-buttons', label: 'fully rounded pill buttons' }),
  Object.freeze({ id: 'hairline-kicker', label: 'a short hairline rule before a label' }),
  Object.freeze({ id: 'lamp-dark', label: 'a near-black ground lit by one warm amber accent' }),
  Object.freeze({ id: 'violet-gradient', label: 'a purple or violet gradient' }),
  Object.freeze({ id: 'frosted-glass', label: 'frosted glass panels' }),
  Object.freeze({ id: 'neutral-sans-only', label: 'one neutral sans for headings and text' }),
  Object.freeze({ id: 'emoji-icons', label: 'emoji standing in for icons' }),
]);
const LABELS = new Map(HOUSE_STYLE.map(item => [item.id, item.label]));

const STOCK_SERIFS = new Set(['instrument serif', 'fraunces', 'dm serif display', 'dm serif text', 'cormorant garamond', 'cormorant', 'playfair display', 'newsreader', 'gloock', 'young serif']);
const MONOSPACE = new Set(['dm mono', 'space mono', 'courier prime', 'cutive mono', 'jetbrains mono', 'ibm plex mono', 'martian mono', 'roboto mono', 'fira mono', 'fira code',
  'source code pro', 'courier new', 'courier', 'monospace', 'ui-monospace', 'menlo', 'consolas', 'sf mono']);
const NEUTRAL_SANS = new Set(['inter', 'space grotesk', 'dm sans', 'manrope', 'geist', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'helvetica neue', 'helvetica', 'arial', 'sans-serif', 'ui-sans-serif']);
const HEADING = /(?:^|[\s,>+~(])h[1-3](?![\w-])|\.(?:display|headline|hero-title|title|heading)(?![\w-])/iu;
const ROOT = /(?:^|,)\s*(?:html|body|:root)(?![\w-])/iu;
const BUTTON = /button|\.btn(?![\w-])|\.btn-|\.button|\.cta|\.pill|\.chip|\[type=["']?(?:submit|button)|(?:^|[\s,>])a\.[\w-]+|\.link-button/iu;

/** Blocks such as @keyframes and @font-face hold no page rules; they are cut out by matching their braces. */
function withoutBlocks(css, pattern) {
  let out = '', index = 0;
  for (const match of css.matchAll(pattern)) {
    if (match.index < index) continue;
    let depth = 0, end = match.index + match[0].length - 1;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    out += css.slice(index, match.index);
    index = end + 1;
  }
  return out + css.slice(index);
}

/** The page rules of every stylesheet and <style> element: each selector with its declarations. */
function rulesOf(files) {
  const parts = [];
  for (const [file, content] of Object.entries(files || {})) {
    if (typeof content !== 'string') continue;
    if (/\.css$/iu.test(file)) parts.push(content);
    else if (/\.html?$/iu.test(file)) for (const match of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)) parts.push(match[1]);
  }
  const css = withoutBlocks(withoutBlocks(parts.join('\n').replace(/\/\*[\s\S]*?\*\//gu, ' '), /@(?:-webkit-)?keyframes\b[^{]*\{/giu), /@font-face\s*\{/giu);
  const rules = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const selector = match[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    const declarations = new Map();
    for (const part of match[2].split(';')) {
      const at = part.indexOf(':');
      if (at < 1) continue;
      const property = part.slice(0, at).trim().toLowerCase(), value = part.slice(at + 1).trim().replace(/\s*!important\s*$/iu, '');
      if (property && value) declarations.set(property, value);
    }
    rules.push({ selector, declarations });
  }
  return rules;
}

function htmlOf(files) {
  return Object.entries(files || {}).filter(([file, content]) => /\.html?$/iu.test(file) && typeof content === 'string').map(([, content]) => content).join('\n');
}
const visibleText = html => html.replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1\s*>/giu, ' ').replace(/<[^>]+>/gu, ' ').replace(/&nbsp;/gu, ' ').replace(/&[a-z#0-9]+;/giu, ' ');

/** Custom properties as the page declares them, the last declaration of a name winning, as the cascade mostly does. */
function variablesOf(rules) {
  const found = new Map();
  for (const rule of rules) for (const [property, value] of rule.declarations) if (property.startsWith('--')) found.set(property, value);
  return found;
}
function resolve(value, variables, depth = 0) {
  if (depth > 6) return value;
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/gu, (whole, name, fallback) => {
    const found = variables.get(name.toLowerCase()) ?? fallback;
    return found === undefined ? whole : resolve(found, variables, depth + 1);
  });
}
const families = value => value.split(',').map(part => part.trim().replace(/^["']|["']$/gu, '').toLowerCase()).filter(Boolean);
function fontFamilyOf(rule, variables) {
  const family = rule.declarations.get('font-family');
  if (family) return families(resolve(family, variables));
  const font = rule.declarations.get('font');
  // The family list ends the font shorthand, after the size: "italic 400 2rem/1.1 'Instrument Serif', serif".
  const match = font && /(?:^|\s)(?:[\d.]+(?:px|rem|em|%|pt|vw|vh|ex|ch)|(?:xx?-)?(?:small|large)|medium|smaller|larger)(?:\s*\/\s*[\d.]+[a-z%]*)?\s+(.+)$/iu.exec(resolve(font, variables));
  return match ? families(match[1]) : [];
}
const rgb = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
function isCream(hex) {
  const [r, g, b] = rgb(hex), high = Math.max(r, g, b), low = Math.min(r, g, b);
  return high >= 232 && r - b >= 6 && high - low <= 40 && g >= b;
}
/** Hue in degrees, saturation and lightness of a #rrggbb colour, or null for a grey. */
function hsl(hex) {
  const [r, g, b] = rgb(hex).map(value => value / 255), high = Math.max(r, g, b), low = Math.min(r, g, b), light = (high + low) / 2;
  if (high === low) return null;
  const saturation = light > 0.5 ? (high - low) / (2 - high - low) : (high - low) / (high + low);
  const hue = high === r ? 60 * (((g - b) / (high - low)) % 6) : high === g ? 60 * ((b - r) / (high - low) + 2) : 60 * ((r - g) / (high - low) + 4);
  return { hue: (hue + 360) % 360, saturation, light };
}
const isViolet = hex => { const c = hsl(hex); return Boolean(c) && c.hue >= 250 && c.hue <= 300 && c.saturation >= 0.35 && c.light >= 0.25 && c.light <= 0.8; };
const isAmber = hex => { const c = hsl(hex); return Boolean(c) && c.hue >= 18 && c.hue <= 45 && c.saturation >= 0.45 && c.light >= 0.38 && c.light <= 0.68; };
const isNearBlack = hex => Math.max(...rgb(hex)) <= 48;
/** A length in pixels at a 16px root, or null for one that is not a length. */
function pixels(value) {
  const match = /^(-?[\d.]+)(px|rem|em)?$/iu.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] && match[2].toLowerCase() !== 'px' ? amount * 16 : amount;
}

/**
 * The house-style signatures a design's files carry, each with where it was found. `files` maps project paths to
 * their text, as design_check reads them; pages and stylesheets are read, scripts are not.
 */
export function houseStyleSignatures(files) {
  const rules = rulesOf(files), variables = variablesOf(rules), html = htmlOf(files), text = visibleText(html);
  const found = new Map();
  let dark = null, amber = null;
  const note = (id, evidence) => { if (!found.has(id)) found.set(id, String(evidence).replace(/\s+/gu, ' ').trim().slice(0, 140)); };

  for (const rule of rules) {
    const { selector, declarations } = rule;
    if (ROOT.test(selector)) for (const property of ['background-color', 'background']) {
      const value = declarations.get(property);
      const color = value && colorsIn(resolve(value, variables))[0];
      if (color && isCream(color)) note('cream-ground', `${selector} ${property}: ${color}`);
      if (color && isNearBlack(color)) dark ||= `${selector} ${color}`;
    }
    for (const value of declarations.values()) if (!amber) amber = colorsIn(resolve(value, variables)).find(isAmber) || null;
    const family = fontFamilyOf(rule, variables);
    if (HEADING.test(selector) && family[0] && STOCK_SERIFS.has(family[0])) note('stock-display-serif', `${selector} in ${family[0]}`);
    const spacing = declarations.get('letter-spacing');
    if (/uppercase/iu.test(declarations.get('text-transform') || '') && spacing && family.some(name => MONOSPACE.has(name))) {
      const amount = /^([\d.]+)(em|rem)$/iu.exec(resolve(spacing, variables).trim()), px = pixels(resolve(spacing, variables));
      if ((amount && Number(amount[1]) >= 0.06) || (!amount && px !== null && px >= 1)) note('mono-kicker', `${selector}: uppercase ${family.find(name => MONOSPACE.has(name))}, letter-spacing ${spacing}`);
    }
    const radius = declarations.get('border-radius');
    if (radius && BUTTON.test(selector)) {
      const value = resolve(radius, variables);
      const pill = value.split(/\s+/u).some(part => { const px = pixels(part); return (px !== null && px >= 99) || /^(?:[5-9]\d|100)%$/u.test(part) || /^\d+(?:vh|vw|vmax|vmin)$/u.test(part) || /9{3,}/u.test(part); });
      if (pill) note('pill-buttons', `${selector} border-radius: ${radius}`);
    }
    if (/::?(?:before|after)/iu.test(selector) && declarations.has('content')) {
      const width = pixels(resolve(declarations.get('width') || '', variables)), height = pixels(resolve(declarations.get('height') || '', variables));
      const border = ['border-top', 'border-bottom'].map(property => declarations.get(property)).find(value => value && /\b(?:1|1\.5|2)px\b/u.test(value));
      if (width !== null && width >= 8 && width <= 96 && ((height !== null && height > 0 && height <= 2) || border)) note('hairline-kicker', `${selector}: ${width}px rule`);
    }
    for (const [property, value] of declarations) {
      if (!/gradient\(/iu.test(value)) continue;
      const violet = colorsIn(resolve(value, variables)).find(isViolet);
      if (violet) { note('violet-gradient', `${selector} ${property} with ${violet}`); break; }
    }
    const backdrop = declarations.get('backdrop-filter') || declarations.get('-webkit-backdrop-filter');
    const ground = resolve(declarations.get('background') || declarations.get('background-color') || '', variables);
    if (backdrop && /blur\(/iu.test(backdrop) && /rgba?\([^)]*,\s*0?\.\d+\s*\)|hsla?\([^)]*,\s*0?\.\d+\s*\)|\/\s*0?\.\d+\s*\)|#[0-9a-f]{8}\b/iu.test(ground)) note('frosted-glass', `${selector} backdrop-filter: ${backdrop}`);
    if (Array.from(declarations.values()).some(value => /decimal-leading-zero/iu.test(value))) note('numbered-sections', `${selector} counts with decimal-leading-zero`);
  }

  if (dark && amber) note('lamp-dark', `${dark} lit by ${amber}`);
  // One neutral sans everywhere: the page's own family, inherited by headings that set none of their own.
  const bodyFamily = rules.filter(rule => ROOT.test(rule.selector)).map(rule => fontFamilyOf(rule, variables)).filter(list => list.length).at(-1) || [];
  const headingFamily = rules.filter(rule => HEADING.test(rule.selector)).map(rule => fontFamilyOf(rule, variables)).filter(list => list.length).at(-1) || bodyFamily;
  if (bodyFamily[0] && NEUTRAL_SANS.has(bodyFamily[0]) && headingFamily[0] && NEUTRAL_SANS.has(headingFamily[0])) note('neutral-sans-only', `headings in ${headingFamily[0]}, text in ${bodyFamily[0]}`);

  for (const match of html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/giu)) {
    const accent = /<(em|i)\b([^>]*)>([\s\S]*?)<\/\1\s*>/iu.exec(match[1]);
    if (accent && !/class\s*=\s*["'][^"']*(?:icon|fa-|bi-|material|ph-)/iu.test(accent[2])) { note('italic-accent', `“${visibleText(match[1]).trim()}” sets “${visibleText(accent[3]).trim()}” apart`); break; }
  }
  const numbers = new Set([...text.matchAll(/(?<![\w./:,-])0[1-9](?![\w:/,-])/gu)].map(match => match[0]));
  if (numbers.size >= 3) note('numbered-sections', `the page numbers its parts ${[...numbers].sort().slice(0, 4).join(', ')}`);
  const emoji = [...text.matchAll(/\p{Emoji_Presentation}/gu)].map(match => match[0]);
  if (emoji.length >= 3) note('emoji-icons', `${emoji.length} emoji, such as ${[...new Set(emoji)].slice(0, 4).join(' ')}`);

  return HOUSE_STYLE.filter(item => found.has(item.id)).map(item => ({ id: item.id, label: LABELS.get(item.id), evidence: found.get(item.id) }));
}

/** What design_check reports: the signatures found, the limit, and whether the page is over it. */
export function houseStyleReport(files) {
  const signatures = houseStyleSignatures(files);
  return { signatures, count: signatures.length, limit: HOUSE_STYLE_LIMIT, over: signatures.length > HOUSE_STYLE_LIMIT };
}
