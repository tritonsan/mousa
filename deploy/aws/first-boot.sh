#!/bin/bash
# The user data of deploy/aws/mousa-stack.json, which scripts/build-aws-stack.mjs reads into the template's Fn::Sub:
# each name in a dollar sign and braces below is a stack value CloudFormation fills in, so this file runs only as the
# stack's user data, and a comment here must never hold such a name. At first
# boot it waits until the stack's Elastic IP is the instance's address (so no download is cut when the address
# changes), clones the repository at the stack's ref and runs its bootstrap. A failure before the bootstrap is reported
# to the stack's wait condition, so the stack stops with the reason instead of waiting for its timeout.
set -euo pipefail
export MOUSA_WAIT_HANDLE='${BootstrapHandle}'
fail() {
  body="{\"Status\":\"FAILURE\",\"Reason\":\"The first boot stopped before the bootstrap: $1. Read /var/log/cloud-init-output.log through Session Manager.\",\"UniqueId\":\"bootstrap\",\"Data\":\"\"}"
  curl -fsS --retry 5 -X PUT -H 'Content-Type:' --data-binary "$body" "$MOUSA_WAIT_HANDLE" || true
  exit 1
}
token() { curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 300' http://169.254.169.254/latest/api/token; }
for attempt in $(seq 1 120); do
  address=$(curl -fsS -H "X-aws-ec2-metadata-token: $(token)" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
  if [ "$address" = '${ElasticIp}' ]; then break; fi
  if [ "$attempt" = 120 ]; then fail 'the Elastic IP was not associated within ten minutes'; fi
  sleep 5
done
export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=600 -y update >/dev/null || fail 'apt-get update failed'
apt-get -o DPkg::Lock::Timeout=600 -y install git ca-certificates curl >/dev/null || fail 'git could not be installed'
git init -q /opt/mousa && git -C /opt/mousa remote add origin '${RepositoryUrl}' || fail 'the repository folder could not be made'
git -C /opt/mousa fetch -q --depth 1 origin '${RepositoryRef}' && git -C /opt/mousa checkout -q --detach FETCH_HEAD || fail 'the repository or its ref could not be fetched'
export MOUSA_REPO_DIR=/opt/mousa MOUSA_REGION='${AWS::Region}' MOUSA_REPOSITORY_URL='${RepositoryUrl}' MOUSA_KIRO_MODEL='${KiroModel}'
export MOUSA_KEYS_SECRET='${KeysSecret}' MOUSA_SITE_SECRET='${SiteSecret}' MOUSA_TOKEN_SECRET='${DemoTokenSecret}'
export MOUSA_APP_DOMAIN='${AppDistribution.DomainName}' MOUSA_PREVIEW_DOMAIN='${PreviewDistribution.DomainName}'
export MOUSA_DATA_URL='${DataBundleUrl}' MOUSA_DATA_SHA256='${DataBundleSha256}'
exec bash /opt/mousa/deploy/aws/bootstrap.sh
