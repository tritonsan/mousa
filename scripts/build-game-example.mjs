// Builds examples/long-dusk from game/: the playable moment of The Long Dusk as a project the Moûsa plugins can open.
// - The engine, the world, the keeper and the pages are copied as the game has them, with three changes: the designed
//   character, characters/ilo.json, is the one both pages load; the review page also takes its view from the URL
//   fragment, so a capture can ask for #pose, #walk, #scene or #kindle; and the play page has no comparison link.
// - Ilo starts as the game's plain grey mannequin, so the design comes from the brief and the measured taste.
// - FORMAT.md is the character format guide the game's validator is written from, with art direction and the title
//   card's portrait, and without music, which this copy does not carry.
// - The two typefaces of the game's interface are copied into fonts/ with their licences.
// README.md is written by hand and left as it is.
//
//   node scripts/build-game-example.mjs [--out <folder>]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCharacter } from '../game/src/format.js';
import { measureCharacter } from '../game/harness/measure.mjs';
import { formatGuide } from '../game/harness/guide.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = path.join(root, 'game');
export const GAME_EXAMPLE_DIR = path.join(root, 'examples', 'long-dusk');
const PAGES = ['index.html', 'capture.html', 'styles.css'];
const FONTS = ['eb-garamond-latin-wght-normal.woff2', 'eb-garamond-latin-wght-italic.woff2', 'eb-garamond.OFL.txt',
  'alegreya-sans-latin-400-normal.woff2', 'alegreya-sans-latin-400-italic.woff2', 'alegreya-sans-latin-700-normal.woff2', 'alegreya-sans.OFL.txt'];
const STARTER_DESCRIPTION = 'A plain grey placeholder of Ilo, deliberately featureless, carrying a plain lantern.';
// Each change from game/, as [file, from, to]; a change that no longer matches stops the build.
const EDITS = [
  ['src/main.js', "localPath(params.get('character'), 'samples/sample-a.json')", "localPath(params.get('character'), 'characters/ilo.json')"],
  ['src/capture.js', "localPath(params.get('character'), 'samples/sample-a.json')", "localPath(params.get('character'), 'characters/ilo.json')"],
  ['src/capture.js', "const view = params.get('view') || 'pose';", "const view = params.get('view') || location.hash.slice(1) || 'pose';"],
  ['index.html', '      <a href="compare.html">Compare</a>\n', ''],
];
// The format guide speaks of the Studio's game tools; in this copy the page is the validator.
const GUIDE_EDITS = [
  [/^You write one JSON file, `character\.json`, that the game loads/mu, 'You write one JSON file, `characters/ilo.json`, that the game loads'],
  [/ `game_write_file` validates the file and names the first field that needs a fix\. `game_check_character` then measures the character, draws three text previews and checks it against your DNA\./u,
    ' The game validates the file whenever a page loads it: an invalid file stops the page and names the first field that needs a fix, and a capture of `capture.html` shows that message.'],
  [/\n## What game_check_character reports\n[\s\S]*?\n(?=## Craft\n)/u, '\n'],
  [/^- The file `mannequin\.json` is a plain, valid example of every section\. Its look is deliberately featureless: use it to read the format, not as a starting design\.$/mu,
    '- `characters/ilo.json` starts as the game\'s plain grey mannequin, a valid example of every section. Its look is deliberately featureless: read the format from it, and do not keep its shapes as the design.'],
];
const SERVER = `// Serves this game on a loopback port for a browser: its own files only, never a dot-folder such as .mousa, and
// nothing outside this folder. Stop it with Ctrl+C.
//
//   node serve.mjs [port]

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer(async (request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\\/+/u, '') || 'index.html';
  const parts = name.split('/');
  const file = path.join(here, ...parts);
  if (parts.some(part => !part || part.startsWith('.') || part === '..') || !TYPES[path.extname(name)] || !file.startsWith(here + path.sep)) { response.writeHead(404).end('Not found'); return; }
  try { const body = await fs.readFile(file); response.writeHead(200, { 'Content-Type': TYPES[path.extname(name)], 'Cache-Control': 'no-store' }).end(body); }
  catch { response.writeHead(404).end('Not found'); }
});
server.listen(Number(process.argv[2]) || 8795, '127.0.0.1', () => console.log(\`The Long Dusk: http://127.0.0.1:\${server.address().port}/index.html\`));
`;

/** The game modules the play and review pages import, followed from their entry scripts. */
async function moduleGraph() {
  const seen = new Set(), queue = ['main.js', 'capture.js'];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const text = await fs.readFile(path.join(game, 'src', name), 'utf8');
    for (const match of text.matchAll(/from '\.\/([a-z-]+\.js)'/gu)) queue.push(match[1]);
  }
  return [...seen].sort();
}

/** The files of the example, by their path in it, as text or bytes. */
export async function gameExampleFiles() {
  const files = new Map();
  for (const name of PAGES) files.set(name, await fs.readFile(path.join(game, name), 'utf8'));
  for (const name of await moduleGraph()) files.set(`src/${name}`, await fs.readFile(path.join(game, 'src', name), 'utf8'));
  for (const [name, from, to] of EDITS) {
    const text = files.get(name);
    if (!text?.includes(from)) throw new Error(`${name} no longer contains the text the example changes: ${from.trim().slice(0, 80)}`);
    files.set(name, text.replace(from, to));
  }
  const canon = JSON.parse(await fs.readFile(path.join(game, 'world', 'canon.json'), 'utf8'));
  const keeperText = await fs.readFile(path.join(game, 'characters', 'maren.json'), 'utf8');
  files.set('world/canon.json', await fs.readFile(path.join(game, 'world', 'canon.json'), 'utf8'));
  files.set('characters/maren.json', keeperText);
  const mannequin = JSON.parse(await fs.readFile(path.join(game, 'harness', 'mannequin.json'), 'utf8'));
  const starter = { ...mannequin, description: STARTER_DESCRIPTION };
  normalizeCharacter(starter, { canon });
  files.set('characters/ilo.json', `${JSON.stringify(starter, null, 2)}\n`);
  const keeper = normalizeCharacter(JSON.parse(keeperText), { npc: true });
  let guide = formatGuide({ canon, keeperHeight: measureCharacter(keeper).figureHeight, artDirection: true, music: false, portrait: true });
  for (const [pattern, to] of GUIDE_EDITS) {
    if (!pattern.test(guide)) throw new Error(`The format guide no longer contains the text the example changes: ${pattern.source.slice(0, 80)}`);
    guide = guide.replace(pattern, to);
  }
  if (/game_[a-z_]+|mannequin\.json/u.test(guide)) throw new Error('The format guide still names a Studio tool or the mannequin file.');
  files.set('FORMAT.md', guide);
  for (const name of FONTS) files.set(`fonts/${name}`, await fs.readFile(path.join(root, 'library', 'fonts', name)));
  files.set('serve.mjs', SERVER);
  return files;
}

/** Writes the example into `out`, replacing every file it builds and leaving README.md as it is. */
export async function buildGameExample(out = GAME_EXAMPLE_DIR) {
  const files = await gameExampleFiles();
  for (const folder of ['src', 'world', 'characters', 'fonts']) await fs.rm(path.join(out, folder), { recursive: true, force: true });
  for (const [name, content] of files) {
    const file = path.join(out, ...name.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  return [...files.keys()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--out');
  const out = at > 0 && process.argv[at + 1] ? path.resolve(process.argv[at + 1]) : GAME_EXAMPLE_DIR;
  const written = await buildGameExample(out);
  console.log(`${written.length} files in ${path.relative(root, out) || out}`);
}
