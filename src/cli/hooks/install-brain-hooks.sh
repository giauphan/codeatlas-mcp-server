#!/bin/bash
# install-brain-hooks.sh — Install Claude CLI hooks from this repo
# Run from the codeatlas-mcp-server repo root
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS_SRC="$HERE/src/cli/hooks"
HOOKS_DIR="$HOME/.claude/hooks"
SETTINGS="$HOME/.claude/settings.json"
say() { echo "[$(date '+%H:%M:%S')] $*"; }
for f in brain-save.sh brain-context.sh task-router.sh; do
    [ -f "$HOOKS_SRC/$f" ] || { say "ERROR: missing $HOOKS_SRC/$f"; exit 1; }
done
[ -f "$SETTINGS" ] || { say "ERROR: $SETTINGS not found"; exit 1; }
mkdir -p "$HOOKS_DIR"
cp "$HOOKS_SRC"/brain-save.sh "$HOOKS_SRC"/brain-context.sh "$HOOKS_SRC"/task-router.sh "$HOOKS_DIR/"
chmod +x "$HOOKS_DIR"/*.sh
say "Copied hooks to $HOOKS_DIR"
say "Done. Restart Claude to activate."
