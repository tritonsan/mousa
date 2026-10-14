#!/usr/bin/env node
// Runs one live try on this machine without the site: the same manager, prompts, agent files and Kiro sessions the
// hosted /try page runs, into DATA_DIR/try (or --data). Step one always runs; --pair builds the pair after it, and
// --publish records the operator's consent, so build-gallery adds the pair to the gallery and the vote. Each run calls
// Kiro and Qloo for real: one prediction session, and with --pair two design sessions; at most TRY_QLOO_BUDGET requests.
//
//   node scripts/run-try.mjs --starter ramble --references "Paterson; Nujabes" [--place Moda] [--ages 25_to_29,30_to_34] [--pair] [--publish] [--data <folder>]

import path from 'node:path';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { inspectKiro } from '../src/doctor.mjs';
import { createTryManager, QUICK_ACTIVE, PAIR_ACTIVE, TRY_ARMS } from '../src/try/manager.mjs';
import { STARTERS } from '../src/try/starters.mjs';

function parseArgs(argv) {
  const args = { starter: null, references: '', place: '', ages: [], pair: false, publish: false, data: null };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--starter') args.starter = argv[++index];
    else if (value === '--references') args.references = argv[++index];
    else if (value === '--place') args.place = argv[++index];
    else if (value === '--ages') args.ages = String(argv[++index] || '').split(',').map(item => item.trim()).filter(Boolean);
    else if (value === '--pair') args.pair = true;
    else if (value === '--publish') args.publish = true;
    else if (value === '--data') args.data = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!args.starter) throw new Error(`Name a starter: --starter ${Object.keys(STARTERS).join(' | ')}`);
  if (args.publish && !args.pair) throw new Error('--publish needs --pair: only a finished pair is published.');
  return args;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const seconds = start => `${Math.round((Date.now() - start) / 1000)} s`;

/** Wait for a step to end, printing each change of where it stands. */
async function follow(manager, id, step, active) {
  const start = Date.now();
  let last = '';
  for (;;) {
    const run = manager.get(id), view = await manager.view(run);
    const state = run[step];
    const line = step === 'quick' ? `${state.status}${view.predict?.calls ? `, ${view.predict.calls} Kiro calls` : ''}`
      : `${state.status}${view.arms.length ? ` | ${view.arms.map(arm => `${arm.label}: ${arm.status || '-'}${arm.stage ? ` (${arm.stage})` : ''}${arm.live?.calls ? `, ${arm.live.calls} calls` : ''}`).join(' | ')}` : ''}`;
    if (line !== last) { console.log(`[${seconds(start)}] ${step === 'quick' ? 'step one' : 'step two'}: ${line}`); last = line; }
    if (!active.includes(state.status)) return run;
    await pause(2000);
  }
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const config = getConfig({ ...process.env, ...(args.data ? { DATA_DIR: path.resolve(args.data) } : {}) });
  const kiro = await inspectKiro(config);
  const manager = createTryManager({ config, kiro, requireAccess: false });
  const ready = manager.readiness();
  if (!ready.open) throw new Error(`The try cannot run here: ${ready.missing.join(' ')}`);
  await manager.initialize();
  const stop = async () => { console.log('Stopping…'); await manager.close(); process.exit(130); };
  process.once('SIGINT', stop);
  try {
    const created = await manager.create({ starter: args.starter, references: args.references.replaceAll(';', '\n'), place: args.place, ages: args.ages }, { address: 'local-cli' });
    console.log(`Try ${created.id} in ${manager.folder(created.id)}`);
    console.log(`Kiro ${created.hostVersion || kiro.version || '?'}, model ${created.model}, Qloo budget ${created.qlooBudget}.`);
    const measured = await follow(manager, created.id, 'quick', QUICK_ACTIVE);
    if (measured.quick.status !== 'done') throw new Error(`Step one ${measured.quick.status}: ${measured.quick.problem || ''}`);
    console.log(`Step one: ${measured.quick.report?.headline || measured.quick.measured?.status}; ${measured.quick.measured?.qlooRequests ?? 0} Qloo requests.`);
    if (measured.quick.measured?.status !== 'ok') { process.exitCode = 1; return; }
    if (!args.pair) return;
    await manager.design(created.id, { address: 'local-cli' });
    const paired = await follow(manager, created.id, 'pair', PAIR_ACTIVE);
    for (const arm of TRY_ARMS) {
      const result = paired.pair.arms?.[arm.id];
      console.log(`${arm.label}: ${result?.status || 'not run'}${result?.session ? `, ${result.session.calls.length} calls in ${Math.round(result.session.durationMs / 60000)} min` : ''}${result?.problem ? `: ${result.problem}` : ''}`);
    }
    if (!['done', 'partial'].includes(paired.pair.status)) throw new Error(`Step two ${paired.pair.status}: ${paired.pair.problem || ''}`);
    console.log(`Step two: distance ${paired.pair.report?.distance ?? '?'}; ${paired.pair.qlooRequests ?? 0} Qloo requests in all.`);
    if (args.publish) { await manager.publish(created.id, true); console.log('Consent recorded: build-gallery adds this pair to the gallery and the vote.'); }
  } finally {
    await manager.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
