// A small MCP server loop over stdio: one JSON-RPC message per line. The client's requests are answered one after
// another, in order. The server may also ask the client, as roots/list asks which folders the person opened; the
// answer to such a request is taken as soon as it arrives, since the request that needs it may be waiting inside the
// one being handled. The server object supplies initialize, listTools and callTool, and optionally attach (to receive
// the request function) and notify; this loop owns framing, the size limit, the initialize-first rule and errors.

import { createInterface } from 'node:readline';

export const MAX_MESSAGE_BYTES = 256 * 1024;
export const CLIENT_REQUEST_TIMEOUT_MS = 10000;

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** One JSON-RPC message in, one response (or null for a notification) out. */
export async function handleMessage(message, server, state) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(null, -32600, 'Invalid JSON-RPC request.');
  }
  const hasId = Object.hasOwn(message, 'id');
  if (hasId && typeof message.id !== 'string' && (typeof message.id !== 'number' || !Number.isFinite(message.id))) return rpcError(null, -32600, 'Invalid request ID.');
  if (!hasId) { await server.notify?.(message.method, message.params ?? null); return null; }
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

export async function serveStdio({ server, input = process.stdin, output = process.stdout, timeoutMs = CLIENT_REQUEST_TIMEOUT_MS } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const state = { initialized: false };
  const write = message => output.write(`${JSON.stringify(message)}\n`);
  const pending = new Map();
  let next = 0;
  // A request of the server's own, answered by its id; one the client leaves unanswered fails after timeoutMs.
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = `mousa-${++next}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`The client did not answer ${method}.`)); }, timeoutMs);
    timer.unref?.();
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
  });
  server.attach?.({ request });
  let queue = Promise.resolve();
  const answer = (task, id = null) => { queue = queue.then(task).then(response => { if (response) write(response); }, () => write(rpcError(id, -32603, 'The request could not be completed.'))); };
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) { answer(() => rpcError(null, -32600, 'Request exceeded the size limit.')); continue; }
    let message;
    try { message = JSON.parse(line); } catch { answer(() => rpcError(null, -32700, 'Parse error.')); continue; }
    const reply = message && typeof message === 'object' && !Array.isArray(message) && message.method === undefined && pending.get(message.id);
    if (reply) {
      pending.delete(message.id);
      if (message.error) reply.reject(new Error(String(message.error.message || 'The client refused the request.'))); else reply.resolve(message.result);
      continue;
    }
    answer(() => handleMessage(message, server, state), message?.id ?? null);
  }
  await queue;
}
