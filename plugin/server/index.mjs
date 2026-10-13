import { startStdio } from './mcp/server.mjs';
startStdio().catch(() => {
  process.stderr.write('Culture MCP could not start. Check server configuration.\n');
  process.exitCode = 1;
});
