#!/bin/bash
# =============================================================================
# install-brain-hooks.sh — CodeAtlas Second Brain hooks installer (idempotent)
#
# Installs the project-scoped Brain hooks for ALL Claude Code projects on this
# machine:
#   1. Copies brain-save.sh (v4) + brain-context.sh (v3) from the repo into
#      ~/.claude/hooks/ (global), overwriting any older version.
#   2. chmod +x both.
#   3. Patches ~/.claude/settings.json hook commands (idempotent):
#        - UserPromptSubmit  : brain-context.sh 2>/dev/null   (keep stdout context)
#        - UserPromptSubmit  : task-router.sh    2>/dev/null
#        - PostToolUse       : brain-save.sh >/dev/null 2>&1
#        - PostToolUseFailure: brain-save.sh >/dev/null 2>&1
#        - removes duplicate PostToolUse entries
#   4. Never touches project .claude/settings.json (avoids double-fire with
#      global hooks) nor global CLAUDE.md.
#
# Usage:
#   bash scripts/install-brain-hooks.sh
#   bash scripts/install-brain-hooks.sh --dry-run   # show what WOULD change
# =============================================================================
set -euo pipefail

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_SAVE="$HERE/.claude/hooks/brain-save.sh"
REPO_CTX="$HERE/.claude/hooks/brain-context.sh"
HOOKS_DIR="$HOME/.claude/hooks"
SETTINGS="$HOME/.claude/settings.json"
BACKUP="$HOME/.claude/settings.json.bak-install-$(date +%Y%m%d-%H%M%S)"

say() { printf '%s\n' "$*"; }
[ "$DRY_RUN" = true ] && say "== DRY RUN (nothing written) =="

for f in "$REPO_SAVE" "$REPO_CTX"; do
  if [ ! -f "$f" ]; then
    say "ERROR: missing $f — run from the repo root containing .claude/hooks/"
    exit 1
  fi
done

mkdir -p "$HOOKS_DIR"

if [ "$DRY_RUN" = true ]; then
  say "would copy: $REPO_SAVE -> $HOOKS_DIR/brain-save.sh"
  say "would copy: $REPO_CTX  -> $HOOKS_DIR/brain-context.sh"
else
  cp "$REPO_SAVE" "$HOOKS_DIR/brain-save.sh"
  cp "$REPO_CTX" "$HOOKS_DIR/brain-context.sh"
  chmod +x "$HOOKS_DIR/brain-save.sh" "$HOOKS_DIR/brain-context.sh"
  say "copied hooks -> $HOOKS_DIR"
fi

[ -f "$SETTINGS" ] || { say "ERROR: $SETTINGS not found"; exit 1; }

if [ "$DRY_RUN" = true ]; then
  say "would patch $SETTINGS (backup -> $BACKUP)"
else
  cp "$SETTINGS" "$BACKUP"
  python3 - "$SETTINGS" <<'PY'
import json, os, sys
p = sys.argv[1]
hooks_dir = os.path.join(os.path.expanduser("~"), ".claude", "hooks")
s = json.load(open(p))
h = s.setdefault("hooks", {})

for ev in h.get("UserPromptSubmit", []):
    for x in ev.get("hooks", []):
        c = x.get("command", "")
        if "brain-context.sh" in c:
            x["command"] = f"{hooks_dir}/brain-context.sh 2>/dev/null"
        elif "task-router.sh" in c:
            x["command"] = f"{hooks_dir}/task-router.sh 2>/dev/null"

pt = h.get("PostToolUse", [])
if len(pt) > 1:
    h["PostToolUse"] = [pt[0]]

for ev in h.get("PostToolUse", []) + h.get("PostToolUseFailure", []):
    for x in ev.get("hooks", []):
        if "brain-save.sh" in x.get("command", ""):
            x["command"] = f"{hooks_dir}/brain-save.sh >/dev/null 2>&1"

json.dump(s, open(p, "w"), indent=2)
PY
  say "patched $SETTINGS (backup: $BACKUP)"
fi

say ""
say "Done. Restart Claude Code for the new hooks to load."
say "Verify after restart:"
say "  tail -f ~/.claude/brain-save.log   # every line tagged with your project"
say "  grep -n 'brain-' ~/.claude/settings.json"