// A small MCP server loop over stdio: one JSON-RPC message per line, answered in order. The server object supplies
// initialize, listTools and callTool; this loop owns framing, the size limit, the initialize-first rule and errors.

import { createInterface } from 'node:readline';

export const MAX_MESSAGE_BYTES = 256 * 1024;

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** One JSON-RPC message in, one response (or null for a notification) out. */
export async function handleMessage(message, server, state) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(null, -32600, 'Invalid JSON-RPC request.');
  }
  const hasId = Object.hasOwn(message, 'id');
  if (hasId && typeof message.id !== 'string' && (typeof message.id !== 'number' || !Number.isFinite(message.id))) return rpcError(null, -32600, 'Invalid request ID.');
  if (!hasId) return null;
  const { id, method, params } = message;
  if (method === 'initialize') {
    if (typeof params?.protocolVersion !== 'string') return rpcError(id, -32602, 'protocolVersion is required.');
    const result = await server.initialize(params);
    state.initialized = true;
    return { jsonrpc: '2.0', id, result };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (!state.initialized) return rpcError(id, -32000, 'Initialize the MCP session first.');
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: server.listTools() } };
  if (method === 'tools/call') {
    if (typeof params?.name !== 'string') return rpcError(id, -32602, 'A tool name is required.');
    try { return { jsonrpc: '2.0', id, result: await server.callTool(params.name, params.arguments ?? {}, params._meta ?? null) }; }
    catch { return rpcError(id, -32603, 'The tool could not complete.'); }
  }
  return rpcError(id, -32601, 'Method not found.');
}

export async function serveStdio({ server, input = process.stdin, output = process.stdout } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const state = { initialized: false };
  for await (const line of lines) {
    if (!line.trim()) continue;
    let response;
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) response = rpcError(null, -32600, 'Request exceeded the size limit.');
    else {
      let message, parsed = false;
      try { message = JSON.parse(line); parsed = true; } catch { response = rpcError(null, -32700, 'Parse error.'); }
      if (parsed) response = await handleMessage(message, server, state);
    }
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}
