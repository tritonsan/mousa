#!/bin/bash
# Moves Moûsa's running jury server to another commit of this repository and, when given one, to a new data bundle,
# without replacing the instance. Run as root through Systems Manager, as the instance has no SSH:
#
#   aws ssm send-command --instance-ids <id> --document-name AWS-RunShellScript --parameters 'commands=["cd /opt/mousa &&
#     git fetch -q --depth 1 origin <ref> && git checkout -q --detach FETCH_HEAD && bash deploy/aws/redeploy.sh <ref>
#     [<bundle url> <bundle sha256>]"]'
#
# The command checks the ref out before it runs this file, so the copy that runs is the new one: a server still on an
# older commit may not hold this file at all. The new image is built before anything stops: a build that fails
# (Kiro's major version guard, a broken install) leaves the site as it was. With a bundle, only the gallery folder is
# replaced; the tries, the votes and the jobs stay. The log, /var/log/mousa-redeploy.log, names the steps and never a
# secret's value.
set -Eeuo pipefail

REF="${1:?usage: redeploy.sh <ref> [<bundle url> <bundle sha256>]}"
DATA_URL="${2:-}"
DATA_SHA256="${3:-}"
REPO=/opt/mousa
ENV_FILE=/etc/mousa/demo.env
LOG=/var/log/mousa-redeploy.log
exec > >(tee -a "$LOG") 2>&1
step() { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*"; }
trap 'step "stopped at line $LINENO; the running site was left as it was unless the restart had begun"' ERR

if [ -n "$DATA_URL" ] && [ -z "$DATA_SHA256" ]; then echo "redeploy: a bundle needs its SHA-256" >&2; exit 64; fi
cd "$REPO"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.yml)

step "fetching $REF"
git fetch -q --depth 1 origin "$REF"
git checkout -q --detach FETCH_HEAD
commit=$(git rev-parse --short=12 HEAD)
# The commit the site reports is a build argument of the image, so the environment file names it before the build.
sed -i "s/^MOUSA_COMMIT=.*/MOUSA_COMMIT='$commit'/" "$ENV_FILE"

step "building the image for $commit, while the site keeps running on its own"
"${COMPOSE[@]}" build --progress plain
docker run --rm --entrypoint cat qloo-design-demo:local /opt/kiro/version.txt

if [ -n "$DATA_URL" ]; then
  step "the data bundle"
  rm -rf /tmp/mousa-data /tmp/mousa-data.tar.gz
  mkdir -p /tmp/mousa-data
  curl -fsSL --retry 3 "$DATA_URL" -o /tmp/mousa-data.tar.gz
  echo "$DATA_SHA256  /tmp/mousa-data.tar.gz" | sha256sum -c -
  tar --no-same-owner -xzf /tmp/mousa-data.tar.gz -C /tmp/mousa-data
  chmod -R a+rX /tmp/mousa-data
fi

step "restarting the site on $commit"
"${COMPOSE[@]}" stop app
if [ -n "$DATA_URL" ]; then
  # The gallery is replaced whole, so an entry the bundle no longer holds is gone; everything else in the volume stays.
  docker run --rm --user 1000:1000 --entrypoint sh -v qloo-design-demo_demo-data:/data -v /tmp/mousa-data:/import:ro qloo-design-demo:local \
    -c 'rm -rf /data/jobs/gallery && mkdir -p /data/jobs && cp -R /import/. /data/jobs/ && ls /data/jobs/gallery | head -n 5'
  rm -rf /tmp/mousa-data /tmp/mousa-data.tar.gz
fi
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

summary=$(MOUSA_ENV_FILE="$ENV_FILE" python3 "$REPO/deploy/aws/health-summary.py") || summary='{"status":"unknown: the deep health check could not be read"}'
step "deep health: $summary"
step "done"
