// Builds the Moûsa plugin packages from plugin/: one for Claude Code, one for Codex and a Kiro agent template, plus
// the marketplace files that point at them. Each run empties the package folders and copies only what the mousa
// server imports, the font library, the four skills, the comparison agents and the write gate, so a package is
// self-contained and every copied file is byte-identical to its source. The manifests are written here.
//
//   node scripts/build-plugins.mjs [--root <folder>]
//
// --root writes the packages to <folder>/plugins and the marketplaces to <folder>, for tests; the default is the
// repository itself.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS = Object.freeze(['taste-brief', 'design', 'compare', 'connect']);
export const PACKAGES = Object.freeze({ 'claude-code': 'claude-code', codex: 'codex', kiro: 'kiro' });
const AUTHOR = Object.freeze({ name: 'tritonsan' });
const LICENSE = 'MIT';
const KEYWORDS = Object.freeze(['design', 'taste', 'qloo', 'brand', 'design-system', 'creative']);
const DESCRIPTION = 'Design for an audience from what Qloo measures it loves: Moûsa plans the taste questions, freezes your own prediction first, measures the audience and checks each design stage against the result, through review captures.';
const BRAND_COLOR = '#7855CF';
// Folders of a skill that only Codex reads: its agents/openai.yaml and its evals.
const CODEX_SKILL_PARTS = new Set(['agents', 'evals']);

const exists = file => fs.stat(file).then(() => true, () => false);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const posix = value => value.split(path.sep).join('/');

/** Every module the mousa entry reaches through relative static imports and re-exports, as paths under plugin/server. */
export async function serverModules(source = SOURCE) {
  const base = path.join(source, 'plugin', 'server');
  const found = new Set(), queue = [path.join(base, 'mousa.mjs')];
  while (queue.length) {
    const file = queue.pop();
    if (found.has(file)) continue;
    found.add(file);
    const text = await fs.readFile(file, 'utf8');
    for (const [, specifier] of text.matchAll(/(?:^|[\s;])(?:import|export)\s(?:[^'";]*?\sfrom\s)?['"](\.{1,2}\/[^'"]+)['"]/gu)) {
      const target = path.resolve(path.dirname(file), specifier);
      if (!target.startsWith(base + path.sep)) throw new Error(`${posix(path.relative(source, file))} imports ${specifier}, outside plugin/server.`);
      queue.push(target);
    }
  }
  return [...found].map(file => posix(path.relative(base, file))).sort();
}

async function filesUnder(folder, prefix = '') {
  const result = [];
  for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await filesUnder(path.join(folder, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

/** A package being written: copies keep their source, generated files are written as given. */
function packageWriter(folder) {
  const copied = [], written = [];
  return {
    folder, copied, written,
    async copy(from, to) {
      const target = path.join(folder, ...to.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(from, target);
      copied.push({ from, to });
    },
    async write(to, content) {
      const target = path.join(folder, ...to.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
      written.push(to);
    },
  };
}

/** What every package carries: the server modules, the font library, the skills, the gate and the licence. */
async function copyShared(writer, { source, host }) {
  for (const module of await serverModules(source)) await writer.copy(path.join(source, 'plugin', 'server', ...module.split('/')), `server/${module}`);
  const fonts = path.join(source, 'library', 'fonts');
  for (const file of await filesUnder(fonts)) await writer.copy(path.join(fonts, ...file.split('/')), `library/fonts/${file}`);
  for (const skill of SKILLS) {
    const folder = path.join(source, 'plugin', 'skills', skill);
    for (const file of await filesUnder(folder)) {
      if (host !== 'codex' && CODEX_SKILL_PARTS.has(file.split('/')[0])) continue;
      await writer.copy(path.join(folder, ...file.split('/')), `skills/${skill}/${file}`);
    }
  }
  await writer.copy(path.join(source, 'plugin', 'hooks', 'gate.mjs'), 'hooks/gate.mjs');
  await writer.copy(path.join(source, 'LICENSE'), 'LICENSE');
}

const gateHooks = ({ matcher, command, statusMessage }) => ({
  description: 'Moûsa write gate: in a design session, from the frozen prediction until the Design DNA is valid, the design\'s files wait, and the records in .mousa/ are written only by Moûsa\'s tools.',
  hooks: { PreToolUse: [{ matcher, hooks: [{ type: 'command', command, timeout: 10, ...(statusMessage ? { statusMessage } : {}) }] }] },
});

function claudeCodeManifest(version) {
  return {
    name: 'mousa', version, description: DESCRIPTION, author: AUTHOR, license: LICENSE, keywords: [...KEYWORDS],
    userConfig: {
      qloo_api_key: { type: 'string', title: 'Qloo API key', sensitive: true, required: false,
        description: 'Your own Qloo API key. Leave it empty to enter it later on Moûsa\'s local key page (the mousa_connect tool).' },
      qloo_base_url: { type: 'string', title: 'Qloo API endpoint', required: false, default: 'https://hackathon.api.qloo.com',
        description: 'https://hackathon.api.qloo.com for a hackathon key, https://api.qloo.com for a production key.' },
    },
  };
}

function codexManifest(version) {
  return {
    name: 'mousa', version, description: DESCRIPTION, author: AUTHOR, license: LICENSE, keywords: [...KEYWORDS],
    skills: './skills/', mcpServers: './.mcp.json',
    interface: {
      displayName: 'Moûsa',
      shortDescription: 'Design for an audience from what Qloo measures it loves',
      longDescription: 'Moûsa asks Qloo what an audience loves and turns the answer into design decisions. It plans the taste questions for the medium, freezes your own prediction first so the measurement shows what you did not expect, and returns a short Taste Brief. It then checks the reading, the Design DNA and the production plan, builds in the project\'s own design system, checks the build and hands you captures to review.',
      developerName: AUTHOR.name,
      category: 'Creativity',
      capabilities: ['Interactive', 'Read', 'Write'],
      defaultPrompt: [
        'Design a landing page for people who love Paterson and Nujabes',
        'Restyle this site for its audience with Moûsa',
        'Connect my Qloo API key to Moûsa',
      ],
      brandColor: BRAND_COLOR,
      composerIcon: './assets/icon.png',
      logo: './assets/logo.png',
      screenshots: [],
    },
    extensions: { 'com.openai': { onboardingSkill: './skills/connect/SKILL.md' } },
  };
}

const claudeCodeMcp = () => ({ mcpServers: { mousa: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server/mousa.mjs'],
  env: { QLOO_API_KEY: '${user_config.qloo_api_key}', QLOO_BASE_URL: '${user_config.qloo_base_url}', MOUSA_PROJECT_DIR: '${CLAUDE_PROJECT_DIR}', MOUSA_HOST: 'claude-code' } } } });

// Codex starts a server with an empty environment plus its own short list, so the Qloo key and Moûsa's settings
// pass by name. The project folder comes from Codex's sandbox state, and the person approves mousa_open_project.
const codexMcp = () => ({ mcpServers: { mousa: { command: 'node', args: ['./server/mousa.mjs'], cwd: '.', env: { MOUSA_HOST: 'codex' },
  env_vars: ['QLOO_API_KEY', 'QLOO_BASE_URL', 'MOUSA_IMAGES_PER_RUN', 'MOUSA_BROWSER', 'MOUSA_CAPTURE', 'MOUSA_CAPTURE_NO_SANDBOX', 'CODEX_IMAGES', 'CODEX_CLI_PATH'],
  startup_timeout_sec: 20, tool_timeout_sec: 600, tools: { mousa_open_project: { approval_mode: 'prompt' } } } } });

function packageReadme(host, version) {
  const shared = [
    '## What it holds',
    '',
    '- **The `mousa` MCP server** has twelve tools: setup (`mousa_status`, `mousa_connect`, `mousa_open_project`), taste (`taste_profile`, `taste_ask`, `qloo_query`) and design (`design_validate`, `design_check`, `design_capture`, `image`, `materials`, `design_compare`).',
    '- **Skills:**',
    '  - `taste-brief`: what to ask Qloo and how to read the answer;',
    '  - `design`: from the Taste Brief to a checked, captured design;',
    '  - `compare`: a design with Qloo and without, on request;',
    '  - `connect`: setup, on request.',
    '- **A write gate.** During a design session, from the frozen prediction until the Design DNA is valid, it holds the design\'s file writes, and it keeps hand edits out of `.mousa/`.',
    '- **The open-licence font library** (SIL OFL 1.1) that designs load their type from.',
    '',
    '## Requirements',
    '',
    '- Node.js 22 or newer.',
    '- Your own Qloo API key.',
    '- For review captures, a Chromium-based browser such as Edge or Chrome.',
    '',
    'Moûsa keeps its records in the project\'s `.mousa/` folder, and its Qloo cache carries its own `.gitignore`. Licence: MIT.',
  ];
  if (host === 'claude-code') return [`# Moûsa ${version} for Claude Code`, '', 'Moûsa grounds design work in measured cultural taste from Qloo: what an audience loves, what those works share, and what that means for palette, type, imagery, motion, voice and structure.', '',
    '## Install', '', '```', '/plugin marketplace add <this repository or its folder>', '/plugin install mousa@mousa', '/plugin configure mousa@mousa', '```', '',
    'Enter your Qloo API key when asked, or leave it empty and let the agent open Moûsa\'s local key page (`mousa_connect`). The project folder is the one Claude Code was opened in.', '',
    ...shared, '', 'Comparisons run as two agents, `mousa:mousa-designer` and `mousa:mousa-baseline`; the second has no Qloo tools.', ''].join('\n');
  return [`# Moûsa ${version} for Codex`, '', 'Moûsa grounds design work in measured cultural taste from Qloo: what an audience loves, what those works share, and what that means for palette, type, imagery, motion, voice and structure.', '',
    '## Install', '', '```', 'codex plugin marketplace add <this repository or its folder>', 'codex plugin add mousa@mousa', '```', '',
    'The `connect` skill opens on install. The agent gives you a link to Moûsa\'s local key page (`mousa_connect`), or you set `QLOO_API_KEY` in the environment Codex starts from. Trust Moûsa\'s write gate with `/hooks`. The project folder is the folder of the Codex session.', '',
    ...shared, ''].join('\n');
}

const kiroAgent = () => ({
  name: 'mousa-designer',
  description: 'Designs for an audience from what Qloo measures it loves, through Moûsa\'s checked stages.',
  prompt: 'file://../prompts/mousa-designer.md',
  mcpServers: { mousa: { command: 'node', args: ['MOUSA_PLUGIN_DIR/server/mousa.mjs'], env: { MOUSA_PROJECT_DIR: '.', MOUSA_HOST: 'kiro' }, timeout: 600000 } },
  tools: ['@mousa', 'read', 'write'],
  allowedTools: ['@mousa'],
  toolsSettings: {
    read: { deniedPaths: ['**/.env', '**/.env.*'] },
    write: { deniedPaths: ['**/.env', '**/.env.*', '.kiro/**', '.mousa/**', '**/.mousa/**'] },
  },
  resources: ['file://MOUSA_PLUGIN_DIR/skills/taste-brief/SKILL.md', 'file://MOUSA_PLUGIN_DIR/skills/design/SKILL.md'],
  includeMcpJson: false,
});

const KIRO_PROMPT = `You design for the audience the person describes, from what Qloo measures it loves, with the Moûsa tools of the mousa server. The two Moûsa skills attached to this agent are binding: taste-brief says what to ask Qloo and how to read the answer, and design takes the Taste Brief to a checked, captured design. Their references are in MOUSA_PLUGIN_DIR/skills/<skill>/references/; open one with your read tool when a step points to it.

Start with mousa_status. If Qloo is not connected, call mousa_connect and give the person the link; never ask for the key in the chat. Then follow taste-brief: plan with taste_profile dryRun, save your own prediction with design_validate before any data, measure, and read the brief. Then follow design: the reading, the Design DNA and the production plan with design_validate, the build in this project's own design system, design_check, design_capture and your review.

Write the saved records in English; the design's own copy follows the brief's language. Never write into .mousa/, and never open a .env file.
`;

const KIRO_README = `# Moûsa agent for Kiro

A Kiro CLI agent that runs Moûsa's \`mousa\` server and attaches its two skills.

1. Copy \`mousa-designer.json\` into your project's \`.kiro/agents/\`, and \`prompts/mousa-designer.md\` into \`.kiro/prompts/\`.
2. Replace every \`MOUSA_PLUGIN_DIR\` with the absolute path of a Moûsa package folder that holds \`server/\`, \`skills/\` and \`library/\`, such as this repository's \`plugins/codex\`. Use forward slashes.
3. Start the agent from the project folder: \`kiro-cli chat --agent mousa-designer\`. The first call, \`mousa_status\`, says what is missing.

The agent may use Moûsa's tools without asking, and it may not write \`.mousa/\`, \`.kiro/\` or \`.env\` files. Kiro has no write gate, so the skills' order is the agent's to keep.
`;

/** Builds every package and marketplace file. Returns what each package holds. */
export async function buildPlugins({ root = SOURCE, source = SOURCE } = {}) {
  const { MOUSA_SERVER_VERSION: version } = await import(pathToFileURL(path.join(source, 'plugin', 'server', 'mcp', 'mousa.mjs')).href);
  const out = path.join(root, 'plugins');
  const summary = {};
  for (const name of Object.values(PACKAGES)) await fs.rm(path.join(out, name), { recursive: true, force: true });

  const claude = packageWriter(path.join(out, PACKAGES['claude-code']));
  await copyShared(claude, { source, host: 'claude-code' });
  for (const file of (await fs.readdir(path.join(source, 'plugin', 'agents'))).filter(name => name.endsWith('.md')).sort()) await claude.copy(path.join(source, 'plugin', 'agents', file), `agents/${file}`);
  const evals = path.join(source, 'plugin', 'evals');
  if (await exists(evals)) for (const file of await filesUnder(evals)) await claude.copy(path.join(evals, ...file.split('/')), `evals/${file}`);
  await claude.write('.claude-plugin/plugin.json', json(claudeCodeManifest(version)));
  await claude.write('.mcp.json', json(claudeCodeMcp()));
  await claude.write('hooks/hooks.json', json(gateHooks({ matcher: 'Write|Edit|MultiEdit|NotebookEdit', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs"' })));
  await claude.write('README.md', packageReadme('claude-code', version));
  summary['claude-code'] = claude;

  const codex = packageWriter(path.join(out, PACKAGES.codex));
  await copyShared(codex, { source, host: 'codex' });
  for (const asset of ['icon.png', 'logo.png']) await codex.copy(path.join(source, 'plugin', 'assets', asset), `assets/${asset}`);
  await codex.write('.codex-plugin/plugin.json', json(codexManifest(version)));
  await codex.write('.mcp.json', json(codexMcp()));
  // Codex matches apply_patch under its own name and as Write and Edit; the hook receives the patch text.
  await codex.write('hooks/hooks.json', json(gateHooks({ matcher: 'apply_patch|Write|Edit', command: 'node "${PLUGIN_ROOT}/hooks/gate.mjs"', statusMessage: 'Checking the Moûsa design stage' })));
  await codex.write('README.md', packageReadme('codex', version));
  summary.codex = codex;

  const kiro = packageWriter(path.join(out, PACKAGES.kiro));
  await kiro.write('mousa-designer.json', json(kiroAgent()));
  await kiro.write('prompts/mousa-designer.md', KIRO_PROMPT);
  await kiro.write('README.md', KIRO_README);
  summary.kiro = kiro;

  const marketplaces = [
    ['.claude-plugin/marketplace.json', { name: 'mousa', owner: AUTHOR, metadata: { description: 'Moûsa: measured cultural taste for design work.', version },
      plugins: [{ name: 'mousa', source: `./${posix(path.relative(root, claude.folder))}`, description: DESCRIPTION, version, author: AUTHOR, license: LICENSE, keywords: [...KEYWORDS], category: 'design' }] }],
    ['.agents/plugins/marketplace.json', { name: 'mousa', interface: { displayName: 'Moûsa' },
      plugins: [{ name: 'mousa', source: { source: 'local', path: `./${posix(path.relative(root, codex.folder))}` }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Creativity' }] }],
  ];
  for (const [file, content] of marketplaces) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), json(content));
  }
  return { version, packages: summary, marketplaces: marketplaces.map(([file]) => file) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--root');
  const root = at > 0 ? path.resolve(process.argv[at + 1]) : SOURCE;
  const result = await buildPlugins({ root });
  for (const [name, writer] of Object.entries(result.packages)) {
    let bytes = 0;
    for (const file of [...writer.copied.map(item => item.to), ...writer.written]) bytes += (await fs.stat(path.join(writer.folder, ...file.split('/')))).size;
    console.log(`${name.padEnd(12)} ${String(writer.copied.length + writer.written.length).padStart(4)} files ${(bytes / 1024).toFixed(0).padStart(6)} KiB  ${posix(path.relative(root, writer.folder))}`);
  }
  console.log(`version ${result.version}; marketplaces: ${result.marketplaces.join(', ')}`);
}
