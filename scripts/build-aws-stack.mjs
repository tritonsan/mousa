#!/usr/bin/env node
// Writes deploy/aws/mousa-stack.json, the CloudFormation template of the jury's server, from this file and
// deploy/aws/first-boot.sh, its user data. One stack holds the whole server: an Ubuntu 24.04 instance administered
// through Session Manager (no SSH), its Elastic IP, a security group that admits only CloudFront's origin-facing
// addresses on the two ports, two CloudFront distributions that give the app and the preview an HTTPS name each under
// cloudfront.net, the keys in Secrets Manager, and a daily snapshot of the disk. The instance builds and starts the site
// at first boot and reports to a wait condition, so the stack ends with the site running or with the reason it is not.
// --check compares the committed template with this file's output and fails on any difference.
//
//   node scripts/build-aws-stack.mjs [--check]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STACK_FILE = path.join(repo, 'deploy', 'aws', 'mousa-stack.json');
export const FIRST_BOOT_FILE = path.join(repo, 'deploy', 'aws', 'first-boot.sh');

// CloudFront's managed policies, by their fixed IDs: no caching, since the app marks what may be cached, and every
// viewer header, cookie and query string forwarded: the try's access cookie, the Range header of the game's music and
// the Host a form's Origin is checked against.
export const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
export const ALL_VIEWER = '216adef6-5c7f-47e4-b989-5492eafa07d3';
export const CLOUDFRONT_PREFIX_LIST = 'com.amazonaws.global.cloudfront.origin-facing';
export const APP_PORT = 8787, PREVIEW_PORT = 8788;
const ALL_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'];
// The codes CloudFront would otherwise keep for ten seconds; an error answer, such as the try's 503 while it is busy,
// is never kept, so each request reaches the server.
const ERROR_CODES = [400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504];

const ref = name => ({ Ref: name });
const att = (name, attribute) => ({ 'Fn::GetAtt': [name, attribute] });
const sub = text => ({ 'Fn::Sub': text });
const role = (service, managed, policies = []) => ({ Type: 'AWS::IAM::Role', Properties: {
  AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: service }, Action: 'sts:AssumeRole' }] },
  ManagedPolicyArns: managed.map(name => sub(`arn:\${AWS::Partition}:iam::aws:policy/${name}`)),
  ...(policies.length ? { Policies: policies } : {}),
} });

// The public DNS name EC2 gives the Elastic IP: a CloudFront origin must be a name, not an address.
const dashed = { 'Fn::Join': ['-', { 'Fn::Split': ['.', ref('ElasticIp')] }] };
const originName = { 'Fn::If': ['InUsEast1',
  { 'Fn::Join': ['', ['ec2-', dashed, '.compute-1.amazonaws.com']] },
  { 'Fn::Join': ['', ['ec2-', dashed, '.', ref('AWS::Region'), '.compute.amazonaws.com']] }] };

function distribution({ id, port, methods, comment }) {
  return { Type: 'AWS::CloudFront::Distribution', Properties: { DistributionConfig: {
    Comment: comment, Enabled: true, HttpVersion: 'http2and3', IPV6Enabled: true, PriceClass: 'PriceClass_100',
    Origins: [{ Id: id, DomainName: originName, CustomOriginConfig: { HTTPPort: port, OriginProtocolPolicy: 'http-only', OriginReadTimeout: 60, OriginKeepaliveTimeout: 5 } }],
    DefaultCacheBehavior: { TargetOriginId: id, ViewerProtocolPolicy: 'redirect-to-https', AllowedMethods: methods, CachedMethods: ['GET', 'HEAD'], Compress: false,
      CachePolicyId: CACHING_DISABLED, OriginRequestPolicyId: ALL_VIEWER },
    CustomErrorResponses: ERROR_CODES.map(code => ({ ErrorCode: code, ErrorCachingMinTTL: 0 })),
  } } };
}

// Looks up the CloudFront origin-facing prefix list in the stack's region: its ID differs from region to region.
const PREFIX_LIST_CODE = `import boto3
import cfnresponse


def handler(event, context):
    physical = event.get('PhysicalResourceId', 'cloudfront-origin-facing')
    try:
        if event['RequestType'] == 'Delete':
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {}, physical)
            return
        name = event['ResourceProperties']['Name']
        found = boto3.client('ec2').describe_managed_prefix_lists(Filters=[{'Name': 'prefix-list-name', 'Values': [name]}])['PrefixLists']
        if not found:
            raise ValueError(name + ' is not a managed prefix list in this region.')
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {'Id': found[0]['PrefixListId']}, found[0]['PrefixListId'])
    except Exception as error:
        cfnresponse.send(event, context, cfnresponse.FAILED, {}, physical, reason=str(error)[:200])
`;

/** The stack's template; `firstBoot` is the text of deploy/aws/first-boot.sh. */
export function mousaStack({ firstBoot }) {
  const keyPattern = "^[^'\\s]+$";
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Mousa jury server: one Ubuntu instance behind two CloudFront names (app and preview), the keys in Secrets Manager, a daily disk snapshot. The instance builds and starts the site at first boot.',
    // A wait condition's Data is the JSON string its signals sent, which AWS's own examples put in Outputs; cfn-lint types
    // it as an object (E6101).
    Metadata: { 'cfn-lint': { config: { ignore_checks: ['E6101'] } }, 'AWS::CloudFormation::Interface': {
      ParameterGroups: [
        { Label: { default: 'The code' }, Parameters: ['RepositoryUrl', 'RepositoryRef', 'DataBundleUrl', 'DataBundleSha256'] },
        { Label: { default: 'Keys and the live try' }, Parameters: ['QlooApiKey', 'KiroApiKey', 'TryAccessCode', 'KiroModel'] },
        { Label: { default: 'The server' }, Parameters: ['VpcId', 'SubnetId', 'InstanceType', 'VolumeSize', 'DailySnapshots', 'UbuntuImage'] },
      ],
      ParameterLabels: {
        RepositoryUrl: { default: 'Public GitHub repository' }, RepositoryRef: { default: 'Branch, tag or commit' },
        DataBundleUrl: { default: 'Data bundle URL (optional)' }, DataBundleSha256: { default: 'Data bundle SHA-256 (optional)' },
        QlooApiKey: { default: 'Qloo API key' }, KiroApiKey: { default: 'Kiro API key' }, TryAccessCode: { default: 'Access code for the jury' },
        KiroModel: { default: 'Kiro model' }, VpcId: { default: 'VPC (the default one)' }, SubnetId: { default: 'Subnet of that VPC' },
        InstanceType: { default: 'Instance type' }, VolumeSize: { default: 'Disk size (GB)' }, DailySnapshots: { default: 'Daily disk snapshots' },
        UbuntuImage: { default: 'Ubuntu image (leave as it is)' },
      },
    } },
    Parameters: {
      RepositoryUrl: { Type: 'String', Description: 'The public repository the server clones, such as https://github.com/owner/name.', AllowedPattern: '^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$', ConstraintDescription: 'An https://github.com/owner/name address.' },
      RepositoryRef: { Type: 'String', Default: 'main', Description: 'The branch, tag or commit to deploy. The site is built once, at first boot.', AllowedPattern: '^[A-Za-z0-9._/-]{1,100}$' },
      DataBundleUrl: { Type: 'String', Default: '', Description: 'An https address of a .tar.gz of scripts/export-hosted-jobs.mjs --gallery --showcase. Empty: the site starts without the gallery.', AllowedPattern: "^(https://[^\\s']+)?$" },
      DataBundleSha256: { Type: 'String', Default: '', Description: 'The bundle\'s SHA-256, checked before it is unpacked. Empty: not checked.', AllowedPattern: '^([a-f0-9]{64})?$' },
      QlooApiKey: { Type: 'String', NoEcho: true, MinLength: 8, AllowedPattern: keyPattern, Description: 'The Qloo hackathon key. It is kept in Secrets Manager and never in the instance\'s user data.' },
      KiroApiKey: { Type: 'String', NoEcho: true, MinLength: 8, AllowedPattern: keyPattern, Description: 'A key from app.kiro.dev, API Keys. Kept in Secrets Manager.' },
      TryAccessCode: { Type: 'String', NoEcho: true, AllowedPattern: '^[A-Za-z0-9._~-]{12,64}$', Description: 'The code the jury enters at /try/: 12 to 64 letters, digits, dots, dashes or underscores. Put it in the submission\'s testing instructions.', ConstraintDescription: '12 to 64 letters, digits, dots, dashes, underscores or tildes.' },
      KiroModel: { Type: 'String', Default: 'claude-opus-5.5', AllowedPattern: '^[A-Za-z0-9._:/-]{1,120}$', Description: 'The model both arms of a try run with.' },
      VpcId: { Type: 'AWS::EC2::VPC::Id', Description: 'The default VPC of the region, whose subnets give instances a public address.' },
      SubnetId: { Type: 'AWS::EC2::Subnet::Id', Description: 'A subnet of the VPC above.' },
      InstanceType: { Type: 'String', Default: 't3.large', AllowedValues: ['t3.large', 't3.xlarge', 'm6i.large', 'm7i.large'], Description: 'Two vCPUs and 8 GB fit one pair (two Kiro sessions) beside two first steps.' },
      VolumeSize: { Type: 'Number', Default: 60, MinValue: 40, MaxValue: 500, Description: 'The encrypted gp3 disk: the system, the image, the gallery and the tries.' },
      DailySnapshots: { Type: 'String', Default: 'Yes', AllowedValues: ['Yes', 'No'], Description: 'A snapshot of the disk every day at 03:00 UTC, the last 14 kept.' },
      UbuntuImage: { Type: 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>', Default: '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id', Description: 'Canonical\'s current Ubuntu 24.04 image for the region.' },
    },
    Conditions: {
      InUsEast1: { 'Fn::Equals': [ref('AWS::Region'), 'us-east-1'] },
      MakeSnapshots: { 'Fn::Equals': [ref('DailySnapshots'), 'Yes'] },
    },
    Resources: {
      PrefixListRole: role('lambda.amazonaws.com', ['service-role/AWSLambdaBasicExecutionRole'],
        [{ PolicyName: 'describe-prefix-lists', PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'ec2:DescribeManagedPrefixLists', Resource: '*' }] } }]),
      PrefixListFunction: { Type: 'AWS::Lambda::Function', Properties: { Runtime: 'python3.12', Handler: 'index.handler', Timeout: 30, Role: att('PrefixListRole', 'Arn'),
        Description: 'Finds the CloudFront origin-facing prefix list of the region for the security group.', Code: { ZipFile: PREFIX_LIST_CODE } } },
      CloudFrontPrefixList: { Type: 'Custom::PrefixList', Properties: { ServiceToken: att('PrefixListFunction', 'Arn'), Name: CLOUDFRONT_PREFIX_LIST } },
      SecurityGroup: { Type: 'AWS::EC2::SecurityGroup', Properties: { VpcId: ref('VpcId'),
        GroupDescription: 'Mousa: the app and preview ports, from CloudFront only',
        SecurityGroupIngress: [{ IpProtocol: 'tcp', FromPort: APP_PORT, ToPort: PREVIEW_PORT, SourcePrefixListId: att('CloudFrontPrefixList', 'Id'), Description: 'CloudFront origin-facing addresses' }] } },
      KeysSecret: { Type: 'AWS::SecretsManager::Secret', Properties: { Name: sub('${AWS::StackName}-keys'), Description: 'Mousa: the Qloo and Kiro keys and the jury\'s access code.',
        SecretString: sub('{"QLOO_API_KEY":"${QlooApiKey}","KIRO_API_KEY":"${KiroApiKey}","TRY_ACCESS_CODE":"${TryAccessCode}"}') } },
      SiteSecret: { Type: 'AWS::SecretsManager::Secret', Properties: { Name: sub('${AWS::StackName}-site-secret'), Description: 'Mousa: seals the blind vote\'s ballots and signs the try\'s access.',
        GenerateSecretString: { PasswordLength: 64, ExcludePunctuation: true } } },
      DemoTokenSecret: { Type: 'AWS::SecretsManager::Secret', Properties: { Name: sub('${AWS::StackName}-studio-token'), Description: 'Mousa: the token for /studio and /api/health/deep.',
        GenerateSecretString: { PasswordLength: 40, ExcludePunctuation: true } } },
      InstanceRole: role('ec2.amazonaws.com', ['AmazonSSMManagedInstanceCore'],
        [{ PolicyName: 'read-own-secrets', PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: [ref('KeysSecret'), ref('SiteSecret'), ref('DemoTokenSecret')] }] } }]),
      InstanceProfile: { Type: 'AWS::IAM::InstanceProfile', Properties: { Roles: [ref('InstanceRole')] } },
      ElasticIp: { Type: 'AWS::EC2::EIP', Properties: { Domain: 'vpc', Tags: [{ Key: 'Name', Value: sub('${AWS::StackName}') }] } },
      AppDistribution: distribution({ id: 'app', port: APP_PORT, methods: ALL_METHODS, comment: 'Mousa app: the site, the gallery, the vote and the try' }),
      PreviewDistribution: distribution({ id: 'preview', port: PREVIEW_PORT, methods: ['GET', 'HEAD'], comment: 'Mousa preview: the designs, sandboxed, on an origin of their own' }),
      BootstrapHandle: { Type: 'AWS::CloudFormation::WaitConditionHandle' },
      Instance: { Type: 'AWS::EC2::Instance', Properties: {
        ImageId: ref('UbuntuImage'), InstanceType: ref('InstanceType'), IamInstanceProfile: ref('InstanceProfile'),
        NetworkInterfaces: [{ DeviceIndex: '0', SubnetId: ref('SubnetId'), GroupSet: [ref('SecurityGroup')], AssociatePublicIpAddress: true, DeleteOnTermination: true }],
        BlockDeviceMappings: [{ DeviceName: '/dev/sda1', Ebs: { VolumeSize: ref('VolumeSize'), VolumeType: 'gp3', Encrypted: true, DeleteOnTermination: true } }],
        // IMDSv2 only, one hop: the host reads its role, and no container (the model's pages in Chromium among them) can.
        MetadataOptions: { HttpEndpoint: 'enabled', HttpTokens: 'required', HttpPutResponseHopLimit: 1 },
        PropagateTagsToVolumeOnCreation: true,
        Tags: [{ Key: 'Name', Value: sub('${AWS::StackName}') }, { Key: 'mousa-backup', Value: sub('${AWS::StackName}') }],
        UserData: { 'Fn::Base64': sub(firstBoot) },
      } },
      ElasticIpAssociation: { Type: 'AWS::EC2::EIPAssociation', Properties: { AllocationId: att('ElasticIp', 'AllocationId'), InstanceId: ref('Instance') } },
      BootstrapWait: { Type: 'AWS::CloudFormation::WaitCondition', DependsOn: 'Instance', Properties: { Handle: ref('BootstrapHandle'), Timeout: '3600', Count: 1 } },
      SnapshotRole: { Condition: 'MakeSnapshots', ...role('dlm.amazonaws.com', ['service-role/AWSDataLifecycleManagerServiceRole']) },
      SnapshotPolicy: { Type: 'AWS::DLM::LifecyclePolicy', Condition: 'MakeSnapshots', Properties: {
        Description: 'Mousa daily snapshot of the server disk with 14 kept', State: 'ENABLED', ExecutionRoleArn: att('SnapshotRole', 'Arn'),
        PolicyDetails: { PolicyType: 'EBS_SNAPSHOT_MANAGEMENT', ResourceTypes: ['VOLUME'], TargetTags: [{ Key: 'mousa-backup', Value: sub('${AWS::StackName}') }],
          Schedules: [{ Name: 'daily', CopyTags: true, CreateRule: { Interval: 24, IntervalUnit: 'HOURS', Times: ['03:00'] }, RetainRule: { Count: 14 } }] },
      } },
    },
    Outputs: {
      AppUrl: { Description: 'The site, for the jury: the gallery, the blind vote and the live try at /try/.', Value: sub('https://${AppDistribution.DomainName}') },
      PreviewUrl: { Description: 'Where the designs play, sandboxed: an origin of its own.', Value: sub('https://${PreviewDistribution.DomainName}') },
      StudioToken: { Description: 'Open it and choose Retrieve secret value: the token for /studio and /api/health/deep.', Value: sub('https://${AWS::Region}.console.aws.amazon.com/secretsmanager/secret?name=${AWS::StackName}-studio-token&region=${AWS::Region}') },
      SessionManager: { Description: 'A shell on the server, with no SSH: the bootstrap log is /var/log/mousa-bootstrap.log.', Value: sub('https://${AWS::Region}.console.aws.amazon.com/systems-manager/session-manager/${Instance}?region=${AWS::Region}') },
      Bootstrap: { Description: 'What the first boot reported: Kiro, the captures, the try and the gallery.', Value: att('BootstrapWait', 'Data') },
      InstanceId: { Value: ref('Instance') },
      ElasticIp: { Value: ref('ElasticIp') },
    },
  };
}

/** The names a first-boot script's dollar-brace placeholders may use: the stack's parameters, its resources' Refs and attributes, and pseudo parameters. */
export function placeholders(text) {
  return [...new Set([...text.matchAll(/\$\{([^}]+)\}/gu)].map(match => match[1]))];
}

export async function buildStack() {
  return `${JSON.stringify(mousaStack({ firstBoot: await fs.readFile(FIRST_BOOT_FILE, 'utf8') }), null, 2)}\n`;
}

async function main() {
  const text = await buildStack();
  if (process.argv.includes('--check')) {
    const committed = await fs.readFile(STACK_FILE, 'utf8').catch(() => '');
    if (committed !== text) { console.error(`${path.relative(repo, STACK_FILE)} differs from scripts/build-aws-stack.mjs; run it again.`); process.exitCode = 1; return; }
    console.log('The stack template matches its source.');
    return;
  }
  await fs.writeFile(STACK_FILE, text);
  console.log(`Wrote ${path.relative(repo, STACK_FILE)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
