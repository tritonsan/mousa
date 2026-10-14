// The connection page: a one-time form on this computer where the person enters their Qloo API key, so the key never
// passes through the chat or the model. It listens on 127.0.0.1 only, at a path with a random token, accepts a request
// only for its own host and origin (no DNS rebinding, no cross-site form), tests the key with one Qloo request, saves it
// in the person's connections file and closes after a save or after ten minutes.

import http from 'node:http';
import crypto from 'node:crypto';
import { QLOO_ENDPOINTS, DEFAULT_QLOO_BASE_URL, testQlooKey } from './config.mjs';

export const CONNECT_PAGE_LIMITS = Object.freeze({ ttlMs: 10 * 60 * 1000, bodyBytes: 8192, keyMin: 8, keyMax: 200 });
const HEADERS = Object.freeze({
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  // Not no-referrer: under that policy a browser sends "Origin: null" with the form, which the origin check refuses.
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
});

const escape = value => String(value).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function page({ title, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>
:root{color-scheme:light dark;--ink:#1d1b2e;--muted:#5d5a72;--line:#d9d6e8;--paper:#faf9fd;--accent:#5b3fd6;--bad:#b3261e;--good:#1e7a4c}
@media (prefers-color-scheme:dark){:root{--ink:#ecebf5;--muted:#aeabc4;--line:#3a3752;--paper:#16151f;--accent:#a996ff;--bad:#ff8a80;--good:#7ad3a2}}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:560px;margin:0 auto;padding:48px 20px}
h1{font-size:1.6rem;margin:0 0 12px}p{margin:0 0 14px;color:var(--muted)}
label{display:block;font-weight:600;margin:18px 0 6px}
input,select{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--ink);font:inherit}
button{margin-top:22px;padding:11px 18px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.note{font-size:.9rem}.error{color:var(--bad);font-weight:600}.ok{color:var(--good);font-weight:600}
a{color:var(--accent)}
</style></head><body><main>${body}</main></body></html>`;
}

function formPage({ action, error = '', endpoint = 'hackathon' }) {
  const options = QLOO_ENDPOINTS.map(item => `<option value="${escape(item.id)}"${item.id === endpoint ? ' selected' : ''}>${escape(item.label)} (${escape(item.url.replace('https://', ''))})</option>`).join('');
  return page({ title: 'Connect Moûsa to Qloo', body: `<h1>Connect Moûsa to Qloo</h1>
<p>Moûsa asks Qloo what an audience loves before it designs. Paste your Qloo API key here. It is tested with one Qloo request and saved on this computer for your user only, encrypted on Windows. It never passes through the chat.</p>
${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
<form method="post" action="${escape(action)}" autocomplete="off">
<label for="apiKey">Qloo API key</label>
<input id="apiKey" name="apiKey" type="password" required minlength="${CONNECT_PAGE_LIMITS.keyMin}" maxlength="${CONNECT_PAGE_LIMITS.keyMax}" autocomplete="off" spellcheck="false">
<label for="endpoint">Qloo API</label>
<select id="endpoint" name="endpoint">${options}</select>
<button type="submit">Test and save</button>
</form>
<p class="note">No key yet? See the <a href="https://docs.qloo.com/" rel="noreferrer">Qloo developer documentation</a>.</p>` });
}

function savedPage({ label, protection }) {
  return page({ title: 'Moûsa is connected', body: `<h1>Moûsa is connected</h1>
<p class="ok" role="status">Qloo accepted the key for the ${escape(label)}.</p>
<p>The key is saved for your user on this computer${protection === 'dpapi' ? ', encrypted with Windows data protection' : ''}. You can close this tab and go back to your agent.</p>` });
}

/** The connection page server. One is open at a time per process; opening again returns the same link while it lives. */
export function createConnectionPage({ store, testKey = testQlooKey, ttlMs = CONNECT_PAGE_LIMITS.ttlMs, fetchImpl } = {}) {
  let current = null;

  async function open() {
    if (current && !current.closed) return current.info;
    const token = crypto.randomBytes(24).toString('base64url');
    const route = `/connect/${token}`;
    let settle;
    const done = new Promise(resolve => { settle = resolve; });
    const state = { closed: false, info: null };

    const server = http.createServer((request, response) => {
      const send = (status, html, extra = {}) => { response.writeHead(status, { ...HEADERS, ...extra }); response.end(html); };
      const expected = `127.0.0.1:${server.address().port}`;
      // Only this page's own host: a rebound host name or a cross-site form is refused.
      if (request.headers.host !== expected) return send(403, page({ title: 'Not allowed', body: '<h1>Not allowed</h1>' }));
      const url = new URL(request.url, `http://${expected}`);
      if (url.pathname !== route) return send(404, page({ title: 'Not found', body: '<h1>Not found</h1><p>This link has expired or is not valid. Ask your agent for a new one.</p>' }));
      if (request.method === 'GET' || request.method === 'HEAD') return send(200, request.method === 'HEAD' ? '' : formPage({ action: route }));
      if (request.method !== 'POST') return send(405, page({ title: 'Not allowed', body: '<h1>Not allowed</h1>' }), { Allow: 'GET, POST' });
      const origin = request.headers.origin;
      if (origin && origin !== `http://${expected}`) return send(403, page({ title: 'Not allowed', body: '<h1>Not allowed</h1>' }));
      if (!/^application\/x-www-form-urlencoded\b/iu.test(request.headers['content-type'] || '')) return send(415, formPage({ action: route, error: 'Send the form from this page.' }));
      let body = '', tooLarge = false;
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; if (body.length > CONNECT_PAGE_LIMITS.bodyBytes) { tooLarge = true; request.destroy(); } });
      request.on('end', async () => {
        if (tooLarge) return;
        const fields = new URLSearchParams(body);
        const apiKey = (fields.get('apiKey') || '').trim();
        const endpoint = QLOO_ENDPOINTS.find(item => item.id === fields.get('endpoint')) || QLOO_ENDPOINTS.find(item => item.url === DEFAULT_QLOO_BASE_URL);
        if (apiKey.length < CONNECT_PAGE_LIMITS.keyMin || apiKey.length > CONNECT_PAGE_LIMITS.keyMax || /[\s\u0000-\u001f\u007f]/u.test(apiKey)) {
          return send(400, formPage({ action: route, endpoint: endpoint.id, error: `Enter the key as Qloo gave it: ${CONNECT_PAGE_LIMITS.keyMin} to ${CONNECT_PAGE_LIMITS.keyMax} characters, without spaces.` }));
        }
        const result = await testKey({ apiKey, baseUrl: endpoint.url, ...(fetchImpl ? { fetchImpl } : {}) });
        if (!result.ok) return send(400, formPage({ action: route, endpoint: endpoint.id, error: `${result.message} The key was not saved.` }));
        let saved;
        try { saved = await store.saveQloo({ apiKey, baseUrl: endpoint.url }); }
        catch { return send(500, formPage({ action: route, endpoint: endpoint.id, error: 'The key works, but it could not be saved on this computer.' })); }
        send(200, savedPage({ label: endpoint.label, protection: saved.protection }), { Connection: 'close' });
        settle({ saved: true, endpoint: endpoint.id, savedAt: saved.savedAt });
        setImmediate(close);
      });
    });

    function close() {
      if (state.closed) return;
      state.closed = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
      settle({ saved: false });
    }

    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const timer = setTimeout(close, ttlMs);
    timer.unref?.();
    server.unref();
    const { port } = server.address();
    state.info = { url: `http://127.0.0.1:${port}${route}`, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
    state.done = done;
    state.close = close;
    current = state;
    return state.info;
  }

  return {
    open,
    /** Resolves when the open page saves a key ({saved:true}) or closes without one ({saved:false}). */
    get done() { return current?.done ?? Promise.resolve({ saved: false }); },
    close() { current?.close?.(); },
    get isOpen() { return Boolean(current && !current.closed); },
  };
}
