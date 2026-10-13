// The game design MCP server Kiro starts for one arm: newline-delimited JSON-RPC over stdio, serving only the
// session tools of the arm directory named in GAME_ARM_DIR. It has no network, Qloo or file access beyond that
// directory; portraits and painted pieces go through Codex with the host's safe flags when the arm's config allows them,
// and review captures through a headless browser that can reach only the arm's own capture server.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createCodexImageGenerator } from '../../src/image-generator.mjs';
import { createArmSession } from './session.mjs';
import { CHARACTER_TASTE_POLICY_TEXT } from './protocol.mjs';
import { fixturePainter } from './fixtures.mjs';
import { captureCharacter, fixtureCapture } from './production.mjs';

/**
 * How an arm's captures are made: in a headless browser the host found when it prepared the pair, or, in the tests and
 * scripted dry runs that ask for it, as flat fixture pictures with no browser.
 */
export function armCapture(config, env = process.env) {
  const mode = config.production?.capture;
  if (mode === 'fixture') return fixtureCapture;
  if (mode === 'browser' && typeof config.production.browser?.path === 'string') {
    const browser = { available: true, path: config.production.browser.path };
    return options => captureCharacter({ ...options, browser, env });
  }
  return null;
}

export const PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);
const MAX_MESSAGE_BYTES = 512 * 1024;
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

export async function dispatch(session, message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(null, -32600, 'Invalid JSON-RPC request.');
  if (!Object.hasOwn(message, 'id')) return null;
  const { id, method } = message;
  if (method === 'initialize') {
    const requested = message.params?.protocolVersion;
    return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'long-dusk-design', version: '1.0.0' },
      instructions: `Tools for designing one character of The Long Dusk under the taste-led character policy. Files are scoped to this session.\n${session.policy || CHARACTER_TASTE_POLICY_TEXT}` } };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: session.definitions } };
  if (method === 'tools/call') {
    if (typeof message.params?.name !== 'string') return rpcError(id, -32602, 'A tool name is required.');
    try { return { jsonrpc: '2.0', id, result: await session.handle(message.params.name, message.params.arguments ?? {}) }; }
    catch { return rpcError(id, -32603, 'The tool could not complete.'); }
  }
  return rpcError(id, -32601, 'Method not found.');
}

export async function startStdio({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  const dir = env.GAME_ARM_DIR;
  if (!dir || !path.isAbsolute(dir)) throw new Error('GAME_ARM_DIR must name the arm directory.');
  const config = JSON.parse(await fs.readFile(path.join(dir, 'host', 'config.json'), 'utf8'));
  const codex = config.codex?.path ? createCodexImageGenerator({ codex: config.codex, env }) : null;
  const images = config.portraits ? codex : null;
  // The dry run paints with the fixture painter, which hands the blueprint back; a live run paints with Codex.
  const painter = config.paint ? (config.paint.fixture ? fixturePainter() : codex) : null;
  const session = await createArmSession({ dir, images, painter, capture: armCapture(config, env) });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let initialized = false;
  for await (const line of lines) {
    if (!line.trim()) continue;
    let response;
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) response = rpcError(null, -32600, 'Request exceeded the size limit.');
    else {
      let message = null;
      try { message = JSON.parse(line); } catch { response = rpcError(null, -32700, 'Parse error.'); }
      if (message) {
        if (message.method !== 'initialize' && message.method !== 'ping' && !initialized && Object.hasOwn(message, 'id')) response = rpcError(message.id, -32000, 'Initialize the MCP session first.');
        else {
          response = await dispatch(session, message);
          if (message.method === 'initialize' && response?.result) initialized = true;
        }
      }
    }
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStdio().catch(error => { process.stderr.write(`The Long Dusk design server could not start: ${error.message}\n`); process.exitCode = 1; });
}
