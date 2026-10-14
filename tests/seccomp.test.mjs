// The container's seccomp profile: Docker's default with only what Chromium's own sandbox needs. The generator refuses
// a profile shaped otherwise than the one reviewed, and the committed profile carries exactly the three changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromiumProfile, ADDED } from '../scripts/build-seccomp.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASK = 2114060288;
const fixture = () => ({ defaultAction: 'SCMP_ACT_ERRNO', defaultErrnoRet: 1, syscalls: [
  { names: ['read', 'write'], action: 'SCMP_ACT_ALLOW' },
  { names: ['clone', 'unshare', 'mount', 'setns'], action: 'SCMP_ACT_ALLOW', includes: { caps: ['CAP_SYS_ADMIN'] } },
  { names: ['clone'], action: 'SCMP_ACT_ALLOW', args: [{ index: 0, value: MASK, op: 'SCMP_CMP_MASKED_EQ' }], excludes: { caps: ['CAP_SYS_ADMIN'], arches: ['s390', 's390x'] } },
  { names: ['clone'], action: 'SCMP_ACT_ALLOW', args: [{ index: 1, value: MASK, op: 'SCMP_CMP_MASKED_EQ' }], includes: { arches: ['s390', 's390x'] }, excludes: { caps: ['CAP_SYS_ADMIN'] } },
  { names: ['clone3'], action: 'SCMP_ACT_ERRNO', errnoRet: 38, excludes: { caps: ['CAP_SYS_ADMIN'] } },
  { names: ['chroot'], action: 'SCMP_ACT_ALLOW', includes: { caps: ['CAP_SYS_CHROOT'] } },
] });

test('the Chromium profile lifts only the namespace mask on clone and allows unshare and chroot', () => {
  const profile = chromiumProfile(fixture());
  const cloneRules = profile.syscalls.filter(rule => rule.names.length === 1 && rule.names[0] === 'clone');
  assert.equal(cloneRules.length, 2);
  assert.ok(cloneRules.every(rule => rule.args === undefined && /Mousa:/u.test(rule.comment)), 'clone may create namespaces');
  assert.deepEqual(profile.syscalls.at(-1).names, ['unshare', 'chroot']);
  assert.equal(profile.syscalls.at(-1).includes, undefined);
  assert.deepEqual(profile.syscalls.slice(0, 2), fixture().syscalls.slice(0, 2), 'every other rule is the default\'s');
  assert.deepEqual(profile.syscalls.find(rule => rule.names[0] === 'clone3'), fixture().syscalls[4], 'clone3 still answers ENOSYS');
  const changed = fixture();
  changed.syscalls.splice(2, 1);
  assert.throws(() => chromiumProfile(changed), /two masked clone rules/u, 'a default profile shaped otherwise is reviewed first');
  assert.throws(() => chromiumProfile({ defaultAction: 'SCMP_ACT_ALLOW', syscalls: [] }), /not Docker's default/u);
});

test('the committed profile is the default with those changes, and its licence and notice are beside it', async () => {
  const profile = JSON.parse(await readFile(path.join(repo, 'deploy', 'seccomp-chromium.json'), 'utf8'));
  assert.equal(profile.defaultAction, 'SCMP_ACT_ERRNO');
  const unconditional = profile.syscalls.filter(rule => !rule.includes?.caps && rule.action === 'SCMP_ACT_ALLOW');
  for (const name of ['mount', 'setns', 'pivot_root', 'umount2', 'bpf']) assert.ok(!unconditional.some(rule => rule.names.includes(name) && !rule.args), `${name} keeps the default's rule`);
  assert.deepEqual(profile.syscalls.at(-1), { ...ADDED, names: [...ADDED.names] });
  assert.ok(profile.syscalls.filter(rule => rule.names.length === 1 && rule.names[0] === 'clone').every(rule => !rule.args));
  assert.match(await readFile(path.join(repo, 'deploy', 'seccomp-chromium.LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/u);
  assert.match(await readFile(path.join(repo, 'deploy', 'seccomp-chromium.NOTICE'), 'utf8'), /moby\/profiles/u);
  assert.match(await readFile(path.join(repo, 'deploy', 'docker-compose.yml'), 'utf8'), /- seccomp=\.\/seccomp-chromium\.json/u);
});
