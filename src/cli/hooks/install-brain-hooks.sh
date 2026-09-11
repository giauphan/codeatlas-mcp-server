#!/bin/bash
# install-brain-hooks.sh — Install CodeAtlas hooks (NEW FLOW: simple hook names)
# Run from the codeatlas-mcp-server repo root
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS_SRC="$HERE/src/cli/hooks"

# Allow running globally if scripts are compiled
if [ ! -d "$HOOKS_SRC" ]; then
    HOOKS_SRC="$(dirname "${BASH_SOURCE[0]}")"
fi

CLAUDE_HOOKS_DIR="$HOME/.claude/hooks"
SETTINGS="$HOME/.claude/settings.json"
say() { echo "[$(date '+%H:%M:%S')] $*"; }

# Validate source files exist
for f in brain-save.sh brain-context.sh task-router.sh; do
    [ -f "$HOOKS_SRC/$f" ] || { say "ERROR: missing $HOOKS_SRC/$f"; exit 1; }
done

# Create Claude hooks directory if it doesn't exist
mkdir -p "$CLAUDE_HOOKS_DIR"

# Copy original hook scripts
cp "$HOOKS_SRC/brain-save.sh" "$CLAUDE_HOOKS_DIR/brain-save.sh"
cp "$HOOKS_SRC/brain-context.sh" "$CLAUDE_HOOKS_DIR/brain-context.sh"
cp "$HOOKS_SRC/task-router.sh" "$CLAUDE_HOOKS_DIR/task-router.sh"
chmod +x "$CLAUDE_HOOKS_DIR"/*.sh

# Create codeatlas wrapper
cat > "$CLAUDE_HOOKS_DIR/codeatlas" << 'WRAPPER_EOF'
#!/bin/bash
set -euo pipefail
HOOKS_DIR="/home/ubuntu/.claude/hooks"
export CODEATLAS_INJECT_BRAIN_CONTEXT="${CODEATLAS_INJECT_BRAIN_CONTEXT:-1}"
export CODEATLAS_API_URL="${CODEATLAS_API_URL:-http://localhost:3381}"
CMD="${1:-}"
if [ "$CMD" = "hook" ]; then
  CMD="${2:-}"
fi
case "$CMD" in
  brain-context) exec "$HOOKS_DIR/brain-context.sh" ;;
  brain-save) exec "$HOOKS_DIR/brain-save.sh" ;;
  task-router) exec "$HOOKS_DIR/task-router.sh" ;;
  *) echo "usage: codeatlas hook <brain-context|brain-save|task-router>" >&2; exit 2 ;;
esac
WRAPPER_EOF
chmod +x "$CLAUDE_HOOKS_DIR/codeatlas"

# Update settings.json with new hook registration format safely using python
say "Updating $SETTINGS with new hook configuration..."

if [ -f "$SETTINGS" ]; then
    cp "$SETTINGS" "$SETTINGS.bak"
    say "Backed up existing settings to $SETTINGS.bak"
else
    echo "{}" > "$SETTINGS"
fi

python3 - "$SETTINGS" <<'PY'
import json, sys

filepath = sys.argv[1]
with open(filepath, 'r') as f:
    try:
        settings = json.load(f)
    except json.JSONDecodeError:
        settings = {}

if 'hooks' not in settings:
    settings['hooks'] = {}

def get_hooks(event):
    v = settings['hooks'].get(event, [])
    if v and isinstance(v, list) and isinstance(v[0], dict) and 'hooks' in v[0]:
        return v[0]['hooks'] or []
    return v or []

def filter_hooks(hooks_list):
    res = []
    for h in hooks_list:
        if isinstance(h, str):
            if 'codeatlas' in h or '.sh' in h:
                continue
            res.append(h)
        elif isinstance(h, dict):
            cmd = h.get('command', '')
            if '/home/ubuntu/.claude/hooks/' in cmd and '.sh' in cmd:
                continue
            if not h.get('type') and cmd:
                h['type'] = 'command'
            res.append(h)
    return res

def set_hooks(event, hooks_list):
    settings['hooks'][event] = [{'hooks': hooks_list}]

for ev in list(settings['hooks'].keys()):
    if settings['hooks'][ev] and isinstance(settings['hooks'][ev], list):
        filtered = filter_hooks(get_hooks(ev))
        if filtered:
            set_hooks(ev, filtered)
        else:
            del settings['hooks'][ev]

# Apply codeatlas hooks
def ensure_hook(event, args):
    current = filter_hooks(get_hooks(event))
    for h in current:
        if h.get('command') == 'codeatlas' and h.get('args') and args[1] in h.get('args'):
            set_hooks(event, current)
            return
    current.append({"type": "command", "command": "codeatlas", "args": args})
    set_hooks(event, current)

ensure_hook("PreToolUse", ["hook", "task-router"])
ensure_hook("SessionStart", ["hook", "brain-context"])
ensure_hook("UserPromptSubmit", ["hook", "brain-context"])
ensure_hook("PostToolUse", ["hook", "brain-save"])
ensure_hook("PostToolUseFailure", ["hook", "brain-save"])

with open(filepath, 'w') as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PY

say "Copied hooks to $CLAUDE_HOOKS_DIR"
say "Created wrapper: codeatlas hook <name>"
say "Updated $SETTINGS with new nested CodeAtlas registration"
say "Done. Restart Claude to activate."
