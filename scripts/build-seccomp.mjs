#!/usr/bin/env node
// Writes deploy/seccomp-chromium.json: Docker's default seccomp profile (moby/profiles, seccomp/default.json, Apache
// License 2.0) with the changes Chromium's own sandbox needs in a container that holds no capability. clone may
// create namespaces, and unshare and chroot are allowed; mount, setns and every other call keep the default's rules.
// The review captures can then keep Chromium's sandbox instead of MOUSA_CAPTURE_NO_SANDBOX=1. It makes no request.
// See deploy/seccomp-chromium.NOTICE.
//
//   node scripts/build-seccomp.mjs <moby/profiles seccomp/default.json> [--out deploy/seccomp-chromium.json]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// CLONE_NEWNS | CLONE_NEWCGROUP | CLONE_NEWUTS | CLONE_NEWIPC | CLONE_NEWUSER | CLONE_NEWPID | CLONE_NEWNET: the flags
// the default profile masks out of clone for a container without CAP_SYS_ADMIN.
const NAMESPACE_FLAGS = 2114060288;
export const ADDED = Object.freeze({ names: ['unshare', 'chroot'], action: 'SCMP_ACT_ALLOW',
  comment: 'Mousa: Chromium\'s sandbox enters new user, PID and network namespaces and drops the filesystem with chroot.' });

/** The default profile with Chromium's sandbox calls added; throws when the profile is not shaped as reviewed. */
export function chromiumProfile(profile) {
  if (profile?.defaultAction !== 'SCMP_ACT_ERRNO' || !Array.isArray(profile.syscalls)) throw new Error('This is not Docker\'s default seccomp profile.');
  const masked = profile.syscalls.filter(rule => rule.names?.length === 1 && rule.names[0] === 'clone' && rule.action === 'SCMP_ACT_ALLOW'
    && rule.args?.length === 1 && rule.args[0].value === NAMESPACE_FLAGS && rule.args[0].op === 'SCMP_CMP_MASKED_EQ');
  if (masked.length !== 2) throw new Error(`Expected the default profile's two masked clone rules and found ${masked.length}: review the profile before changing it.`);
  if (profile.syscalls.some(rule => !rule.includes?.caps && !rule.includes?.arches && ADDED.names.some(name => rule.names?.includes(name)))) throw new Error('unshare or chroot already has an unconditional rule; review the profile.');
  const syscalls = profile.syscalls.map(rule => {
    if (!masked.includes(rule)) return rule;
    const { args: _args, ...rest } = rule;
    void _args;
    return { ...rest, comment: 'Mousa: clone may create namespaces, for Chromium\'s sandbox.' };
  });
  return { ...profile, syscalls: [...syscalls, { ...ADDED, names: [...ADDED.names] }] };
}

async function main() {
  const [source, ...rest] = process.argv.slice(2);
  if (!source) throw new Error('Name the path of moby/profiles seccomp/default.json.');
  const at = rest.indexOf('--out');
  const out = path.resolve(repo, at >= 0 ? rest[at + 1] : 'deploy/seccomp-chromium.json');
  const profile = chromiumProfile(JSON.parse(await fs.readFile(source, 'utf8')));
  await fs.writeFile(out, `${JSON.stringify(profile, null, 2)}\n`);
  console.log(`${path.relative(repo, out)}: ${profile.syscalls.length} rules; clone may create namespaces, and ${ADDED.names.join(' and ')} are allowed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
