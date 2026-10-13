import { pathToFileURL } from 'node:url';
import { startStdio } from '../../plugin/server/mcp/server.mjs';
export { PROTOCOL_VERSIONS, SERVER_VERSION, toolDefinitions, getToolDefinitions, sessionInstructions, createToolHandler, createBridgeHandler, dispatchRpc, startStdio } from '../../plugin/server/mcp/server.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStdio().catch(() => { process.stderr.write('Culture MCP could not start. Check server configuration.\n'); process.exitCode = 1; });
}
