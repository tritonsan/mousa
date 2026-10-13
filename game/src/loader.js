// Loads the world canon, the keeper and character files, validating each before the engine sees it.

import { normalizeCharacter } from './format.js';

// Only character files inside this game folder can be loaded, never another origin or a parent folder.
const LOCAL_JSON = /^(?:samples|characters|runs\/[a-z0-9-]+)\/[a-z0-9-]+\.json$/u;

export function localPath(value, fallback) {
  return typeof value === 'string' && LOCAL_JSON.test(value) ? value : fallback;
}

async function json(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} could not be loaded (HTTP ${response.status}).`);
  return response.json();
}

/** The pictures of a painted skin, loaded before the engine draws; a picture that fails to load stops the page. */
async function loadSkin(character) {
  if (!character.skin) return character;
  const { images, cloth, tips } = character.skin;
  const sources = [...new Set([...images, ...cloth, ...tips].map(item => item.src))];
  const pictures = await Promise.all(sources.map(src => new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => resolve([src, picture]);
    picture.onerror = () => reject(new Error(`The painted part ${src} could not be loaded.`));
    picture.src = src;
  })));
  return { ...character, skinPictures: new Map(pictures) };
}

export async function loadScene(characterPaths) {
  const [canon, keeperRaw, ...characters] = await Promise.all([json('world/canon.json'), json('characters/maren.json'), ...characterPaths.map(json)]);
  const keeper = normalizeCharacter(keeperRaw, { npc: true });
  const normalized = characters.map((raw, index) => {
    try { return normalizeCharacter(raw, { canon }); }
    catch (error) { throw new Error(`${characterPaths[index]} is not a valid character. ${error.message}`); }
  });
  return { canon, keeper, characters: await Promise.all(normalized.map(loadSkin)) };
}

export function showLoadError(element, error, advice = 'Fix the field named above in the character file and reload the page.') {
  element.hidden = false;
  element.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = 'This moment could not start';
  const message = document.createElement('p');
  message.textContent = error.message;
  const hint = document.createElement('p');
  hint.textContent = advice;
  element.append(title, message, hint);
}
