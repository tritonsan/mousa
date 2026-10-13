#!/usr/bin/env node
// Moûsa's write gate: a PreToolUse hook for Claude Code (Write, Edit, MultiEdit, NotebookEdit) and Codex (apply_patch,
// which Codex also matches as Write and Edit). During a Moûsa design session, from the frozen prediction until the
// Design DNA is valid, it stops the agent from writing that design's files, so the taste stages come before the build.
// It also keeps the agent out of .mousa/, whose records only Moûsa's tools write. Anything it cannot read is let through:
// the gate guards the protocol, it is not a sandbox, and shell commands are not gated.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GATED_STAGES = Object.freeze({
  predicted: 'measure the audience with taste_profile, then save the reading and the DNA with design_validate',
  measured: 'save the reading and the Design DNA with design_validate',
  baseline: 'save the reading and the Design DNA with design_validate',
  read: 'save the Design DNA with design_validate',
});
const STATE_DIR = '.mousa';
const MAX_DEPTH = 12;

/** The files a tool call would write: a Claude Code path field, or the files named in a Codex patch. */
export function targetsOf(event) {
  const input = event?.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
  const targets = ['file_path', 'notebook_path'].map(key => input[key]).filter(value => typeof value === 'string' && value.trim());
  const patch = [input.command, input.input, input.patch].find(value => typeof value === 'string' && value.includes('*** Begin Patch'));
  if (patch) for (const match of patch.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+?)\s*$/gmu)) targets.push(match[1]);
  return targets;
}

/** The nearest Moûsa session above a file: the folder whose .mousa/session.json it belongs to, and its stage. */
export function sessionOf(file) {
  let folder = path.dirname(file);
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    try {
      const session = JSON.parse(fs.readFileSync(path.join(folder, STATE_DIR, 'session.json'), 'utf8'));
      if (session?.plugin === 'mousa') return { folder, stage: String(session.stage || '') };
    } catch { /* No session here; look one folder up. */ }
    const parent = path.dirname(folder);
    if (parent === folder) break;
    folder = parent;
  }
  return null;
}

/** The reason to refuse this tool call, or null to let it through. */
export function decide(event) {
  const cwd = typeof event?.cwd === 'string' && event.cwd ? event.cwd : process.cwd();
  for (const target of targetsOf(event)) {
    const file = path.resolve(cwd, target);
    if (file.split(/[\\/]/u).includes(STATE_DIR)) {
      return `Moûsa: the records in ${STATE_DIR}/ are written only by Moûsa's tools. Save a stage with design_validate instead of editing its record.`;
    }
    const session = sessionOf(file);
    if (session && Object.hasOwn(GATED_STAGES, session.stage)) {
      const where = path.relative(cwd, session.folder) || 'this project';
      return `Moûsa: the design in ${where} is at stage "${session.stage}", before a valid Design DNA, so its files wait. First ${GATED_STAGES[session.stage]}.`;
    }
  }
  return null;
}

/** The hook's answer in the shape both hosts read: a PreToolUse permission decision on stdout. */
export function denial(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

async function main() {
  let text = '';
  for await (const chunk of process.stdin) { text += chunk; if (text.length > 4 * 1024 * 1024) return; }
  let event;
  try { event = JSON.parse(text); } catch { return; }
  const reason = decide(event);
  if (reason) process.stdout.write(`${JSON.stringify(denial(reason))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {}).finally(() => { process.exitCode = 0; });
}
