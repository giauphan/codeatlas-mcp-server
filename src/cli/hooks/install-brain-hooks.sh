#!/usr/bin/env bash
# Compatibility entrypoint. All settings migration uses the shared native installer.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec node "$SCRIPT_DIR/../../../scripts/setup-hooks.js" "$@"
