import { isIP } from 'node:net';

const MAX_SOURCES = 20;
const MAX_EXCERPT = 4000;
const CAPTURE_METADATA = '__studioCapture';

/** Select one contiguous literal window, never a rewritten article summary. */
export function selectNativeWebText(value, maximum = MAX_EXCERPT) {
  let start = 0;
  // This only recognizes page chrome; it does not score cultural relevance.
  // Unrecognized formats retain their literal prefix rather than guessing.
  const scan = value.slice(0, 1_000_000);
  const chrome = /^(?:\[Jump to content\]|Main menu\s*$|Navigation\s*$|## Contents\s*$|Skip to (?:main )?content\s*$)/mu.test(scan.slice(0, 16000));
  if (chrome) {
    let from = 0;
    for (const boundary of [...scan.matchAll(/\r?\n[ \t]*\r?\n/gu), { index: scan.length, 0: '' }]) {
      const paragraph = scan.slice(from, boundary.index);
      const prose = paragraph.trim();
      // Exclude lists, link definitions, infoboxes and repeated table rules.
      // Recognition may remove Markdown syntax; returned text is unchanged.
      const plain = prose.replace(/\[([^\]]+)\]\[[^\]]*\]/gu, '$1');
      if (prose.length >= 120 && prose.length <= 12000 && !/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\[[^\]]+\]:|\|)/mu.test(prose)
        && !/[─━│┃┌┐└┘┬┴┼]{2,}|\|.*\|/u.test(prose)
        && (plain.match(/[\p{L}\p{N}]{2,}/gu) || []).length >= 18
        && /[\p{L}\p{N}][.!?](?:\s|$)/u.test(plain)) {
        start = from + paragraph.length - paragraph.trimStart().length;
        break;
      }
      from = boundary.index + boundary[0].length;
    }
  }
  let end = Math.min(value.length, start + Math.max(0, maximum));
  // Avoid creating an isolated surrogate when a literal window is bounded.
  if (end < value.length && /[\uD800-\uDBFF]/u.test(value[end - 1] || '')) end--;
  return { text: value.slice(start, end), start, end, originalLength: value.length,
    method: start ? 'literal-body-window' : 'literal-prefix', truncated: start > 0 || end < value.length };
}

export function normalizeNativeWebToolName(value) {
  if (typeof value !== 'string') return null;
  const name = value.replace(/^(?:@builtin[/.]|builtin::)/u, '');
  return ({ web_search: 'web_search', webSearch: 'web_search', WebSearch: 'web_search', web_fetch: 'web_fetch', webFetch: 'web_fetch', WebFetch: 'web_fetch' })[name] || null;
}

/** Validate source identities and native fetch inputs; this does not resolve DNS. */
export function validatePublicResearchUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2000) throw new Error('A public research URL is required.');
  let url;
  try { url = new URL(value); } catch { throw new Error('A public research URL is required.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Research URLs must use HTTP(S) without credentials.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (!host.includes('.') && !isIP(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/u.test(host)) throw new Error('Research URLs must address a public host.');
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b)) throw new Error('Private and special-use research addresses are not allowed.');
  } else if (isIP(host) === 6) {
    // Literal IPv6 fetches are unnecessary for reference research. Rejecting
    // them also covers mapped private IPv4 and alternate loopback spellings.
    throw new Error('Research URLs must use a public hostname or public IPv4 address.');
  }
  if ([...url.searchParams.keys()].some(key => /(?:^|[_-])(?:token|key|secret|password|signature|credential|authorization|auth|code)(?:$|[_-])/iu.test(key) || /^(?:apikey|accesskey)$/iu.test(key))) throw new Error('Research URLs must not contain credential or capability parameters.');
  url.hash = '';
  return url.href;
}

function safeUrl(value) { try { return validatePublicResearchUrl(value); } catch { return null; } }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function failed(value, status) {
  return ['failed', 'error', 'cancelled', 'unavailable'].includes(status) || value?.success === false || value?.isError === true || value?.error != null || value?.Error != null || value?.Failure != null || value?.Failed != null || ['failed', 'error'].includes(value?.status);
}
function unpack(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) { try { return JSON.parse(trimmed); } catch { /* Literal tool prose remains literal. */ } }
  return value;
}

/** Parse only actual native tool responses. Assistant-authored citations never enter here. */
export function extractNativeWebSources({ toolName, input = {}, response, status } = {}) {
  if (!['web_search', 'web_fetch'].includes(toolName)) return [];
  const root = unpack(response);
  if (root == null || failed(root, status)) return [];
  const capture = root?.[CAPTURE_METADATA];
  const selections = capture?.version === 1 && Array.isArray(capture.selections) ? capture.selections : [];
  const captureWasBounded = selections.length > 0;
  const sources = [], seen = new Set();
  const add = (rawUrl, title, excerpt, limitation = '') => {
    const url = safeUrl(rawUrl);
    const literal = text(excerpt);
    if (!url || !literal || seen.has(url) || sources.length >= MAX_SOURCES) return;
    seen.add(url);
    const selected = toolName === 'web_fetch' ? selectNativeWebText(literal) : { text: literal.slice(0, MAX_EXCERPT), truncated: literal.length > MAX_EXCERPT };
    const notes = [limitation];
    if (selected.method === 'literal-body-window' || selections.some(item => item.method === 'literal-body-window')) notes.push('A contiguous literal body window was selected heuristically after navigation or decorative blocks; omitted text may contain relevant details. This is not a summary or a completeness check.');
    if (captureWasBounded) notes.push('The host bounded native response text before source extraction; the original runtime transcript was not modified.');
    if (selected.truncated && selected.method !== 'literal-body-window') notes.push(`The literal excerpt is limited to ${MAX_EXCERPT} characters.`);
    sources.push({ url, title: text(title).slice(0, 300) || url,
      sourceType: 'other', tool: toolName, status: 'ok',
      entityIds: [], qlooEvidenceIds: [], excerpt: selected.text,
      ...(selected.truncated || captureWasBounded ? { truncated: true } : {}),
      ...(notes.filter(Boolean).length ? { limitation: notes.filter(Boolean).join(' ') } : {}) });
  };
  const responseTexts = [];
  let fetchedUrl = input.url, fetchedTitle = '';
  let nodes = 0;
  const walk = (raw, depth = 0) => {
    if (depth > 8 || ++nodes > 500) return;
    const value = unpack(raw);
    if (typeof value === 'string') {
      if (/^(?:error|failed|unable|could not|access denied|forbidden)\b/iu.test(value.trim())) return;
      responseTexts.push(value);
      // Unstructured search output still has literal source URLs. Preserve a
      // bounded nearby excerpt, rather than guessing a source's full content.
      const matches = toolName === 'web_search' ? [...value.matchAll(/https?:\/\/[^\s<>"\]]+/giu)].slice(0, MAX_SOURCES) : [];
      for (const match of matches) {
        const rawUrl = match[0].replace(/[),.;]+$/u, '');
        const start = Math.max(0, (match.index || 0) - 200);
        const end = Math.min(value.length, (match.index || 0) + rawUrl.length + 1200);
        add(rawUrl, '', value.slice(start, end), 'Captured a literal excerpt from unstructured tool output; attribution context may be incomplete.');
      }
      return;
    }
    if (Array.isArray(value)) { for (const item of value.slice(0, 40)) walk(item, depth + 1); return; }
    if (!value || typeof value !== 'object' || failed(value)) return;
    const rawUrl = value.url || value.link || value.href || value.source_url || value.sourceUrl;
    const title = value.title || value.name;
    const excerpt = value.snippet || value.description || value.excerpt || value.content || value.text || value.body;
    if (toolName === 'web_search' && typeof rawUrl === 'string' && typeof excerpt === 'string') add(rawUrl, title, excerpt);
    if (toolName === 'web_fetch' && depth <= 1) {
      if (typeof rawUrl === 'string' && safeUrl(rawUrl)) fetchedUrl = rawUrl;
      if (typeof title === 'string') fetchedTitle = title;
    }
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      if (key === CAPTURE_METADATA) continue;
      if (typeof rawUrl === 'string' && ['url', 'link', 'href', 'source_url', 'sourceUrl', 'title', 'name'].includes(key)) continue;
      walk(item, depth + 1);
    }
  };
  walk(root);
  if (toolName === 'web_fetch') {
    // The identity is the actual native fetch input, paired with returned tool
    // content, never a URL copied from an authored design artifact.
    const literal = responseTexts.map(text).filter(Boolean).join('\n');
    if (literal && !/^(?:error|failed|unable|could not|access denied|forbidden)\b/iu.test(literal)) {
      add(fetchedUrl, fetchedTitle, literal, fetchedUrl === input.url ? 'The recorded identity is the actual requested URL; a separate final redirect URL was not returned.' : 'The recorded identity is the final URL supplied in the native fetch response.');
    }
  }
  return sources;
}

/** Bound native payloads while retaining literal body windows and selection metadata. */
export function boundNativeWebResponse(value) {
  for (const budget of [55000, 25000, 10000, 3000]) {
    let remaining = budget, nodes = 0;
    const selections = [];
    const visit = (item, depth = 0, path = '') => {
      if (depth > 8 || remaining <= 0 || ++nodes > 500) return null;
      if (typeof item === 'string') {
        const selected = selectNativeWebText(item, Math.min(16000, remaining));
        remaining -= selected.text.length;
        if (selected.truncated && selections.length < 20) {
          const { text: _text, truncated: _truncated, ...details } = selected;
          selections.push({ path: path.slice(0, 200), ...details });
        }
        return selected.text;
      }
      if (typeof item === 'number' || typeof item === 'boolean' || item === null) return item;
      if (Array.isArray(item)) return item.slice(0, 20).map((child, index) => visit(child, depth + 1, `${path}[${index}]`));
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([key]) => key !== CAPTURE_METADATA).slice(0, 30).map(([key, child]) => [key.slice(0, 100), visit(child, depth + 1, `${path}.${key}`)]));
      return null;
    };
    let bounded = visit(value);
    if (selections.length) bounded = bounded && typeof bounded === 'object' && !Array.isArray(bounded)
      ? { ...bounded, [CAPTURE_METADATA]: { version: 1, selections } }
      : { literalResponse: bounded, [CAPTURE_METADATA]: { version: 1, selections } };
    if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 80000) return bounded;
  }
  // Fail closed on an envelope that cannot be represented within the bound;
  // serializing arbitrary structures into prose would fabricate an excerpt.
  return null;
}
