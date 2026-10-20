#!/usr/bin/env bash
# Compatibility bridge for older hook registrations. Capture, validation,
# transcript access, persistence, and retries are handled by the native CLI.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
CLI="${CODEATLAS_CLI_PATH:-}"

if [ -z "$CLI" ]; then
  CLI="$(command -v codeatlas-enterprise 2>/dev/null || true)"
fi
if [ -z "$CLI" ] && [ -f "$SCRIPT_DIR/../../../dist/index.js" ]; then
  CLI="$SCRIPT_DIR/../../../dist/index.js"
fi
if [ -z "$CLI" ] && [ -f "$SCRIPT_DIR/../../../index.js" ]; then
  CLI="$SCRIPT_DIR/../../../index.js"
fi

if [ -z "$CLI" ]; then
  echo "[CodeAtlas hook] capture_status=cli_missing" >&2
  exit 0
fi

case "$CLI" in
  *.js) exec node "$CLI" hook brain-save ;;
  *) exec "$CLI" hook brain-save ;;
esac
