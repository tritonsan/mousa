// The distance between two designs whose look lives in data and code, such as two arms of a game: the colours their
// files write, the ids of their parts and the words of their text. Only the files that differ between the two arms are
// read, since a file both arms share, such as a game's engine or its keeper, cannot tell them apart and would only
// dilute the difference. The web fingerprint reads stylesheets and pages, which two game arms share unchanged.

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b|0x(?:[0-9a-f]{2})?[0-9a-f]{6}\b/giu;
const expand = value => {
  const digits = value.toLowerCase().replace(/^#|^0x/u, '');
  const rgb = digits.length === 8 ? digits.slice(2) : digits;
  return `#${rgb.length === 3 ? rgb.split('').map(char => char + char).join('') : rgb}`;
};

function lab(hex) {
  const [r, g, b] = [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const [x, y, z] = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883];
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// A design whose parts and rules live in code, such as a one-page canvas game, names them there rather than in data:
// its functions, classes and constants, read from script files and from a page's inline scripts.
const CODE_NAMES = /\b(?:function\s*\*?\s*([A-Za-z_$][\w$]{2,48})|class\s+([A-Za-z_$][\w$]{2,48})|(?:const|let|var)\s+([A-Z][A-Z0-9_]{2,48})\s*=)/gu;
const STRINGS = /["'`]((?:[^"'`\\\n]|\\.){12,400})["'`]/gu;
/** The script a file holds: a script file whole, or the inline scripts of a page. */
function scriptsOf(name, text) {
  if (/\.(?:m?js|ts|lua|gd|cs|swift|kt|dart)$/iu.test(name)) return [text];
  if (/\.html?$/iu.test(name)) return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)].map(match => match[1]);
  return [];
}
const jaccard = (a, b) => { const x = new Set(a), y = new Set(b); const union = new Set([...x, ...y]); return union.size ? [...x].filter(item => y.has(item)).length / union.size : 1; };
const round = value => Math.round(value * 1000) / 1000;

/** The files of `a` and `b` that differ: changed in one, or present in only one. */
export function differingFiles(a, b) {
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(name => a[name] !== b[name]);
  return [Object.fromEntries(names.filter(name => typeof a[name] === 'string').map(name => [name, a[name]])), Object.fromEntries(names.filter(name => typeof b[name] === 'string').map(name => [name, b[name]]))];
}

/**
 * The colours a design's files write, most used first; the parts it names, as ids in its data and as functions,
 * classes and constants in its code; and the words of its longer strings.
 */
export function dataFingerprint(files) {
  const counts = new Map(), ids = new Set(), words = new Set();
  for (const [name, text] of Object.entries(files)) {
    if (typeof text !== 'string') continue;
    for (const match of text.matchAll(HEX)) { const hex = expand(match[0]); counts.set(hex, (counts.get(hex) || 0) + 1); }
    for (const match of text.matchAll(/["']id["']\s*:\s*["']([^"'\n]{1,80})["']/gu)) ids.add(match[1].toLowerCase());
    const scripts = scriptsOf(name, text);
    for (const script of scripts) for (const match of script.matchAll(CODE_NAMES)) ids.add((match[1] || match[2] || match[3]).toLowerCase());
    // Lines, descriptions and names: string values of three or more words, in data files and scripts.
    for (const source of /\.(?:json|ya?ml)$/iu.test(name) ? [text] : scripts) {
      for (const match of source.matchAll(STRINGS)) {
        const found = match[1].toLowerCase().match(/[a-z]+(?:'[a-z]+)?/gu) || [];
        if (found.length >= 3) for (const word of found) if (word.length > 2) words.add(word);
      }
    }
  }
  const palette = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 10).map(([hex, count]) => ({ hex, count }));
  return { palette, ids: [...ids].sort(), words: [...words].sort() };
}

/** How far two palettes sit apart: the mean nearest CIE76 difference each way, over 100. */
function paletteDistance(a, b) {
  const left = a.slice(0, 8).map(item => lab(item.hex)), right = b.slice(0, 8).map(item => lab(item.hex));
  if (!left.length && !right.length) return 0;
  if (!left.length || !right.length) return 1;
  const nearest = (from, to) => from.reduce((sum, color) => sum + Math.min(...to.map(other => deltaE(color, other))), 0) / from.length;
  return Math.min(1, (nearest(left, right) + nearest(right, left)) / 2 / 100);
}

/**
 * Palette 45%, the parts' names 30% and the words of the text 25%. A part neither design has, such as data ids in two
 * games written wholly in code, tells nothing either way, so it is left out and the rest reweighted rather than
 * counted as alike.
 */
export function compareDataFingerprints(a, b) {
  const parts = [
    { weight: 0.45, value: paletteDistance(a.palette, b.palette), signal: a.palette.length + b.palette.length > 0 },
    { weight: 0.3, value: 1 - jaccard(a.ids, b.ids), signal: a.ids.length + b.ids.length > 0 },
    { weight: 0.25, value: 1 - jaccard(a.words, b.words), signal: a.words.length + b.words.length > 0 },
  ];
  const counted = parts.filter(part => part.signal), weight = counted.reduce((sum, part) => sum + part.weight, 0);
  const overall = weight ? counted.reduce((sum, part) => sum + part.weight * part.value, 0) / weight : 0;
  return { overall: round(overall), palette: round(parts[0].value), structure: round(parts[1].value), voice: round(parts[2].value),
    method: 'Weighted heuristic over the files that differ between the two designs: palette CIE76 colour distance (45%), the parts they name, as ids in their data or as functions, classes and constants in their code (30%), and the words of their text (25%); a part neither design has is left out and the rest reweighted.' };
}
