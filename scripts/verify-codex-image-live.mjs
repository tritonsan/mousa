import path from 'node:path';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { inspectCodex, createCodexImageGenerator, buildImagePrompt } from '../src/image-generator.mjs';

// One real image through the Studio's Codex generator, outside any Kiro or Qloo run. It uses the ChatGPT plan of the
// signed-in Codex CLI, so it runs only with --run; without it the script prints the CLI status and the host prompt.
const DNA = { devices: [
  { id: 'dna1', layer: 'palette', device: 'Midnight ink and brass', tokens: { colors: ['#14182b', '#c9a227', '#e9e2d0'] } },
  { id: 'dna2', layer: 'imagery', device: 'Lamp-lit still lifes with deep shadows', qualities: ['Moody', 'Atmospheric'], tokens: { colors: ['#14182b', '#c9a227'] } },
] };
loadDotEnv(); const config = getConfig();
const codex = await inspectCodex({ config });
const request = buildImagePrompt({ dna: DNA, device: 'dna2', subject: 'A bottle of olive oil and a jar of honey on a wooden table at night', aspect: 'landscape' });
if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ status: 'planned-only', codex, prompt: request.prompt, instruction: 'Pass --run to generate one real image with the signed-in Codex CLI (ChatGPT plan usage).' }, null, 2));
} else {
  if (!codex.available) throw new Error(codex.reason);
  const directory = path.join(config.rootDir, 'output', 'codex-image-live', 'generated');
  const result = await createCodexImageGenerator({ codex }).generate({ prompt: request.prompt, directory, name: 'dna2-1' });
  console.log(JSON.stringify({ codex: { version: codex.version }, prompt: request.prompt, result, file: path.join(directory, path.basename(result.path)) }, null, 2));
}
