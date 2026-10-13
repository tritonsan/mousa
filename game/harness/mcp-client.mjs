// A minimal MCP client over stdio for the dry run and the tests: starts the game design server for one arm
// directory and calls its tools the way Kiro would.

import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mcp-server.mjs');

export async function connect({ dir, env = process.env }) {
  const child = spawn(process.execPath, [server], { env: { ...env, GAME_ARM_DIR: dir }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map();
  let next = 0, stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  createInterface({ input: child.stdout }).on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  child.on('close', () => { for (const waiter of pending.values()) waiter.reject(new Error(`The design server closed. ${stderr.trim()}`)); pending.clear(); });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'long-dusk-script', version: '1.0.0' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return {
    tools: async () => (await request('tools/list')).tools,
    call: async (name, args = {}) => {
      const result = await request('tools/call', { name, arguments: args });
      const text = result.content?.map(item => item.text).join('\n') ?? '';
      return { ...result, text, value: result.structuredContent ?? null };
    },
    close: () => new Promise(resolve => { child.on('close', resolve); child.stdin.end(); }),
  };
}
