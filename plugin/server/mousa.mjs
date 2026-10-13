import { serveStdio } from './mcp/stdio.mjs';
import { createMousaServer } from './mcp/mousa.mjs';

serveStdio({ server: createMousaServer() }).catch(() => {
  process.stderr.write('Moûsa MCP could not start. Check the server configuration.\n');
  process.exitCode = 1;
});
