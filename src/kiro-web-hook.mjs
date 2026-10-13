import { pathToFileURL } from 'node:url';
import { boundNativeWebResponse, normalizeNativeWebToolName } from './web-research.mjs';

export async function runWebResearchHook({ phase, event, bridgeUrl, bridgeToken, fetchImpl = globalThis.fetch }) {
  if (!['before', 'after'].includes(phase) || !event || typeof event !== 'object') throw new Error('The web research hook input is invalid.');
  const toolName = normalizeNativeWebToolName(event.tool_name || event.toolName);
  if (!['web_search', 'web_fetch'].includes(toolName)) throw new Error('The web research hook received an unsupported tool.');
  const input = event.tool_input || event.toolInput || {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input), 'utf8') > 6000) throw new Error('The web research input exceeds its supported bounds.');
  let endpoint;
  try { endpoint = new URL('/internal/tools', bridgeUrl); } catch { throw new Error('The web research bridge is unavailable.'); }
  if (endpoint.username || endpoint.password || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) || typeof bridgeToken !== 'string' || !bridgeToken) throw new Error('The web research bridge is unavailable.');
  const hasResponse = Object.hasOwn(event, 'tool_response') || Object.hasOwn(event, 'toolResponse');
  if (phase === 'after' && !hasResponse) throw new Error('The native web tool did not supply a research response.');
  const argumentsValue = { toolName, input, ...(phase === 'after' ? {
    response: boundNativeWebResponse(event.tool_response ?? event.toolResponse),
    ...(typeof event.status === 'string' ? { status: event.status } : {}),
  } : {}) };
  const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridgeToken}` },
    body: JSON.stringify({ name: `studio_web_${phase}`, arguments: argumentsValue }),
    signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error('The web research bridge rejected this hook.');
  const receipt = await response.json();
  let result = receipt?.structuredContent;
  if (!result && Array.isArray(receipt?.content)) {
    const content = receipt.content.find(item => item.type === 'text');
    try { result = JSON.parse(content?.text || 'null'); } catch { /* Only a machine-readable receipt is accepted. */ }
  }
  if (receipt?.isError || result?.status !== (phase === 'before' ? 'allowed' : 'recorded')) throw new Error(result?.error?.message || 'The web research hook could not complete its host receipt.');
  return result;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw, 'utf8') > 2_000_000) throw new Error('The native web response exceeds the capture limit.');
  }
  const result = await runWebResearchHook({ phase: process.argv[2], event: JSON.parse(raw),
    bridgeUrl: process.env.CULTURE_WEB_BRIDGE_URL, bridgeToken: process.env.CULTURE_WEB_BRIDGE_TOKEN });
  // Post-hook context provides the host-assigned source IDs to the model.
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('Web research was blocked or could not be recorded. Read project_get_research for the host status; do not claim unrecorded findings.\n'); process.exitCode = 2; });
}
