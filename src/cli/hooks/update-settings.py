import json
import sys
import os

filepath = sys.argv[1]
try:
    with open(filepath, 'r') as f:
        settings = json.load(f)
except Exception:
    settings = {}

if not isinstance(settings, dict):
    settings = {}

if 'hooks' not in settings or not isinstance(settings.get('hooks'), dict):
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
