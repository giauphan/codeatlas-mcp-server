#!/bin/bash
# =============================================================================
# brain-save.sh — Claude CLI hook: save dream memories after each turn
#
# Reads multi-turn context from current session's conversation JSONL,
# then calls ingest-session API for LLM-based dream extraction.
#
# v2: replaces keyword-classified single-line save with rich multi-turn
#     extraction via existing /api/dreams/ingest-session endpoint.
# =============================================================================
set -euo pipefail

LOCK="/tmp/claude-brain-save.lock"
LOG="$HOME/.claude/brain-save.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

API_KEY="${CODEATLAS_API_KEY:-}"
[ -z "$API_KEY" ] && exit 0

BASE="${CODEATLAS_API_URL:-http://localhost:3381}"
CLAUDE_PROJECTS="$HOME/.claude/projects"

# PostToolUse sends tool metadata and response as JSON on stdin.
HOOK_INPUT=$(python3 -c 'import sys; print(sys.stdin.read())' 2>/dev/null || true)
export HOOK_INPUT

# Determine outcome from the hook payload. PostToolUseFailure carries an error;
# Bash responses may also expose exit_code/exitCode.
OUTCOME_DATA=$(python3 -c '
import base64, json, os, sys

raw = os.environ.get("HOOK_INPUT", "")
try:
    payload = json.loads(raw)
except (json.JSONDecodeError, TypeError):
    sys.exit(0)

tool_name = payload.get("tool_name", "")
if tool_name in {"Read", "Grep", "Glob", "Find", "WebFetch", "WebSearch", "TodoWrite"}:
    sys.exit(0)

response = payload.get("tool_response", {})
if isinstance(response, dict):
    exit_code = response.get("exit_code", response.get("exitCode"))
    is_error = bool(response.get("is_error") or response.get("isError"))
    details = response.get("stderr") or response.get("error") or response.get("stdout") or response
else:
    exit_code = None
    is_error = False
    details = response

if payload.get("error") or payload.get("is_interrupt") or payload.get("isInterrupted"):
    is_error = True

if exit_code is not None:
    try:
        failed = int(exit_code) != 0
    except (TypeError, ValueError):
        failed = True
else:
    failed = is_error

if isinstance(details, (dict, list)):
    details = json.dumps(details, ensure_ascii=False)

tool_input = payload.get("tool_input", {})
if tool_name == "Bash" and isinstance(tool_input, dict):
    task = "Bash: " + str(tool_input.get("description", "command"))
elif tool_name in {"Edit", "Write", "NotebookEdit"} and isinstance(tool_input, dict):
    target = tool_input.get("file_path") or tool_input.get("notebook_path") or "file"
    task = f"{tool_name}: {os.path.basename(str(target))}"
else:
    task = tool_name

detail = f"exit code {exit_code}" if exit_code is not None else (str(payload.get("error")) if payload.get("error") else "tool completed")

def encode(value):
    return base64.b64encode(str(value)[:2000].encode()).decode()

print("|".join(("failure" if failed else "success", encode(task), encode(detail))))
' 2>/dev/null || true)

OUTCOME_RESULT=""
OUTCOME_TASK=""
OUTCOME_DETAILS=""
OUTCOME_TASK_B64=""
OUTCOME_DETAILS_B64=""
if [ -n "$OUTCOME_DATA" ]; then
  IFS='|' read -r OUTCOME_RESULT OUTCOME_TASK_B64 OUTCOME_DETAILS_B64 <<< "$OUTCOME_DATA"
  if [ -n "$OUTCOME_TASK_B64" ] && [ -n "$OUTCOME_DETAILS_B64" ]; then
    OUTCOME_TASK=$(printf '%s' "$OUTCOME_TASK_B64" | base64 -d 2>/dev/null || true)
    OUTCOME_DETAILS=$(printf '%s' "$OUTCOME_DETAILS_B64" | base64 -d 2>/dev/null || true)
  fi
fi

if [ -n "$OUTCOME_RESULT" ]; then
  PROJECT_NAME="${CODEATLAS_PROJECT:-hermes-auto}"
  export OUTCOME_RESULT OUTCOME_TASK OUTCOME_DETAILS PROJECT_NAME
  OUTCOME_PAYLOAD=$(python3 -c "
import json, os
payload = {
    'task': os.environ.get('OUTCOME_TASK', 'tool')[:2000],
    'result': os.environ.get('OUTCOME_RESULT', 'success'),
    'project': os.environ.get('PROJECT_NAME', 'hermes-auto'),
    'learnings': [os.environ.get('OUTCOME_DETAILS', 'tool completed')[:500]],
}
print(json.dumps(payload, ensure_ascii=False))
" 2>/dev/null || true)

  if [ -n "$OUTCOME_PAYLOAD" ]; then
    OUTCOME_RESP=$(curl --connect-timeout 3 --max-time 10 -s -X POST "$BASE/api/memory/outcome" \
      -H "x-api-key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$OUTCOME_PAYLOAD" 2>/dev/null || echo '{"error":"curl failed"}')
    OUTCOME_STATUS=$(printf '%s' "$OUTCOME_RESP" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('dreamId') or d.get('error') or d)" 2>/dev/null || echo "parse_error")
    log "outcome: $OUTCOME_RESULT $OUTCOME_TASK -> $OUTCOME_STATUS"
  else
    log "outcome: payload build failed"
  fi
fi

# Lock via atomic mkdir — prevent concurrent runs
LOCK_DIR="/tmp/claude-brain-save.lockdir"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # If lock directory exists and is < 15 seconds old, skip
  mtime=$(stat -c %Y "$LOCK_DIR" 2>/dev/null || stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0)
  now=$(date +%s)
  if [ $((now - mtime)) -lt 15 ]; then
    exit 0
  fi
  # Stale lock: clean and recreate
  rm -rf "$LOCK_DIR" 2>/dev/null
  mkdir "$LOCK_DIR" 2>/dev/null || exit 0
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

CLAUDE_PROJECTS="$HOME/.claude/projects"

# ── Step 1: Find current session's conversation file ──
# Pick the most recently written .jsonl under projects/ (not subagents/)
LATEST_CONVO=""
# Portable across GNU/BSD: ls -t sorts by mtime (newest first). -maxdepth bounds the scan.
for f in $(find "$CLAUDE_PROJECTS" -maxdepth 5 -name "*.jsonl" ! -path "*/subagents/*" -type f 2>/dev/null | xargs -r ls -t 2>/dev/null | head -3); do
  # Must have at least 10 lines and be recently modified (< 5 min)
  if [ -f "$f" ] && [ "$(wc -l < "$f" 2>/dev/null || echo 0)" -ge 10 ]; then
    LATEST_CONVO="$f"
    break
  fi
done

if [ -z "$LATEST_CONVO" ]; then
  log "No recent conversation file found"
  exit 0
fi

log "Reading conversation: $LATEST_CONVO"

# ── Step 2: Extract last N user+assistant message pairs ──
# Also extract model info and session_id from the convo
export BRAIN_SAVE_HISTORY_DEPTH="${BRAIN_SAVE_HISTORY_DEPTH:-8}"
TRANSCRIPT=$(python3 - "$LATEST_CONVO" <<'PYEOF'
import json, sys, os

filepath = sys.argv[1]
messages = []
session_id = None
model = None

with open(filepath) as f:
    for raw in f:
        raw = raw.strip()
        if not raw:
            continue
        try:
            line = json.loads(raw)
        except json.JSONDecodeError:
            continue

        # Skip non-message lines
        if line.get('isMeta'):
            continue
        if line.get('type') in ('mode', 'system', 'file-history-snapshot'):
            continue

        msg = line.get('message')
        if not msg or not msg.get('role') or not msg.get('content'):
            continue

        role = msg['role']
        if role not in ('user', 'assistant'):
            continue

        # Capture session_id and model from first occurrence
        if not session_id:
            session_id = line.get('sessionId') or line.get('session_id') or ''
        if not model and role == 'assistant':
            model = line.get('model', '')

        # Extract text content
        content = msg['content']
        if isinstance(content, list):
            text = ' '.join(c.get('text', '') if isinstance(c, dict) else str(c) for c in content)
        elif isinstance(content, str):
            # Skip user messages that are just internal commands
            if role == 'user' and any(tag in content for tag in ['<local-command-caveat>', '<command-name>', '<command-message>', '<local-command-stdout>', '<local-command-stderr>']):
                continue
            text = content
        else:
            continue

        if not text.strip() or len(text.strip()) < 30:
            continue

        messages.append({'role': role, 'content': text.strip()})

# Keep last N messages (N user+assistant pairs) — configurable via BRAIN_SAVE_HISTORY_DEPTH
depth = int(os.environ.get('BRAIN_SAVE_HISTORY_DEPTH', '8'))
msgs = messages[-depth:] if len(messages) > depth else messages

transcript = '\n\n---\n\n'.join(f'[{m[\"role\"].upper()}]\n{m[\"content\"]}' for m in msgs)
print(f'SESSION_ID:{session_id or \"unknown\"}')
print(f'MODEL:{model or \"Claude\"}')
print(f'COUNT:{len(msgs)}')
print('---TRANSCRIPT_BELOW---')
print(transcript)
PYEOF
)

[ -z "$TRANSCRIPT" ] && exit 0

# Parse the structured output
SESSION_ID=$(echo "$TRANSCRIPT" | grep '^SESSION_ID:' | head -1 | cut -d: -f2- || echo "unknown")
MODEL=$(echo "$TRANSCRIPT" | grep '^MODEL:' | head -1 | cut -d: -f2- || echo "Claude")
MSG_COUNT=$(echo "$TRANSCRIPT" | grep '^COUNT:' | head -1 | cut -d: -f2- || echo "0")
BODY=$(echo "$TRANSCRIPT" | sed '1,/^---TRANSCRIPT_BELOW---$/d')

[ -z "$BODY" ] && exit 0

log "Session: $SESSION_ID, Model: $MODEL, Messages: $MSG_COUNT"

# ── Step 3: Send to ingest-session API for LLM-based dream extraction ──
# Extract project name from the file path for better context
PROJECT_HINT=$(echo "$LATEST_CONVO" | sed -n 's|.*/projects/\([^/]*\)/.*|\1|p' | tr '-' '_' | sed 's/^_//')
[ -z "$PROJECT_HINT" ] && PROJECT_HINT="hermes_auto"

export BODY SESSION_ID PROJECT_HINT MODEL
PAYLOAD=$(python3 -c "
import json, os
body = os.environ.get('BODY', '')
print(json.dumps({
    'content': body,
    'session_id': os.environ.get('SESSION_ID', ''),
    'project': os.environ.get('PROJECT_HINT', ''),
    'provider': os.environ.get('MODEL', '')
}))
")

RESP=$(curl --connect-timeout 3 --max-time 15 -s -X POST "$BASE/api/dreams/ingest-session" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>/dev/null || echo '{"error":"curl failed"}')

DREAMS=$(echo "$RESP" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('dreamsExtracted', d.get('error','?')))" 2>/dev/null || echo "parse_error")
log "ingest-session: $DREAMS dreams extracted"
