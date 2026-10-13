// The mousa skills against the code they describe: frontmatter and size limits of both hosts, links that resolve,
// tool names and call arguments that exist, and the tables of questions, recipes and methods that the code defines.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createMousaServer, MOUSA_INSTRUCTIONS } from '../plugin/server/mcp/mousa.mjs';
import { TASTE_QUESTIONS, MEDIUM_RECIPES } from '../plugin/server/taste/questions.mjs';
import { listMedia } from '../plugin/server/production/media.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin');
const SKILLS = ['taste-brief', 'design', 'compare', 'connect'];
const EXPLICIT = new Set(['compare', 'connect']);
const DESCRIPTION_LIMIT = 1024, LINE_LIMIT = 500;
const exists = file => stat(file).then(() => true, () => false);
const TOOLS = createMousaServer({ env: {}, inspect: { browser: async () => ({ available: false, reason: 'Not in tests.' }), codex: async () => ({ available: false, reason: 'Not in tests.' }) } }).listTools();
const SCHEMAS = new Map(TOOLS.map(tool => [tool.name, tool.inputSchema]));

/** The frontmatter fields of a SKILL.md or an agent file: one `key: value` per line between the --- markers. */
function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(text);
  assert.ok(match, 'the file starts with frontmatter');
  return Object.fromEntries(match[1].split('\n').map(line => /^([a-zA-Z-]+):\s*(.*)$/u.exec(line)).filter(Boolean).map(([, key, value]) => [key, value.trim()]));
}

async function markdownFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await markdownFiles(file));
    else if (entry.name.endsWith('.md')) found.push(file);
  }
  return found;
}

/** The top-level keys of each object passed to a mousa tool in the text, such as taste_ask({ question, decision }). */
function toolCalls(text) {
  const calls = [];
  for (const match of text.matchAll(/\b([a-z_]+)\(\{/gu)) {
    if (!SCHEMAS.has(match[1])) continue;
    const keys = [];
    let depth = 0, quote = null, expectKey = true, token = '';
    for (let index = match.index + match[0].length - 1; index < text.length; index++) {
      const char = text[index];
      if (quote) { if (char === quote && text[index - 1] !== '\\') quote = null; continue; }
      if (char === '\'' || char === '"' || char === '`') { quote = char; continue; }
      if ('{[('.includes(char)) { depth++; if (depth > 1) expectKey = false; continue; }
      if ('}])'.includes(char)) { depth--; if (depth === 0) break; continue; }
      if (depth !== 1) continue;
      if (char === ',') { expectKey = true; token = ''; continue; }
      if (expectKey && /[A-Za-z]/u.test(char)) token += char;
      else if (expectKey && token) { keys.push(token); expectKey = false; token = ''; }
    }
    if (expectKey && token) keys.push(token);
    calls.push({ tool: match[1], keys: keys.filter(key => key !== '...') });
  }
  return calls;
}

for (const name of SKILLS) {
  test(`the ${name} skill fits both hosts and names only what exists`, async () => {
    const dir = path.join(ROOT, 'skills', name);
    const text = (await readFile(path.join(dir, 'SKILL.md'), 'utf8')).replaceAll('\r\n', '\n');
    const fields = frontmatter(text);
    assert.equal(fields.name, name);
    assert.ok(fields.description.length >= 80 && fields.description.length <= DESCRIPTION_LIMIT, `${name} description is ${fields.description.length} characters`);
    assert.doesNotMatch(fields.description, /[<>]/u, 'no markup in a description');
    assert.doesNotMatch(fields.description, /: | #|^["'&*!|>%@`]/u, 'the description is a plain YAML scalar');
    assert.equal(fields['disable-model-invocation'] === 'true', EXPLICIT.has(name), 'explicit-only skills say so for Claude Code');

    const yaml = await readFile(path.join(dir, 'agents', 'openai.yaml'), 'utf8');
    assert.match(yaml, /^interface:\n {2}display_name: "Moûsa [^"]+"\n {2}short_description: "[^"]{10,64}"\n/u);
    assert.match(yaml, new RegExp(`\\n {2}allow_implicit_invocation: ${!EXPLICIT.has(name)}\\n`, 'u'), 'Codex invocation policy matches');
    // Codex names a plugin's skills with the plugin's namespace, and a prompt mentions one as $plugin:skill.
    if (/default_prompt/u.test(yaml)) assert.match(yaml, new RegExp(`default_prompt: "[^"]*\\$mousa:${name}\\b`, 'u'), `${name}'s prompt mentions $mousa:${name}`);

    for (const file of await markdownFiles(dir)) {
      const body = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
      const where = path.relative(ROOT, file);
      assert.ok(body.split('\n').length < LINE_LIMIT, `${where} stays under ${LINE_LIMIT} lines`);
      for (const [, target] of body.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/gu)) {
        if (/^[a-z]+:/u.test(target)) continue;
        assert.ok(await exists(path.join(path.dirname(file), target)), `${where} links to ${target}`);
      }
      for (const [tool] of body.matchAll(/\b(?:mousa|taste|qloo|design)_[a-z_]+\b/gu)) assert.ok(SCHEMAS.has(tool), `${where} names ${tool}, which this surface does not have`);
      assert.doesNotMatch(body, /\b(?:culture|project)_[a-z]+_[a-z_]+\b/u, `${where} names no tool of the older surfaces`);
      for (const { tool, keys } of toolCalls(body)) {
        const known = Object.keys(SCHEMAS.get(tool).properties || {});
        for (const key of keys) assert.ok(known.includes(key), `${where}: ${tool} has no argument ${key}`);
      }
    }
  });
}

test('the taste questions and the recipes in the skill are the ones the planner uses', async () => {
  const text = await readFile(path.join(ROOT, 'skills', 'taste-brief', 'references', 'taste-questions.md'), 'utf8');
  for (const question of TASTE_QUESTIONS) assert.match(text, new RegExp(`^### \`${question.id}\`: ${question.ask.replace(/[?]/gu, '\\?')}$`, 'mu'), question.id);
  const rows = Object.fromEntries([...text.matchAll(/^\| `([a-z-]+)` \| ([a-z_, ]+?)(?: \(needs a location\))? \|$/gmu)].map(([, medium, domains]) => [medium, domains.split(', ')]));
  for (const [medium, recipe] of Object.entries(MEDIUM_RECIPES)) assert.deepEqual(rows[medium], recipe.domains, medium);
  const skill = await readFile(path.join(ROOT, 'skills', 'taste-brief', 'SKILL.md'), 'utf8');
  for (const medium of Object.keys(MEDIUM_RECIPES)) assert.match(skill, new RegExp(`\\| \`${medium}\` \\|`, 'u'), `the medium table lists ${medium}`);
});

test('the production reference lists every method of the production media', async () => {
  const text = await readFile(path.join(ROOT, 'skills', 'design', 'references', 'production.md'), 'utf8');
  for (const medium of listMedia().filter(item => ['web', 'app-ui', 'generic'].includes(item.id))) {
    const section = text.split(`### \`${medium.id}\``)[1]?.split('\n### ')[0] || '';
    assert.ok(section, `a section for ${medium.id}`);
    for (const method of medium.methods) {
      const layers = method.layers.length === medium.layers.length ? 'every layer' : method.layers.join(', ');
      assert.match(section, new RegExp(`\\| \`${method.id}\` \\| ${layers} \\|`, 'u'), `${medium.id}: ${method.id} makes ${layers}`);
    }
  }
});

test('the comparison agents exist as the compare skill names them, and the baseline has no Qloo tool', async () => {
  const compare = await readFile(path.join(ROOT, 'skills', 'compare', 'SKILL.md'), 'utf8');
  for (const name of ['mousa-designer', 'mousa-baseline']) {
    const text = (await readFile(path.join(ROOT, 'agents', `${name}.md`), 'utf8')).replaceAll('\r\n', '\n');
    const fields = frontmatter(text);
    assert.equal(fields.name, name);
    assert.ok(fields.description.length >= 80 && fields.description.length <= DESCRIPTION_LIMIT);
    assert.doesNotMatch(fields.description, /: | #|^["'&*!|>%@`]/u);
    assert.match(compare, new RegExp(`\`mousa:${name}\``, 'u'), `the compare skill names mousa:${name}`);
    for (const [tool] of text.matchAll(/\b(?:mousa|taste|qloo|design)_[a-z_]+\b/gu)) assert.ok(SCHEMAS.has(tool), `${name} names ${tool}`);
    for (const [, tool] of text.matchAll(/mcp__plugin_mousa_mousa__([a-z_]+)/gu)) assert.ok(SCHEMAS.has(tool), `${name} denies ${tool}, which exists`);
    if (name === 'mousa-baseline') {
      const denied = fields.disallowedTools.split(',').map(item => item.trim());
      assert.deepEqual(denied.sort(), ['mcp__plugin_mousa_mousa__qloo_query', 'mcp__plugin_mousa_mousa__taste_ask']);
      assert.equal(fields.tools, undefined, 'it inherits every other tool, such as an image tool, like the Qloo arm');
    }
  }
});

test('the server instructions point to skills that exist', async () => {
  for (const name of ['taste-brief', 'design']) {
    assert.match(MOUSA_INSTRUCTIONS, new RegExp(`Moûsa ${name} skill`, 'u'));
    assert.ok(await exists(path.join(ROOT, 'skills', name, 'SKILL.md')));
  }
});

test('the call check reads the examples it is meant to check', async () => {
  const calls = [];
  for (const name of SKILLS) for (const file of await markdownFiles(path.join(ROOT, 'skills', name))) calls.push(...toolCalls(await readFile(file, 'utf8')));
  assert.ok(calls.length >= 20, `${calls.length} example calls`);
  assert.ok(calls.some(call => call.tool === 'taste_ask' && ['question', 'decision', 'myGuess'].every(key => call.keys.includes(key))));
  assert.ok(calls.some(call => call.tool === 'design_validate' && call.keys.join() === 'stage,artifact'), 'a nested artifact adds no keys');
  assert.deepEqual(toolCalls('taste_ask({ qustion: \'shortlist\' })')[0].keys, ['qustion'], 'a misspelled argument is caught');
});
