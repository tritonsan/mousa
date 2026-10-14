#!/usr/bin/env node
// Checks a running Studio's public site the way a juror meets it: the landing page, the gallery, every session page and
// every arm of a comparison, each fetched for its status, its policy and the absence of any script, then captured whole
// at 1440 and 390 pixels wide by a headless browser; each design's first playable page is captured from the preview
// origin. It reads only what the site serves and makes no request elsewhere.
//
//   node scripts/verify-site.mjs [--app http://127.0.0.1:8787] [--out output/site-check] [--no-picture]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectBrowser, verifyBrowser, captureShots } from '../plugin/server/production/capture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_VIEWS = Object.freeze([{ id: 'desktop', width: 1440, height: 900 }, { id: 'phone', width: 390, height: 844 }]);

/** The pages of the site to check, from its own gallery index: the landing page, the gallery, each entry and each arm. */
export async function sitePages(app, fetchImpl = fetch) {
  const index = await fetchImpl(`${app}/api/gallery`).then(response => response.ok ? response.json() : null);
  if (!index?.entries) throw new Error(`${app} serves no gallery.`);
  const pages = [{ id: 'landing', path: '/' }, { id: 'gallery', path: '/gallery/' }];
  for (const entry of index.entries) {
    pages.push({ id: entry.id, path: `/gallery/${entry.id}/` });
    if (entry.kind === 'comparison') for (const arm of ['with-qloo', 'without-qloo']) pages.push({ id: `${entry.id}-${arm}`, path: `/gallery/${entry.id}/arms/${arm}/` });
  }
  return pages;
}

/** One page's status, policy and markup: what a script-free public page must hold. */
export async function checkPage(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  const html = await response.text();
  const policy = response.headers.get('content-security-policy') || '';
  const problems = [];
  if (response.status !== 200) problems.push(`status ${response.status}`);
  if (/<script\b/iu.test(html)) problems.push('a script tag');
  if (!/default-src 'none'/u.test(policy) || /script-src/u.test(policy)) problems.push('a policy that allows scripts');
  if (/\b[A-Za-z]:[\\/](?:Users|mousa-live)|mousa-live/iu.test(html)) problems.push('a local path');
  return { url, status: response.status, bytes: html.length, problems, frames: [...html.matchAll(/<iframe\b[^>]*\bsrc="([^"]+)"/gu)].map(match => match[1].replaceAll('&amp;', '&')) };
}

async function main() {
  const option = (name, fallback) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : fallback; };
  const app = option('--app', 'http://127.0.0.1:8787').replace(/\/$/u, '');
  const out = path.resolve(repo, option('--out', 'output/site-check'));
  const pages = await sitePages(app);
  const checked = [];
  for (const page of pages) checked.push({ ...page, ...await checkPage(`${app}${page.path}`) });
  for (const page of checked) console.log(`${page.problems.length ? 'FAIL' : 'ok  '} ${page.path} (${page.bytes} bytes)${page.problems.length ? `: ${page.problems.join(', ')}` : ''}`);
  if (process.argv.includes('--no-picture')) { if (checked.some(page => page.problems.length)) process.exitCode = 1; return; }
  const browser = await verifyBrowser(await inspectBrowser());
  if (!browser.available) throw new Error(`No pictures: ${browser.reason}`);
  await fs.mkdir(out, { recursive: true });
  const shots = checked.flatMap(page => SITE_VIEWS.map(view => ({ url: `${app}${page.path}`, width: view.width, height: view.height, full: true, maxHeight: 16000, out: path.join(out, `${page.id}-${view.id}.png`) })));
  // Each design's first playable page, from the preview origin, at the size its frame shows it.
  const plays = [...new Set(checked.flatMap(page => page.frames.slice(0, 1)))].map((url, index) => ({ url, width: 1440, height: 810, out: path.join(out, `play-${String(index + 1).padStart(2, '0')}.png`) }));
  const results = [];
  for (let start = 0; start < shots.length + plays.length; start += 6) {
    const batch = [...shots, ...plays].slice(start, start + 6);
    results.push(...await captureShots({ browser, shots: batch, timeoutMs: 180000 }));
  }
  for (const result of results) console.log(`${path.relative(repo, result.file)} ${result.width}×${result.height}`);
  if (checked.some(page => page.problems.length)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
