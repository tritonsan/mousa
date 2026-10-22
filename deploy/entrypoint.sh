#!/bin/sh
set -eu

# Optional file mounts avoid placing keys in the image or Compose YAML.
# Do not echo these values: they authenticate account-backed services.
if [ -n "${DEMO_ACCESS_TOKEN_FILE:-}" ]; then
  DEMO_ACCESS_TOKEN="$(cat "$DEMO_ACCESS_TOKEN_FILE")"
  export DEMO_ACCESS_TOKEN
fi
if [ -n "${KIRO_API_KEY_FILE:-}" ]; then
  KIRO_API_KEY="$(cat "$KIRO_API_KEY_FILE")"
  export KIRO_API_KEY
fi
if [ -n "${QLOO_API_KEY_FILE:-}" ]; then
  QLOO_API_KEY="$(cat "$QLOO_API_KEY_FILE")"
  export QLOO_API_KEY
fi
if [ -n "${SITE_SECRET_FILE:-}" ]; then
  SITE_SECRET="$(cat "$SITE_SECRET_FILE")"
  export SITE_SECRET
fi
if [ -n "${TRY_ACCESS_CODE_FILE:-}" ]; then
  TRY_ACCESS_CODE="$(cat "$TRY_ACCESS_CODE_FILE")"
  export TRY_ACCESS_CODE
fi

mkdir -p "${DATA_DIR:-/data/jobs}" "${HOME:-/data/kiro-home}"

# Kiro checks for an update when it starts. The image's version is the one the try was tested with, so the server's
# own Kiro never updates itself: the status checks run with HOME, and each try session sets the same in its KIRO_HOME.
settings="${HOME:-/data/kiro-home}/.kiro/settings/cli.json"
mkdir -p "$(dirname "$settings")"
node -e 'const fs = require("fs"), file = process.argv[1]; let value = {}; try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch {} value["app.disableAutoupdates"] = true; fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");' "$settings" || true
exec "$@"
