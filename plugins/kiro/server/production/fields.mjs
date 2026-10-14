// Field checks shared by the production artifacts. Every failure names the field to fix, as the taste-led artifacts
// do, so an agent can repair a reading, a plan or a review in one more save.

import { TasteProtocolError } from '../culture/taste.mjs';

export const fail = (path, message) => { throw new TasteProtocolError(path, message); };
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const round = (value, digits = 3) => typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : undefined;

export function parsed(value, path) {
  if (typeof value !== 'string') return value;
  if (value.length > 131072) fail(path, 'The artifact exceeds 128 KiB.');
  try { return JSON.parse(value); } catch { fail(path, 'The artifact must contain valid JSON.'); }
}
export function object(value, path, fields) {
  if (!plain(value)) fail(path, 'An object is required.');
  const extra = Object.keys(value).find(key => !fields.includes(key));
  if (extra !== undefined) fail(path, `Unsupported field ${JSON.stringify(extra.slice(0, 60))}; allowed fields are ${fields.join(', ')}.`);
}
/** Plain text without markup or control characters, with its whitespace collapsed. */
export function text(value, path, { min = 1, max = 1000 } = {}) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/u.test(value)) fail(path, `Plain text of ${min}-${max} characters without angle brackets is required.`);
  const result = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (result.length < min || result.length > max) fail(path, `Text of ${min}-${max} characters is required.`);
  return result;
}
export function list(value, path, { min = 0, max }) {
  if (value === undefined && min === 0) return [];
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, min ? `An array with ${min}-${max} items is required.` : `An array with at most ${max} items is required.`);
  return value;
}
export function choice(value, options, path) {
  if (!options.includes(value)) fail(path, `Use one of: ${options.join(', ')}.`);
  return value;
}
/** A short artifact ID such as c1, r2 or dna3: letters, digits, hyphens and underscores, starting with a letter. */
export function ident(value, path, { max = 40 } = {}) {
  if (typeof value !== 'string' || !new RegExp(`^[A-Za-z][A-Za-z0-9_-]{0,${max - 1}}$`, 'u').test(value)) fail(path, 'Use a short ID of letters, digits, hyphens and underscores that starts with a letter, such as c1.');
  return value;
}
export function integer(value, path, [low, high]) {
  if (!Number.isInteger(value) || value < low || value > high) fail(path, `A whole number from ${low} to ${high} is required.`);
  return value;
}
