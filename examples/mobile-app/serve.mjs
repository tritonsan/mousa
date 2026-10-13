// Serves this app on a loopback port for a browser, with the plugin's own capture server: known web file types only,
// and never a dot-folder such as .kiro or .mousa. Stop it with Ctrl+C.
//
//   node serve.mjs

import { fileURLToPath } from 'node:url';
import { serveDirectory } from '../../plugin/server/production/capture.mjs';

const server = await serveDirectory(fileURLToPath(new URL('.', import.meta.url)));
console.log(`Ramble: ${server.url}/index.html`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
