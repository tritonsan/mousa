// The specimen board: the Design DNA drawn on one page, so a design can be reviewed in any medium, including those a
// browser cannot open (a native app, a game, print or copy). It shows each palette with its device, each typeface from
// the font library with the DNA's own lines, the motion devices running their own keyframes and timing, the drawings
// and pictures the project holds, and the voice. It is built in its own folder, with copies of the fonts and pictures
// it needs, because the capture server serves one folder and nothing outside it.

import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeTasteName } from '../culture/taste.mjs';

const escape = value => String(value).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const cssString = value => String(value).replace(/[\\'"\n\r]/gu, '');

/** The @keyframes rules a stylesheet defines, by name, with their whole bodies. */
export function keyframesRules(css) {
  const rules = new Map();
  for (const match of String(css).matchAll(/@(?:-webkit-)?keyframes\s+(["']?)(-?[A-Za-z_][\w-]*)\1\s*\{/gu)) {
    let depth = 1, index = match.index + match[0].length;
    while (index < css.length && depth) { if (css[index] === '{') depth++; else if (css[index] === '}') depth--; index++; }
    if (!depth && !rules.has(match[2])) rules.set(match[2], css.slice(match.index, index));
  }
  return rules;
}

/** Inline <svg> drawings of the pages, by id. */
function svgDrawings(pages) {
  const found = new Map();
  for (const html of pages) for (const match of html.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg\s*>/giu)) {
    const id = /\sid\s*=\s*(["'])([^"']+)\1/iu.exec(` ${match[1]}`)?.[2];
    if (id && !found.has(id)) found.set(id, match[0].replace(/<script\b[\s\S]*?<\/script\s*>/giu, ''));
  }
  return found;
}

/**
 * Writes the board into `outDir` and returns {entry, fonts, pictures, drawings}. `dna` is the validated DNA, `library`
 * the font library, `root` the project folder (for the pictures it lists) and `files` the project's text files (for
 * its drawings and keyframes).
 */
export async function buildSpecimen({ dna, library = null, root, files = {}, outDir, title = 'Design DNA' }) {
  await fs.mkdir(path.join(outDir, 'fonts'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'pictures'), { recursive: true });
  const devices = Array.isArray(dna?.devices) ? dna.devices : [];
  const tokensOf = layer => devices.filter(device => device.layer === layer);

  // Typefaces: every family the DNA names, loaded from the library's own files.
  const families = [...new Set(devices.flatMap(device => device.tokens?.fonts || []))];
  const faces = [], loaded = [];
  for (const name of families) {
    const family = library?.families?.find(item => normalizeTasteName(item.family) === normalizeTasteName(name));
    if (!family) continue;
    loaded.push(family.family);
    for (const face of family.faces || []) {
      if (!face.file) continue;
      const file = path.basename(face.file);
      await fs.copyFile(face.file, path.join(outDir, 'fonts', file)).catch(() => {});
      faces.push(`@font-face{font-family:'${cssString(family.family)}';src:url('fonts/${cssString(file)}') format('woff2');font-weight:${cssString(face.weight || '400')};font-style:${cssString(face.style || 'normal')};font-display:block}`);
    }
  }

  // Pictures the DNA lists, copied from the project when they exist there.
  const pictures = [];
  for (const image of [...new Set(devices.flatMap(device => device.tokens?.images || []))]) {
    const source = path.join(root, ...image.split('/'));
    const name = image.replaceAll('/', '-');
    if (await fs.copyFile(source, path.join(outDir, 'pictures', name)).then(() => true, () => false)) pictures.push({ path: image, file: `pictures/${name}` });
  }

  const pages = Object.entries(files).filter(([name]) => /\.html?$/iu.test(name)).map(([, text]) => text);
  const css = [...Object.entries(files).filter(([name]) => /\.css$/iu.test(name)).map(([, text]) => text), ...pages.flatMap(html => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)].map(match => match[1]))].join('\n');
  const keyframes = keyframesRules(css), drawings = svgDrawings(pages);
  const copy = devices.flatMap(device => device.tokens?.copy || []);
  const sample = copy[0] || dna?.thesis || 'The quick brown fox jumps over the lazy dog';

  const palette = tokensOf('palette').map(device => `<figure class="row"><figcaption><b>${escape(device.id)}</b> ${escape(device.device)}</figcaption><div class="swatches">${
    (device.tokens.colors || []).map(color => `<div class="swatch"><span style="background:${cssString(color)}"></span><code>${escape(color)}</code></div>`).join('')}</div></figure>`).join('');
  const type = [...tokensOf('typography'), ...devices.filter(device => device.layer !== 'typography' && (device.tokens?.fonts || []).length)].map(device => (device.tokens.fonts || []).map(font =>
    `<figure class="type"><figcaption><b>${escape(device.id)}</b> ${escape(font)}${loaded.some(name => normalizeTasteName(name) === normalizeTasteName(font)) ? '' : ' <em>(not in the font library)</em>'}</figcaption>
<p class="display" style="font-family:'${cssString(font)}',serif">${escape(sample)}</p><p class="body" style="font-family:'${cssString(font)}',serif">${escape(copy[1] || dna?.thesis || sample)}</p></figure>`).join('')).join('');
  const motion = tokensOf('motion').map(device => {
    const names = device.tokens.keyframes || [];
    const timing = (device.tokens.css || []).find(rule => rule.property === 'animation')?.value;
    const style = names.length ? `animation:${cssString(timing && names.some(name => timing.includes(name)) ? timing : `${names[0]} 6s ease-in-out infinite alternate`)}` : '';
    return `<figure class="row"><figcaption><b>${escape(device.id)}</b> ${escape(device.device)}</figcaption><div class="motion"><div class="mover" style="${style}"></div><code>${escape([...names, ...(device.tokens.css || []).map(rule => `${rule.property}: ${rule.value}`)].join(' · ') || 'no motion tokens')}</code></div></figure>`;
  }).join('');
  const shown = [...new Set(devices.flatMap(device => device.tokens?.svg || []))].filter(id => drawings.has(id));
  const imagery = [...shown.map(id => `<figure class="art"><div class="drawing">${drawings.get(id)}</div><figcaption>${escape(id)}</figcaption></figure>`),
    ...pictures.map(picture => `<figure class="art"><img src="${escape(picture.file)}" alt=""><figcaption>${escape(picture.path)}</figcaption></figure>`)].join('');
  const voice = tokensOf('voice').map(device => `<figure class="row"><figcaption><b>${escape(device.id)}</b> ${escape(device.device)}</figcaption>${(device.tokens.copy || []).map(line => `<blockquote>${escape(line)}</blockquote>`).join('')}</figure>`).join('');
  const structure = devices.filter(device => ['layout', 'structure', 'interaction'].includes(device.layer)).map(device =>
    `<li><b>${escape(device.id)}</b> ${escape(device.device)}${(device.tokens.ids || []).length ? ` <code>${escape(device.tokens.ids.map(id => `#${id}`).join(' '))}</code>` : ''}</li>`).join('');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>
${faces.join('\n')}
${[...new Set(devices.flatMap(device => device.tokens?.keyframes || []))].map(name => keyframes.get(name) || '').join('\n')}
body{margin:0;background:#f6f5f2;color:#1b1b1f;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1320px;margin:0 auto;padding:40px 48px}
header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #d9d6cf;padding-bottom:16px;margin-bottom:28px}
h1{font-size:22px;margin:0}h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6a6672;margin:32px 0 12px}
.thesis{color:#4a4752;max-width:780px}
figure{margin:0 0 18px}figcaption{font-size:13px;color:#4a4752;margin-bottom:8px}
.swatches{display:flex;flex-wrap:wrap;gap:10px}.swatch{width:120px}.swatch span{display:block;height:72px;border-radius:8px;border:1px solid rgba(0,0,0,.08)}.swatch code{font-size:12px}
.type .display{font-size:44px;line-height:1.1;margin:0 0 8px}.type .body{font-size:18px;max-width:760px;margin:0}
.motion{display:flex;align-items:center;gap:16px}.mover{width:64px;height:64px;border-radius:50%;background:#1b1b1f}
.art{display:inline-block;vertical-align:top;margin-right:18px;max-width:420px}.art img,.drawing svg{max-width:420px;max-height:320px;height:auto}
blockquote{font-size:20px;margin:0 0 8px;padding-left:14px;border-left:3px solid #1b1b1f}
ul{padding-left:18px}code{font:12px ui-monospace,Consolas,monospace;color:#3d3a44}
</style></head><body><main>
<header><h1>${escape(title)}</h1><span>${devices.length} devices</span></header>
${dna?.thesis ? `<p class="thesis">${escape(dna.thesis)}</p>` : ''}
${palette ? `<h2>Palette</h2>${palette}` : ''}
${type ? `<h2>Typography</h2>${type}` : ''}
${voice ? `<h2>Voice</h2>${voice}` : ''}
${motion ? `<h2>Motion</h2>${motion}` : ''}
${imagery ? `<h2>Imagery</h2>${imagery}` : ''}
${structure ? `<h2>Structure</h2><ul>${structure}</ul>` : ''}
</main></body></html>`;
  await fs.writeFile(path.join(outDir, 'index.html'), html);
  return { entry: 'index.html', fonts: loaded, pictures: pictures.map(picture => picture.path), drawings: shown };
}
