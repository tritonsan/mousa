import fs from 'node:fs/promises';
import path from 'node:path';
import { boundNativeWebResponse, normalizeNativeWebToolName } from './web-research.mjs';

const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
function actualInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The native research input format is unsupported.');
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => key !== '__tool_use_purpose' && item != null));
}

/** Installed-engine adapter: consume typed tool envelopes, never assistant prose. */
export function nativeWebSessionEvents(record) {
  const events = [];
  if (record?.kind === 'AssistantMessage') {
    for (const block of record.data?.content || []) {
      if (block.kind !== 'toolUse') continue;
      const toolName = normalizeNativeWebToolName(block.data?.name);
      if (!toolName) continue;
      if (typeof block.data?.toolUseId !== 'string') throw new Error('The native research call ID is missing.');
      events.push({ phase: 'before', toolCallId: block.data.toolUseId, toolName, input: actualInput(block.data.input) });
    }
  } else if (record?.kind === 'ToolResults') {
    for (const [toolCallId, item] of Object.entries(record.data?.results || {})) {
      const builtIn = item?.tool?.kind?.BuiltIn;
      if (!builtIn || typeof builtIn !== 'object') continue;
      const entry = Object.entries(builtIn).find(([name]) => normalizeNativeWebToolName(name));
      if (!entry) continue;
      const [name, input] = entry;
      const response = item.result;
      if (!response || typeof response !== 'object' || !['Success', 'Error', 'Failure', 'Failed'].some(key => Object.hasOwn(response, key))) throw new Error('The native research result format is unsupported.');
      events.push({ phase: 'after', toolCallId, toolName: normalizeNativeWebToolName(name), input: actualInput(input),
        response: boundNativeWebResponse(response), status: Object.hasOwn(response, 'Success') ? 'ok' : 'error' });
    }
  }
  return events;
}

/**
 * Host-owned observation for Kiro versions that ignore native web hooks.
 * It can reject a generation after an observed violation, but does not prevent
 * the underlying network request. Invoke outside the project write queue.
 */
export function createNativeResearchSync({ home, bridgeUrl, webBridgeToken, fetchImpl = globalThis.fetch }) {
  const directory = path.join(home, 'sessions', 'cli');
  const fileLines = new Map(), pending = new Map(), completed = new Set();
  let queue = Promise.resolve(), failure;
  const send = async (event, input = event.input) => {
    const response = await fetchImpl(new URL('/internal/tools', bridgeUrl), { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${webBridgeToken}` },
      body: JSON.stringify({ name: `studio_web_${event.phase}`, arguments: { toolName: event.toolName, input,
        captureMode: 'kiro-native-session', nativeToolCallId: event.toolCallId,
        ...(event.phase === 'after' ? { response: event.response, status: event.status } : {}) } }),
      signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error('The native research observation bridge is unavailable.');
    const receipt = await response.json();
    let result = receipt?.structuredContent;
    if (!result && Array.isArray(receipt?.content)) { try { result = JSON.parse(receipt.content.find(item => item.type === 'text')?.text || 'null'); } catch { /* A valid receipt is required. */ } }
    if (receipt?.isError || result?.status !== (event.phase === 'before' ? 'allowed' : 'recorded')) throw new Error(result?.error?.message || 'Native research could not be recorded by the host.');
  };
  const consume = async event => {
    if (event.phase === 'before') {
      if (pending.has(event.toolCallId) || completed.has(event.toolCallId)) return;
      await send(event);
      pending.set(event.toolCallId, event);
      return;
    }
    if (completed.has(event.toolCallId)) return;
    const start = pending.get(event.toolCallId);
    if (!start || start.toolName !== event.toolName || Object.entries(start.input).some(([key, value]) => canonical(event.input[key]) !== canonical(value))) throw new Error('The native research result could not be matched to its observed call.');
    // Preserve the literal arguments supplied at invocation. The runtime can
    // add defaults (for example a missing fetch mode) to its completion record.
    await send(event, start.input);
    completed.add(event.toolCallId);
    pending.delete(event.toolCallId);
  };
  const flush = async () => {
    let files;
    try { files = await fs.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const candidates = files.filter(file => /^[a-f0-9-]{36}\.jsonl$/iu.test(file.name));
    if (candidates.length > 4) throw new Error('The native research session count exceeds its capture limit.');
    for (const file of candidates.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile() || file.isSymbolicLink()) throw new Error('The native research session file is invalid.');
      const target = path.join(directory, file.name);
      if ((await fs.stat(target)).size > 32_000_000) throw new Error('The native research session exceeds its capture limit.');
      const lines = (await fs.readFile(target, 'utf8')).split('\n');
      // A final incomplete line is left for the next synchronization. Kiro
      // owns this append-only log; project file tools cannot address it.
      const end = lines.length - 1;
      const start = fileLines.get(file.name) || 0;
      if (end < start) throw new Error('The native research session changed after observation.');
      for (let index = start; index < end; index++) {
        if (lines[index].length > 8_000_000) throw new Error('The native research session record exceeds its capture limit.');
        let record;
        try { record = JSON.parse(lines[index]); } catch { throw new Error('The native research session record is invalid.'); }
        for (const event of nativeWebSessionEvents(record)) await consume(event);
        fileLines.set(file.name, index + 1);
      }
    }
  };
  return ({ final = false } = {}) => {
    if (failure) return Promise.reject(failure);
    queue = queue.then(flush).then(() => {
      if (final && pending.size) throw new Error('A native research call has no matching recorded runtime result.');
    }).catch(error => { failure = error; throw error; });
    return queue;
  };
}
