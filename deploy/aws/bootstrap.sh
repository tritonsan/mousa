#!/bin/bash
# Moûsa's jury server, from a fresh Ubuntu 24.04 instance to the running site. deploy/aws/first-boot.sh, the user
# data of deploy/aws/mousa-stack.json, clones this repository at the stack's ref and runs this file as root, with the
# stack's values in MOUSA_* variables. It installs Docker from Docker's own repository, writes the server's private
# environment file from Secrets Manager, builds the image, imports the published data when the stack names a bundle,
# starts the site and tells CloudFormation how it went. The log, /var/log/mousa-bootstrap.log, names the steps and
# never a secret's value.
set -Eeuo pipefail

LOG=/var/log/mousa-bootstrap.log
exec > >(tee -a "$LOG") 2>&1
step() { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*"; }

for name in MOUSA_REPO_DIR MOUSA_REGION MOUSA_KEYS_SECRET MOUSA_SITE_SECRET MOUSA_TOKEN_SECRET MOUSA_APP_DOMAIN MOUSA_PREVIEW_DOMAIN MOUSA_WAIT_HANDLE; do
  if [ -z "${!name:-}" ]; then echo "bootstrap: $name is not set" >&2; exit 64; fi
done

# CloudFormation's wait condition takes one JSON document; the stack's Bootstrap output shows its Data.
signal() {
  local body
  body=$(python3 - "$1" "$2" "${3:-}" <<'PY'
import json, sys
status, reason, data = sys.argv[1:4]
print(json.dumps({"Status": status, "Reason": reason[:2000], "UniqueId": "bootstrap", "Data": data[:4000]}))
PY
)
  curl -fsS --retry 5 -X PUT -H 'Content-Type:' --data-binary "$body" "$MOUSA_WAIT_HANDLE" >/dev/null || step "CloudFormation could not be told the result"
}
failed() {
  step "stopped at line $1"
  signal FAILURE "The bootstrap stopped at line $1: $(tail -n 4 "$LOG" | tr '\n' ' ' | cut -c1-600) Read /var/log/mousa-bootstrap.log through Session Manager."
}
trap 'failed $LINENO' ERR

export DEBIAN_FRONTEND=noninteractive
APT=(apt-get -o DPkg::Lock::Timeout=600 -y)

step "swap: 4 GB beside the instance's memory, for two Kiro sessions and their captures at once"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# The container's Chromium keeps its own sandbox for the pages the model wrote (deploy/seccomp-chromium.json), and the
# sandbox needs unprivileged user namespaces, which Ubuntu 24.04 lets AppArmor refuse by default.
step "user namespaces for Chromium's sandbox"
printf 'kernel.apparmor_restrict_unprivileged_userns = 0\n' > /etc/sysctl.d/60-mousa-userns.conf
sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 >/dev/null || step "this kernel has no AppArmor switch for user namespaces"

step "Docker from Docker's repository"
"${APT[@]}" update
"${APT[@]}" install ca-certificates curl python3-boto3
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" > /etc/apt/sources.list.d/docker.list
"${APT[@]}" update
# The site logs a JSON line per request; the container logs rotate at 5 x 20 MB.
mkdir -p /etc/docker
printf '{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }\n' > /etc/docker/daemon.json
"${APT[@]}" install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker version --format 'Docker engine {{.Server.Version}}'
docker compose version

step "the server's private environment file, from Secrets Manager and the stack's values"
install -d -m 0700 /etc/mousa
MOUSA_ENV_FILE=/etc/mousa/demo.env python3 "$MOUSA_REPO_DIR/deploy/aws/write-env.py"

cd "$MOUSA_REPO_DIR"
COMPOSE=(docker compose --env-file /etc/mousa/demo.env -f deploy/docker-compose.yml)

step "building the image: Kiro from its stable channel, and the build stops on a major version other than 2"
"${COMPOSE[@]}" build --progress plain
docker run --rm --entrypoint cat qloo-design-demo:local /opt/kiro/version.txt
"${COMPOSE[@]}" create

# The data a hosted site shows (the gallery, the showcase and its jobs), exported on the machine that recorded them:
# scripts/export-hosted-jobs.mjs --gallery --showcase, packed as a .tar.gz of the export folder's contents.
if [ -n "${MOUSA_DATA_URL:-}" ] && [ ! -e /etc/mousa/data-imported ]; then
  step "importing the data bundle"
  rm -rf /tmp/mousa-data /tmp/mousa-data.tar.gz
  mkdir -p /tmp/mousa-data
  curl -fsSL --retry 3 "$MOUSA_DATA_URL" -o /tmp/mousa-data.tar.gz
  if [ -n "${MOUSA_DATA_SHA256:-}" ]; then echo "$MOUSA_DATA_SHA256  /tmp/mousa-data.tar.gz" | sha256sum -c -; fi
  tar --no-same-owner -xzf /tmp/mousa-data.tar.gz -C /tmp/mousa-data
  chmod -R a+rX /tmp/mousa-data
  docker run --rm --user 1000:1000 --entrypoint sh -v qloo-design-demo_demo-data:/data -v /tmp/mousa-data:/import:ro qloo-design-demo:local \
    -c 'mkdir -p /data/jobs && cp -R /import/. /data/jobs/ && ls /data/jobs | head -n 5'
  touch /etc/mousa/data-imported
  rm -rf /tmp/mousa-data /tmp/mousa-data.tar.gz
fi

step "starting the site"
"${COMPOSE[@]}" up -d
for attempt in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:8787/api/health; then break; fi
  if [ "$attempt" = 60 ]; then
    "${COMPOSE[@]}" logs --tail 40 app || true
    echo "the site did not answer /api/health within five minutes" >&2
    false
  fi
  sleep 5
done

# What the stack reports back: the deep health check without any secret in it.
summary=$(MOUSA_ENV_FILE=/etc/mousa/demo.env python3 "$MOUSA_REPO_DIR/deploy/aws/health-summary.py") || summary='{"status":"unknown: the deep health check could not be read"}'
step "deep health: $summary"
touch /etc/mousa/bootstrapped
signal SUCCESS "Mousa is running." "$summary"
step "done"
