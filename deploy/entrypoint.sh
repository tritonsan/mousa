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

mkdir -p "${DATA_DIR:-/data/jobs}" "${HOME:-/data/kiro-home}"
exec "$@"
