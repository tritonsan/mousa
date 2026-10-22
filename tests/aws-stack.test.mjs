// The jury server's CloudFormation stack and its first boot: the committed template is the generator's own output, its
// user data names only stack values and never a key, the server is reachable only through CloudFront, and the files
// the instance runs (the bootstrap, the environment writer and the health summary) do what the stack relies on. No AWS
// request is made: Secrets Manager is a stand-in, and the health check a local server.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs/promises';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mousaStack, buildStack, placeholders, STACK_FILE, FIRST_BOOT_FILE, CACHING_DISABLED, ALL_VIEWER, CLOUDFRONT_PREFIX_LIST, APP_PORT, PREVIEW_PORT } from '../scripts/build-aws-stack.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFile(path.join(repo, ...file.split('/')), 'utf8');
const firstBoot = () => fs.readFile(FIRST_BOOT_FILE, 'utf8');
const SECRET_PARAMETERS = ['QlooApiKey', 'KiroApiKey', 'TryAccessCode'];
/** The Python the machine has, or null: the bootstrap's own helpers run with it. */
const python = ['python3', 'python'].find(command => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0) || null;
const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;

test('the committed stack is the generator\'s own output', async () => {
  assert.equal(await fs.readFile(STACK_FILE, 'utf8'), await buildStack(), 'run node scripts/build-aws-stack.mjs');
});

test('the user data names only stack values, waits for the Elastic IP before it downloads anything, and never holds a key', async () => {
  const text = await firstBoot(), stack = mousaStack({ firstBoot: text });
  const known = new Set([...Object.keys(stack.Parameters), ...Object.keys(stack.Resources)]);
  for (const name of placeholders(text)) {
    const [resource, attribute] = name.split('.');
    assert.ok(name.startsWith('AWS::') || (known.has(resource) && (!attribute || stack.Resources[resource])), `${name} is no stack value`);
  }
  for (const secret of SECRET_PARAMETERS) {
    assert.ok(!placeholders(text).includes(secret), `${secret} must stay out of the user data`);
    assert.equal(stack.Parameters[secret].NoEcho, true);
  }
  assert.ok(text.indexOf('public-ipv4') < text.indexOf('apt-get'), 'the address changes before the first download, not during it');
  assert.match(text, /exec bash \/opt\/mousa\/deploy\/aws\/bootstrap\.sh/u);
  assert.match(text, /"Status\\":\\"FAILURE\\"|"Status\\":\\"FAILURE/u, 'a failure before the bootstrap is reported to the wait condition');
  // The keys reach Secrets Manager only, and the instance may read its own three secrets and nothing else.
  const uses = JSON.stringify(stack.Resources).match(/\$\{(QlooApiKey|KiroApiKey|TryAccessCode)\}/gu) || [];
  assert.equal(uses.length, 3);
  assert.match(JSON.stringify(stack.Resources.KeysSecret.Properties.SecretString), /QLOO_API_KEY.*KIRO_API_KEY.*TRY_ACCESS_CODE/u);
  const statements = stack.Resources.InstanceRole.Properties.Policies.flatMap(policy => policy.PolicyDocument.Statement);
  assert.deepEqual(statements, [{ Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: [{ Ref: 'KeysSecret' }, { Ref: 'SiteSecret' }, { Ref: 'DemoTokenSecret' }] }]);
  assert.match(stack.Parameters.QlooApiKey.AllowedPattern, /\^\[\^'\\s\]\+\$/u, 'no quote or space, which the environment file cannot carry');
  assert.equal(new RegExp(stack.Parameters.TryAccessCode.AllowedPattern, 'u').test('short-code'), false, 'the try needs 12 characters or more');
});

test('the server is reachable only from CloudFront, on the two ports, and nothing in it can read the instance role', async () => {
  const stack = mousaStack({ firstBoot: await firstBoot() });
  const group = stack.Resources.SecurityGroup.Properties;
  assert.deepEqual(group.SecurityGroupIngress, [{ IpProtocol: 'tcp', FromPort: APP_PORT, ToPort: PREVIEW_PORT, SourcePrefixListId: { 'Fn::GetAtt': ['CloudFrontPrefixList', 'Id'] }, Description: 'CloudFront origin-facing addresses' }]);
  assert.doesNotMatch(JSON.stringify(stack), /CidrIp|0\.0\.0\.0\/0|KeyName/u, 'no open range and no SSH key');
  assert.equal(stack.Resources.CloudFrontPrefixList.Properties.Name, CLOUDFRONT_PREFIX_LIST);
  assert.match(stack.Resources.PrefixListFunction.Properties.Code.ZipFile, /describe_managed_prefix_lists/u);
  const instance = stack.Resources.Instance.Properties;
  assert.deepEqual(instance.MetadataOptions, { HttpEndpoint: 'enabled', HttpTokens: 'required', HttpPutResponseHopLimit: 1 });
  assert.deepEqual(instance.BlockDeviceMappings[0].Ebs, { VolumeSize: { Ref: 'VolumeSize' }, VolumeType: 'gp3', Encrypted: true, DeleteOnTermination: true });
  assert.equal(instance.NetworkInterfaces[0].AssociatePublicIpAddress, true, 'the first boot downloads before the Elastic IP arrives');
  // The daily snapshot finds the disk by the tag the instance passes to its volume.
  const tag = instance.Tags.find(item => item.Key === 'mousa-backup');
  assert.equal(instance.PropagateTagsToVolumeOnCreation, true);
  assert.deepEqual(stack.Resources.SnapshotPolicy.Properties.PolicyDetails.TargetTags, [tag]);
  assert.equal(stack.Resources.SnapshotPolicy.Condition, 'MakeSnapshots');
  assert.equal(stack.Resources.BootstrapWait.DependsOn, 'Instance');
  assert.deepEqual(stack.Resources.ElasticIpAssociation.Properties.InstanceId, { Ref: 'Instance' });
});

test('the two CloudFront names forward everything, cache nothing and keep no error, and only the app takes posts', async () => {
  const stack = mousaStack({ firstBoot: await firstBoot() });
  for (const [name, port, methods] of [['AppDistribution', APP_PORT, 7], ['PreviewDistribution', PREVIEW_PORT, 2]]) {
    const config = stack.Resources[name].Properties.DistributionConfig, behavior = config.DefaultCacheBehavior;
    assert.equal(config.Origins[0].CustomOriginConfig.HTTPPort, port, name);
    assert.equal(config.Origins[0].CustomOriginConfig.OriginProtocolPolicy, 'http-only');
    assert.equal(behavior.ViewerProtocolPolicy, 'redirect-to-https');
    assert.equal(behavior.CachePolicyId, CACHING_DISABLED);
    assert.equal(behavior.OriginRequestPolicyId, ALL_VIEWER);
    assert.equal(behavior.AllowedMethods.length, methods, name);
    assert.ok(config.CustomErrorResponses.every(item => item.ErrorCachingMinTTL === 0) && config.CustomErrorResponses.some(item => item.ErrorCode === 503));
    assert.equal(config.ViewerCertificate, undefined, 'the cloudfront.net certificate, with no domain');
  }
  assert.ok(stack.Resources.AppDistribution.Properties.DistributionConfig.DefaultCacheBehavior.AllowedMethods.includes('POST'));
  for (const output of ['AppUrl', 'PreviewUrl', 'StudioToken', 'SessionManager', 'Bootstrap']) assert.ok(stack.Outputs[output], output);
});

test('the bootstrap and the user data are LF shell scripts that bash parses, and the bootstrap keeps its order', { skip: !bash && 'bash is not installed' }, async () => {
  for (const file of ['deploy/aws/bootstrap.sh', 'deploy/aws/first-boot.sh']) {
    const text = await read(file);
    assert.doesNotMatch(text, /\r/u, `${file} has LF line endings`);
    // On standard input, so a bash that maps paths of its own (WSL's, on Windows) reads the same text.
    const parsed = spawnSync('bash', ['-n'], { encoding: 'utf8', input: text });
    assert.equal(parsed.status, 0, `${file}: ${parsed.stderr}`);
  }
  const text = await read('deploy/aws/bootstrap.sh');
  const order = ['kernel.apparmor_restrict_unprivileged_userns = 0', 'docker-compose-plugin', 'write-env.py', ' build --progress plain', ' create', 'MOUSA_DATA_URL', 'sha256sum -c', ' up -d', '/api/health', 'health-summary.py', 'signal SUCCESS'];
  let at = -1;
  for (const marker of order) { const next = text.indexOf(marker, at + 1); assert.ok(next > at, `${marker} comes after the step before it`); at = next; }
  assert.match(text, /"max-size": "20m"/u, 'the container logs rotate');
  assert.match(text, /trap 'failed \$LINENO' ERR/u, 'a failure is reported to the stack');
  assert.doesNotMatch(text, /cat \/etc\/mousa\/demo\.env|echo "\$(?:KIRO|QLOO|SITE|DEMO)/u, 'no secret is printed');
});

/** A folder holding a stand-in boto3 whose Secrets Manager answers from MOUSA_FAKE_SECRETS. */
async function fakeBoto() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-fake-boto-'));
  await fs.mkdir(path.join(dir, 'boto3'));
  await fs.writeFile(path.join(dir, 'boto3', '__init__.py'), [
    'import json, os',
    'class _Secrets:',
    '    def __init__(self): self.values = json.loads(os.environ["MOUSA_FAKE_SECRETS"])',
    '    def get_secret_value(self, SecretId): return {"SecretString": self.values[SecretId]}',
    'def client(service, region_name=None):',
    '    assert service == "secretsmanager" and region_name',
    '    return _Secrets()', ''].join('\n'));
  return dir;
}

test('the environment file the server writes sets every variable the server\'s example names and the Compose file reads, each quoted, and refuses a quote', { skip: !python && 'Python is not installed' }, async t => {
  const boto = await fakeBoto(), out = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-env-'));
  t.after(async () => { await fs.rm(boto, { recursive: true, force: true }); await fs.rm(out, { recursive: true, force: true }); });
  const keys = { QLOO_API_KEY: 'qloo-test-only', KIRO_API_KEY: 'ksk_test_only_value', TRY_ACCESS_CODE: 'test-only-code-1' };
  const run = secrets => spawnSync(python, [path.join(repo, 'deploy', 'aws', 'write-env.py')], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: boto,
    MOUSA_FAKE_SECRETS: JSON.stringify(secrets), MOUSA_ENV_FILE: path.join(out, 'demo.env'), MOUSA_REGION: 'us-east-1', MOUSA_REPO_DIR: repo,
    MOUSA_KEYS_SECRET: 'arn:keys', MOUSA_SITE_SECRET: 'arn:site', MOUSA_TOKEN_SECRET: 'arn:token', MOUSA_APP_DOMAIN: 'd1.cloudfront.net', MOUSA_PREVIEW_DOMAIN: 'd2.cloudfront.net',
    MOUSA_REPOSITORY_URL: 'https://github.com/owner/name.git', MOUSA_KIRO_MODEL: 'claude-opus-5.5' } });
  const done = run({ 'arn:keys': JSON.stringify(keys), 'arn:site': 's'.repeat(64), 'arn:token': 't'.repeat(40) });
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /^34 settings written, commit [0-9a-f]{12}/u);
  assert.doesNotMatch(done.stdout, /qloo-test-only|ksk_test_only|test-only-code|s{64}/u, 'nothing secret is printed');
  const text = await fs.readFile(path.join(out, 'demo.env'), 'utf8');
  const written = Object.fromEntries(text.split('\n').filter(line => /^[A-Z_]+=/u.test(line)).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.ok(Object.values(written).every(value => /^'[^'\n]*'$/u.test(value)), 'every value in single quotes, which Compose takes literally');
  assert.equal(written.KIRO_API_KEY, "'ksk_test_only_value'");
  assert.equal(written.PUBLIC_APP_BASE_URL, "'https://d1.cloudfront.net'");
  assert.equal(written.PUBLIC_PREVIEW_BASE_URL, "'https://d2.cloudfront.net'");
  assert.equal(written.SITE_REPOSITORY_URL, "'https://github.com/owner/name'");
  for (const [name, value] of Object.entries({ TRUST_PROXY: '1', LEGACY_JOBS: 'off', DEMO_BIND: '0.0.0.0', KIRO_EXPECTED_MAJOR: '2', LOG_FORMAT: 'json', TRY_DAILY_CREDITS: '0' })) assert.equal(written[name], `'${value}'`, name);
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(out, 'demo.env'))).mode & 0o777, 0o600);
  // Every variable the server's example lists, and every one the Compose file reads, is set.
  const example = (await read('deploy/demo.env.example')).split('\n').filter(line => /^[A-Z_]+=/u.test(line)).map(line => line.split('=')[0]);
  assert.deepEqual(example.filter(name => !(name in written)), []);
  const compose = [...(await read('deploy/docker-compose.yml')).matchAll(/\$\{([A-Z_]+)/gu)].map(match => match[1]);
  assert.deepEqual([...new Set(compose)].filter(name => !(name in written)), []);
  // A value with a quote cannot be written as a literal, so the file is not written at all.
  const refused = run({ 'arn:keys': JSON.stringify({ ...keys, TRY_ACCESS_CODE: "it's-a-code-1" }), 'arn:site': 's', 'arn:token': 't' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /TRY_ACCESS_CODE holds a quote/u);
});

test('the health summary the stack reports carries the deep check without the token', { skip: !python && 'Python is not installed' }, async t => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-health-'));
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers['x-demo-token']);
    if (req.url !== '/api/health/deep' || req.headers['x-demo-token'] !== 'token-test-only') { res.writeHead(401); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', kiro: { version: 'kiro-cli 2.33.1', authenticated: true }, capture: { available: true, label: 'Chromium' },
      try: { open: true, missing: [] }, gallery: { entries: 11, vote: 4 }, commit: 'abcdef123456', caller: { address: '127.0.0.1' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.close(); await fs.rm(out, { recursive: true, force: true }); });
  await fs.writeFile(path.join(out, 'demo.env'), "# test\nSITE_SECRET='x'\nDEMO_ACCESS_TOKEN='token-test-only'\n");
  // Asynchronously, so this process's server can answer while the summary waits for it.
  const result = await promisify(execFile)(python, [path.join(repo, 'deploy', 'aws', 'health-summary.py')], { encoding: 'utf8',
    env: { ...process.env, MOUSA_ENV_FILE: path.join(out, 'demo.env'), MOUSA_APP_URL: `http://127.0.0.1:${server.address().port}` } });
  assert.deepEqual(JSON.parse(result.stdout), { status: 'ok', kiro: 'kiro-cli 2.33.1', kiroKey: true, captures: 'Chromium', tryOpen: true, tryMissing: [], gallery: 11, commit: 'abcdef123456' });
  assert.doesNotMatch(result.stdout, /token-test-only/u);
  assert.deepEqual(seen, ['token-test-only']);
});
