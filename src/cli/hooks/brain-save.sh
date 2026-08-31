#!/bin/bash
# =============================================================================
# brain-save.sh — Claude hook: save dream memories (PROJECT-SCOPED v4)
#
# Fixes canonical project folder resolution:
#  - Claude CLI stores session files under ~/.claude/projects/-path-to-project
#    (e.g., /home/ubuntu/codeatlas-platform -> -home-ubuntu-codeatlas-platform)
#  - Derives exact project directory from payload `cwd` or PWD.
#  - Restricts JSONL search EXCLUSIVELY to that project folder.
#  - NEVER scans globally across other projects.
#  - NEVER falls back to hardcoded project names like "hermes_auto".
# =============================================================================
set -euo pipefail

LOCK="/tmp/claude-brain-save.lock"
LOG="$HOME/.claude/brain-save.log"
LAST_FILE="/tmp/claude-brain-save-last.txt"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

API_KEY="${CODEATLAS_API_KEY:-}"
[ -z "$API_KEY" ] && exit 0

BASE="${CODEATLAS_API_URL:-}"
[ -n "$BASE" ] || exit 0
CLAUDE_PROJECTS="$HOME/.claude/projects"

# PostToolUse sends tool metadata and response as JSON on stdin.
HOOK_INPUT="$(cat 2>/dev/null || true)"
export HOOK_INPUT

# ── Resolve project scope & canonical session folder EXCLUSIVELY from current dir ──
PARSED_ENV=$(python3 <<'PY'
import json, os, sys

raw = os.environ.get("HOOK_INPUT", "")
payload = {}
if raw:
    try:
        payload = json.loads(raw)
    except Exception:
        pass

cwd = payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
sid = payload.get("session_id") or payload.get("sessionId") or ""
tool_name = payload.get("tool_name", "")

# Claude Code worktrees live under <project>/.claude/worktrees/<name>, while
# session JSONL files remain in the base project folder. Collapse worktree cwd
# to the base project before deriving Claude's project-folder slug.
marker = "/.claude/worktrees/"
base_cwd = cwd.split(marker, 1)[0] if marker in cwd else cwd

# Canonical folder name in ~/.claude/projects/
# e.g., /home/ubuntu/codeatlas-platform -> -home-ubuntu-codeatlas-platform
folder_name = base_cwd.replace("/", "-")

# Short project name for API calls e.g., codeatlas_platform
project_hint = os.path.basename(base_cwd.rstrip("/")).replace("-", "_")

print(f"{folder_name}|{project_hint}|{sid}|{tool_name}")
PY
)

[ -z "$PARSED_ENV" ] && { log "skip: failed to parse stdin"; exit 0; }

IFS='|' read -r FOLDER_NAME PROJECT_HINT SESSION_ID_ENV TOOL_NAME <<< "$PARSED_ENV"

# Guard against root/home/tmp invalid directories
case "$PROJECT_HINT" in
  ""|home|root|ubuntu|tmp|config|etc|var) { log "skip: invalid project scope ($PROJECT_HINT)"; exit 0; } ;;
esac

# Save only for meaningful write/execute tools; skip read-only noise.
case "$TOOL_NAME" in
  Read|Grep|Glob|Find|WebFetch|WebSearch|TodoWrite|ListAgents|TaskOutput|""|"-") exit 0 ;;
esac

PROJ_DIR="$CLAUDE_PROJECTS/$FOLDER_NAME"
if [ ! -d "$PROJ_DIR" ]; then
  # Fallback: search for folder matching trailing name if exact slug missing
  PROJ_DIR=$(find "$CLAUDE_PROJECTS" -maxdepth 1 -type d \( -name "*$PROJECT_HINT*" -o -name "*${PROJECT_HINT//_/-}*" \) 2>/dev/null | head -n1 || true)
fi

[ -z "$PROJ_DIR" ] || [ ! -d "$PROJ_DIR" ] && { log "skip: project dir not found ($FOLDER_NAME)"; exit 0; }

# ── Locate conversation file: ONLY inside this project's folder ──
CONVO=""
if [ -n "$SESSION_ID_ENV" ] && [ -f "$PROJ_DIR/${SESSION_ID_ENV}.jsonl" ]; then
  CONVO="$PROJ_DIR/${SESSION_ID_ENV}.jsonl"
else
  # Most recent .jsonl inside THIS project directory
  CONVO=$(find "$PROJ_DIR" -maxdepth 1 -type f -name "*.jsonl" ! -path "*/subagents/*" -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | awk '{print $2}')
fi

[ -z "$CONVO" ] || [ ! -f "$CONVO" ] && { log "skip: no conversation file in $PROJ_DIR"; exit 0; }

# Lock 15s — prevent concurrent runs
if [ -f "$LOCK" ] && [ "$(($(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || echo 0)))" -lt 15 ]; then
  exit 0
fi
echo "$$" > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

# ── Extract last N user+assistant message pairs from project session file ──
TRANSCRIPT=$(python3 - "$CONVO" <<'PY'
import json, sys

filepath = sys.argv[1]
messages = []
session_id = None
model = None

try:
    with open(filepath) as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            try:
                line = json.loads(raw)
            except json.JSONDecodeError:
                continue

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

            if not session_id:
                session_id = line.get('sessionId') or line.get('session_id') or ''
            if not model and role == 'assistant':
                model = line.get('model', '')

            content = msg['content']
            if isinstance(content, list):
                text = ' '.join(c.get('text', '') if isinstance(c, dict) else str(c) for c in content)
            elif isinstance(content, str):
                if role == 'user' and any(tag in content for tag in ['<local-command-caveat>', '<command-name>', '<command-message>', '<local-command-stdout>', '<local-command-stderr>']):
                    continue
                text = content
            else:
                continue

            if not text.strip() or len(text.strip()) < 30:
                continue

            messages.append({'role': role, 'content': text.strip()})
except Exception:
    pass

msgs = messages[-8:] if len(messages) > 8 else messages

transcript = '\n\n---\n\n'.join(f'[{m["role"].upper()}]\n{m["content"]}' for m in msgs)
print(f'SESSION_ID:{session_id or "unknown"}')
print(f'MODEL:{model or "Claude"}')
print(f'COUNT:{len(msgs)}')
print('---TRANSCRIPT_BELOW---')
print(transcript)
PY
2>/dev/null || true)

[ -z "$TRANSCRIPT" ] && exit 0

SESSION_ID=$(echo "$TRANSCRIPT" | grep '^SESSION_ID:' | head -1 | cut -d: -f2- || echo "unknown")
MODEL=$(echo "$TRANSCRIPT" | grep '^MODEL:' | head -1 | cut -d: -f2- || echo "Claude")
MSG_COUNT=$(echo "$TRANSCRIPT" | grep '^COUNT:' | head -1 | cut -d: -f2- || echo "0")
BODY=$(echo "$TRANSCRIPT" | sed '1,/^---TRANSCRIPT_BELOW---$/d')

[ -z "$BODY" ] && exit 0

# Idempotency is session-specific. A single global marker caused concurrent
# Claude sessions to overwrite each other and skip valid ingestion.
SAFE_SESSION=$(printf '%s' "$SESSION_ID" | tr -cd '[:alnum:]_-')
SESSION_LAST_FILE="${LAST_FILE%.txt}-${SAFE_SESSION:-unknown}.txt"
last=""
[ -f "$SESSION_LAST_FILE" ] && last=$(cat "$SESSION_LAST_FILE" 2>/dev/null || true)
if [ "$last" = "$MSG_COUNT" ]; then
  exit 0
fi
echo "$MSG_COUNT" > "$SESSION_LAST_FILE"

log "Session: $SESSION_ID, Model: $MODEL, Messages: $MSG_COUNT, Project: $PROJECT_HINT"

# ── Send to ingest-session API ──
export BODY PROJECT_HINT SESSION_ID MODEL
PAYLOAD=$(python3 -c '
import json, os
print(json.dumps({
    "content": os.environ.get("BODY", ""),
    "session_id": os.environ.get("SESSION_ID", "unknown"),
    "project": os.environ.get("PROJECT_HINT", ""),
    "provider": os.environ.get("MODEL", "Claude")
}))
')

RESP=$(curl --max-time 15 -s -X POST "$BASE/api/dreams/ingest-session" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>/dev/null || echo '{"error":"curl failed"}')

DREAMS=$(echo "$RESP" | python3 -c 'import sys,json; d=json.loads(sys.stdin.read()); print(d.get("dreamsExtracted", d.get("error","?")))' 2>/dev/null || echo "parse_error")
log "ingest-session [$PROJECT_HINT]: $DREAMS dreams extracted"