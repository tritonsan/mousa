// The game host's side of the production stages: the game character medium of the universal protocol (its DNA
// layers, the methods a production plan may choose for each and the views a review captures), the capability list
// both arms of a pair receive, the capture of a saved character in the game's own pages, and the audit of which
// captures the designing model opened with its own read tool.

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { registerMedium } from '../../plugin/server/production/media.mjs';
import { normalizeCapabilities, methodSummary, PRODUCTION_SCHEMA_VERSION, CAPTURE_LIMITS, HOSTED_IMAGE_REASON } from '../../plugin/server/production/capabilities.mjs';
import { captureShots } from '../../plugin/server/production/capture.mjs';
import { openedCaptures } from '../../src/kiro-session-audit.mjs';
import { encodePng } from './cutout.mjs';
import { CHARACTER_LAYERS, FROZEN_FIGURE, REPAIRABLE_AFTER_PAINTING } from './protocol.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(here, '..');
const rootDir = path.resolve(gameDir, '..');

export const GAME_MEDIUM_ID = 'game-character';
export const CAPABILITIES_FILE = 'capabilities.json';
// Captures land in the arm's Kiro workspace, the only folder its read tool may open.
export const REVIEW_DIR = 'review';
export const CAPTURE_CHARACTER = 'runs/capture/character.json';

const has = value => (Array.isArray(value) ? value.length > 0 : Boolean(value));
/** What a method needs among a device's tokens, so the build can be checked; null when the device has it. */
const NEEDS = {
  drawn: tokens => [tokens.colors, tokens.parts, tokens.proportions, tokens.light, tokens.effects].some(has) ? null : 'the colours, part or cloth IDs, proportions, effects or light it draws',
  moves: tokens => has(tokens.motion) || has(tokens.clips) ? null : 'its motion parameters in tokens.motion or its clips in tokens.clips',
  lines: tokens => has(tokens.lines) ? null : 'the lines you wrote in tokens.lines',
  moment: tokens => [tokens.scene, tokens.render, tokens.light].some(has) ? null : 'the scene, render preset or light it sets',
  track: tokens => has(tokens.music) ? null : 'the track ID in tokens.music',
};

export const GAME_METHODS = Object.freeze([
  { id: 'vector-rig', layers: ['palette', 'silhouette', 'costume', 'signature', 'light', 'imagery'], kind: 'code', needs: NEEDS.drawn,
    description: 'Draw the device in character.json as vector parts and cloth chains on the rig\'s bones: fills and layered shading, proportions, garments, props, effects and the lantern.' },
  { id: 'painted-rig', layers: ['palette', 'silhouette', 'costume', 'imagery'], kind: 'generator', generator: 'paint',
    description: 'Have the host paint the checked drawing as finished game art in the render preset\'s technique, from your style sentence and piece descriptions; the painted pieces move on the same bones. One painting paints the whole figure, so plan it on the one device whose look leads the paint, with a count of 1, or 2 to allow a second painting that repairs the first.' },
  { id: 'portrait', layers: ['imagery'], kind: 'generator', generator: 'portrait',
    description: 'Request a painted portrait of the character before you draw it; the host writes the prompt from the device\'s name, colours and qualities, and the check looks for the portrait\'s main colours in the figure.' },
  { id: 'rig-motion', layers: ['motion', 'signature'], kind: 'code', needs: NEEDS.moves,
    description: 'Set the motion parameters and clips in character.json: cadence, bounce, lean, arm swing, the turn, and the timing and tracks of the signature move.' },
  { id: 'lines', layers: ['voice'], kind: 'code', needs: NEEDS.lines,
    description: 'Write the four lines in character.json in the device\'s register, around the scene\'s fixed facts.' },
  { id: 'engine-scene', layers: ['scene', 'render', 'light'], kind: 'code', needs: NEEDS.moment,
    description: 'Set the moment in character.json for the engine to draw: the sky, cloud sea, basalt, foliage and flags, the weather, mist and beacons, the render preset of the whole frame, and the light the character carries.' },
  { id: 'library-track', layers: ['music'], kind: 'material', material: 'tracks', needs: NEEDS.track,
    description: 'Pick the moment\'s track from the open music library in music.json, by its ID.' },
]);

/** What each review view shows, drawn by the game's own code in game/capture.html. */
export const GAME_VIEWS = Object.freeze([
  Object.freeze({ id: 'pose', width: 960, height: 960, shows: 'the figure at rest, large, beside its 60-pixel silhouette in one dark tone and the same figure at 60 pixels in colour' }),
  Object.freeze({ id: 'walk', width: 1440, height: 480, shows: 'six evenly spaced frames of one walk cycle on one ground line, props and cloth included' }),
  Object.freeze({ id: 'scene', width: 1440, height: 810, shows: 'the moment as a player sees it: the character on the cliff road near the keeper and the beacon, under its sky and weather, in its render style' }),
  Object.freeze({ id: 'kindle', width: 1440, height: 810, shows: 'the signature move as the beacon catches, with the carried light' }),
]);
export const VIEW_IDS = Object.freeze(GAME_VIEWS.map(view => view.id));

export const GAME_MEDIUM = registerMedium({
  id: GAME_MEDIUM_ID, label: 'Game character', artifact: 'character', entry: 'capture.html',
  description: 'A playable side-view RPG character in character.json: vector parts on a rig, motion and clips, four lines, and the moment\'s scene, render style and music.',
  layers: CHARACTER_LAYERS, requiredLayers: ['palette', 'silhouette', 'motion', 'voice'], methods: GAME_METHODS,
  views: GAME_VIEWS.map(({ id, width, height }) => ({ id, width, height })),
});

/** The layers a reading must carry in a run: the DNA's required layers, the moment's with art direction and the track's with a music library. */
export const readingLayers = ({ artDirection = false, music = false } = {}) => ['palette', 'silhouette', 'motion', 'voice', ...(artDirection ? ['scene', 'render'] : []), ...(music ? ['music'] : [])];

/**
 * The capability list of one pair, identical for both arms: the music library, the portrait and paint generators
 * (Codex on this machine, or a fixture painter in a dry run), capture in the game's own pages, and the methods a study
 * requires of both arms. An unavailable generator names its reason, such as a hosted server without Codex.
 */
export function gameCapabilities({ portraits = null, paint = null, music = null, capture = false, required = [], environment = 'local', reasons = {} } = {}) {
  const off = reason => ({ available: false, reason: String(reason).slice(0, 300) });
  const licenses = music?.licenses?.length ? music.licenses.join(', ').slice(0, 160) : null;
  // A hosted server paints nothing, whatever is installed on it.
  const hosted = environment === 'hosted';
  return normalizeCapabilities({
    schemaVersion: PRODUCTION_SCHEMA_VERSION, medium: GAME_MEDIUM_ID, environment,
    materials: { tracks: music ? { available: true, count: music.tracks, catalog: 'music.json', ...(licenses ? { license: licenses } : {}) } : off(reasons.music || 'This run has no music library, so the moment has no track.') },
    generators: {
      portrait: portraits && !hosted ? { available: true, perRun: portraits.perRun, provider: 'codex' } : off(hosted ? HOSTED_IMAGE_REASON : reasons.portrait || 'This run paints no portraits.'),
      paint: paint && !(hosted && !paint.fixture) ? { available: true, perRun: paint.perRun, provider: paint.fixture ? 'fixture' : 'codex' } : off(hosted ? HOSTED_IMAGE_REASON : reasons.paint || 'This run does not paint the characters.'),
    },
    review: { capture: capture ? { available: true, views: GAME_VIEWS.map(({ id, width, height }) => ({ id, width, height })), rounds: CAPTURE_LIMITS.rounds, perRound: GAME_VIEWS.length }
      : off(reasons.capture || 'No browser is available here to capture the character.') },
    required,
    notes: [
      // Every arm of the first live pairs that skipped painting did so because a painting froze the drawing before any
      // review could ask for a repair; the order below keeps round 1's repairs before the painting.
      capture
        ? 'One painting paints the whole figure: plan painted-rig on one device at most. Paint between the review rounds: round 1 judges the checked vector drawing and you repair it in character.json, then paint, and round 2 judges the painted figure.'
        : `One painting paints the whole figure: plan painted-rig on one device at most. Painting freezes the figure in character.json, ${FROZEN_FIGURE}, so paint after the last repair to the figure; a second painting, when the step's count is 2, replaces the first.`,
      ...(capture ? [`Painting freezes the figure in character.json, ${FROZEN_FIGURE}: a defect round 2 finds in the painting is repaired by a second painting, when the step's count is 2, while its ${REPAIRABLE_AFTER_PAINTING} can still be repaired.`] : []),
      ...(capture ? GAME_VIEWS.map(view => `The ${view.id} view (${view.width}x${view.height}) shows ${view.shows}.`) : []),
    ],
  }, { medium: GAME_MEDIUM_ID });
}

// The prompt lists the methods of the capability list as every host does.
export { methodSummary };

const GAME_STATIC = /^(?:capture\.html|styles\.css|src\/[a-z-]{1,40}\.js|world\/canon\.json|characters\/maren\.json)$/u;
const TYPES = Object.freeze({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.woff2': 'font/woff2' });

/**
 * A read-only loopback server for one arm's captures: the game's capture page with its code, world and keeper, the
 * bundled fonts, the arm's saved character as runs/capture/character.json (with the host's painted skin when the
 * drawing was painted) and that skin's pieces under the names the skin gives them. Nothing else is reachable.
 */
export async function serveArmCapture({ dir, game = gameDir, fonts = path.join(rootDir, 'library', 'fonts') }) {
  const character = JSON.parse(await fs.readFile(path.join(dir, 'files', 'character.json'), 'utf8'));
  const painted = await fs.readFile(path.join(dir, 'host', 'skin.json'), 'utf8').then(JSON.parse, () => null);
  const pieces = new Map();
  if (painted?.skin && /^skin\/paint-\d$/u.test(painted.folder || '')) {
    const files = new Set((painted.files || []).map(item => item.id));
    for (const item of [...(painted.skin.images || []), ...(painted.skin.cloth || []), ...(painted.skin.tips || [])]) {
      const id = /-skin-([a-z0-9-]{1,60})\.png$/u.exec(item.src || '')?.[1];
      if (id && files.has(id)) pieces.set(item.src, path.join(dir, ...painted.folder.split('/'), `${id}.png`));
    }
    character.skin = painted.skin;
  }
  const body = Buffer.from(JSON.stringify(character));
  const server = http.createServer(async (request, response) => {
    const missing = () => { if (!response.headersSent) response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found'); };
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (!pathname.startsWith('/game/')) return missing();
      const name = decodeURIComponent(pathname.slice('/game/'.length));
      let bytes = null;
      if (name === CAPTURE_CHARACTER) bytes = body;
      else if (pieces.has(name)) bytes = await fs.readFile(pieces.get(name));
      else if (GAME_STATIC.test(name)) bytes = await fs.readFile(path.join(game, ...name.split('/')));
      else if (/^fonts\/[a-z0-9][a-z0-9-]{0,80}\.woff2$/u.test(name)) bytes = await fs.readFile(path.join(fonts, name.slice('fonts/'.length)));
      else return missing();
      response.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { missing(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

// The capture page sets window.captureReady once it has drawn its view; until the module runs, the expression waits.
const READY = "new Promise(done => { const wait = () => window.captureReady ? window.captureReady.then(() => done(true), error => done('error: ' + (error && error.message || error))) : setTimeout(wait, 25); wait(); })";

/**
 * Capture views of an arm's saved character in a headless browser that can reach only the arm's capture server.
 * Each view is r<round>-<view>.png in `outDir`.
 */
export async function captureCharacter({ dir, browser, views, round, outDir, env = process.env, spawnImpl, timeoutMs, settleMs }) {
  const server = await serveArmCapture({ dir });
  try {
    const shots = views.map(view => ({ url: `${server.url}/game/capture.html?view=${view.id}&character=${encodeURIComponent(CAPTURE_CHARACTER)}`, width: view.width, height: view.height,
      out: path.join(outDir, `r${round}-${view.id}.png`), ready: READY }));
    const results = await captureShots({ browser, shots, env, spawnImpl, timeoutMs, settleMs });
    return views.map((view, index) => ({ id: `r${round}-${view.id}`, view: view.id, width: results[index].width, height: results[index].height, bytes: results[index].bytes, file: results[index].file }));
  } finally { await server.close(); }
}

/** The tests' and the scripted dry run's stand-in: a flat dusk PNG at each view's size, with no browser. */
export async function fixtureCapture({ views, round, outDir }) {
  await fs.mkdir(outDir, { recursive: true });
  const shots = [];
  for (const view of views) {
    const png = encodePng(view.width, view.height, Buffer.alloc(view.width * view.height * 4, Buffer.from([22, 29, 45, 255])));
    const file = path.join(outDir, `r${round}-${view.id}.png`);
    await fs.writeFile(file, png);
    shots.push({ id: `r${round}-${view.id}`, view: view.id, width: view.width, height: view.height, bytes: png.length, file });
  }
  return shots;
}

// The audit of the captures an arm's Kiro session opened is the Studio's own, read from the arm's Kiro home.
export { openedCaptures };
