#!/bin/bash
# install-brain-hooks.sh — Install CodeAtlas hooks (NEW FLOW: simple hook names)
# Run from the codeatlas-mcp-server repo root
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS_SRC="$HERE/src/cli/hooks"
CLUDE_HOOKS_DIR="$HOME/.claude/hooks"
SETTINGS="$HOME/.claude/settings.json"
say() { echo "[$(date '+%H:%M:%S')] $*"; }

# Validate source files exist
for f in brain-save.sh brain-context.sh task-router.sh; do
    [ -f "$HOOKS_SRC/$f" ] || { say "ERROR: missing $HOOKS_SRC/$f"; exit 1; }
done

# Create Claude hooks directory if it doesn't exist
mkdir -p "$CLUDE_HOOKS_DIR"

# Copy original hook scripts
cp "$HOOKS_SRC/brain-save.sh" "$CLUDE_HOOKS_DIR/brain-save.sh"
cp "$HOOKS_SRC/brain-context.sh" "$CLUDE_HOOKS_DIR/brain-context.sh"
cp "$HOOKS_SRC/task-router.sh" "$CLUDE_HOOKS_DIR/task-router.sh"
chmod +x "$CLUDE_HOOKS_DIR"/*.sh

# Create codeatlas wrapper so settings can use: "codeatlas hook brain-context"
cat > "$CLUDE_HOOKS_DIR/codeatlas" << WRAPPER_EOF
#!/bin/bash
set -euo pipefail
HOOKS_DIR="$CLUDE_HOOKS_DIR"
if [ "\${1:-}" != "hook" ]; then
  echo "usage: codeatlas hook <brain-context|brain-save|task-router>" >&2
  exit 2
fi
case "\${2:-}" in
  brain-context) exec "\$HOOKS_DIR/brain-context.sh" ;;
  brain-save) exec "\$HOOKS_DIR/brain-save.sh" ;;
  task-router) exec "\$HOOKS_DIR/task-router.sh" ;;
  *) echo "unknown codeatlas hook: \${2:-}" >&2; exit 2 ;;
esac
WRAPPER_EOF
chmod +x "$CLUDE_HOOKS_DIR/codeatlas"

# Update settings.json with new hook registration format
echo "Updating $SETTINGS with new hook configuration..."

# Backup existing settings if it exists
if [ -f "$SETTINGS" ]; then
    cp "$SETTINGS" "$SETTINGS.bak"
    say "Backed up existing settings to $SETTINGS.bak"
fi

# Create/update settings.json with new flow configuration
cat > "$SETTINGS" << 'SETTINGS_EOF'
{
  "hooks": {
    "prePrompt": ["codeatlas hook brain-context"],
    "postToolUse": ["codeatlas hook brain-save", "codeatlas hook task-router"]
  }
}
SETTINGS_EOF

say "Copied hooks to $CLUDE_HOOKS_DIR"
say "Created wrapper: codeatlas hook <name>"
say "Updated $SETTINGS with new hook registration"
say "Done. Restart Claude to activate."
