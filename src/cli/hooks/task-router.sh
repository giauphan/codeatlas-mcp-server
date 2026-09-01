#!/bin/bash
# Hook: route tasks to working models on the 9router proxy.
# For CLI tool processing, reads stdin JSON and returns structured tool info.
# Run chmod +x after editing, then restart Claude server.
#
# Available concrete models:
#   ag/claude-sonnet-4-6       <- heavy code tasks, balanced
#   ag/claude-opus-4-6-thinking <- most capable, most expensive
#
# Can receive data via stdin (JSON with tool, description) or via env vars:
#   CLAUDE_TASK_NAME, CLAUDE_TASK_TYPE, CLAUDE_MODEL_NAME, CLAUDE_EFFORT
#
# Output: For tool processing mode: JSON with tool_name, arguments, description
#         For task routing mode: MODEL_NAME=<id> and EFFORT=<low|medium|high|max>

HOOK_INPUT="$(cat 2>/dev/null || true)"

# Check if this is a tool processing request (has tool field in input)
if echo "$HOOK_INPUT" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    if "tool" in data or "tool_name" in data:
        print("true")
    else:
        print("false")
except:
    print("false")
' 2>/dev/null | grep -q "true"; then

  # Tool processing mode: parse the input and return structured JSON
  python3 - "$HOOK_INPUT" <<'PY'
import json, sys

def main():
    input_str = sys.argv[1]
    try:
        data = json.loads(input_str)
    except json.JSONDecodeError:
        data = {}
    
    tool = data.get("tool") or data.get("tool_name", "")
    
    # Extract arguments (remove tool-specific fields)
    arguments = {}
    if "path" in data:
        arguments["path"] = data["path"]
    if "pattern" in data:
        arguments["pattern"] = data["pattern"]
    if "arguments" in data:
        arguments.update(data["arguments"])
    
    description = data.get("description", "")
    
    result = {
        "tool_name": tool,
        "arguments": arguments
    }
    if description:
        result["description"] = description
    
    print(json.dumps(result))

if __name__ == "__main__":
    main()
PY
  exit 0
fi

# Task routing mode: use env vars for model routing
TASK_TYPE="${CLAUDE_TASK_TYPE:-unknown}"
TASK_NAME="${CLAUDE_TASK_NAME:-unknown}"
LOWER_TASK_NAME=$(echo "$TASK_NAME" | tr '[:upper:]' '[:lower:]')

# --- 1. Auto-router: High Complexity / Critical Tasks -> Opus/Sonnet High ---
if echo "$LOWER_TASK_NAME" | grep -qF -e "design" -e "architecture" -e "complex" -e "optimize" -e "security audit" -e "deep analysis" -e "performance" -e "bug fix" -e "error" -e "debug" -e "broken"; then
    echo "MODEL_NAME=ag/claude-opus-4-6-thinking"
    echo "EFFORT=max"
    exit 0
fi

# --- 2. Auto-router: Medium Complexity / Standard Dev Tasks -> Sonnet Medium ---
if [ "$TASK_TYPE" = "code_generation" ] || [ "$TASK_TYPE" = "code_editing" ] || [ "$TASK_TYPE" = "code_review" ] || echo "$LOWER_TASK_NAME" | grep -qF -e "implement" -e "add feature" -e "integrate" -e "develop" -e "review" -e "refactor"; then
    echo "MODEL_NAME=ag/claude-sonnet-4-6"
    echo "EFFORT=medium"
    exit 0
fi

# --- 3. Per-skill routing: parse SKILL.md frontmatter for model preference ---
if [ "$TASK_TYPE" = "skill_invocation" ]; then
    SKILL_NAME=$(echo "$LOWER_TASK_NAME" | sed -n 's|^/skill \([a-zA-Z0-9-]\+\).*|\1|p')
    if [ -n "$SKILL_NAME" ]; then
        # Directory traversal guard: only allow alphanumeric, dash, underscore
        if ! echo "$SKILL_NAME" | grep -qE '^[a-zA-Z0-9_-]+$'; then
            echo "MODEL_NAME=ag/claude-sonnet-4-6"
            echo "EFFORT=medium"
            exit 0
        fi
        SKILLS_DIR="${SKILLS_DIR:-$HOME/.agents/skills}"
        # Canonicalize SKILLS_DIR to prevent path traversal via env override
        # realpath -e is GNU; use readlink -f as BSD/macOS fallback
        if ! SKILLS_DIR="$(realpath -e "$SKILLS_DIR" 2>/dev/null || readlink -f "$SKILLS_DIR" 2>/dev/null)"; then
            echo "MODEL_NAME=ag/claude-sonnet-4-6"
            echo "EFFORT=medium"
            exit 0
        fi
        SKILL_MD_PATH="${SKILLS_DIR}/${SKILL_NAME}/SKILL.md"
        # Extra guard: ensure SKILL_MD_PATH is inside SKILLS_DIR
        if [ "${SKILL_MD_PATH#$SKILLS_DIR/}" = "${SKILL_MD_PATH}" ]; then
            echo "MODEL_NAME=ag/claude-sonnet-4-6"
            echo "EFFORT=medium"
            exit 0
        fi
        if [ -f "$SKILL_MD_PATH" ]; then
            PREFERRED_MODEL=$(grep -E "^(model|preferred_model)[[:space:]]*:" "$SKILL_MD_PATH" | head -n 1 | cut -d':' -f2 | tr -d ' ' | tr -d '"')
            if [ -n "$PREFERRED_MODEL" ]; then
                echo "MODEL_NAME=${PREFERRED_MODEL}"
                echo "EFFORT=high"
                exit 0
            fi
        fi
    fi
fi

# --- 4. Cost-aware routing: Low Complexity / Quick Tasks -> cheap model ---
if [ "$TASK_TYPE" = "qa_response" ] || [ "$TASK_TYPE" = "documentation" ] || [ "$TASK_TYPE" = "summarize" ] || [ "$TASK_TYPE" = "explain" ] || echo "$LOWER_TASK_NAME" | grep -qF -e "typo" -e "minor change" -e "read" -e "list" -e "simple" -e "what is" -e "how to" -e "find"; then
    echo "EFFORT=low"
fi

# Default fallback
if [ "$MODEL_NAME" = "" ]; then
    echo "MODEL_NAME=ag/claude-sonnet-4-6"
fi
if [ "$EFFORT" = "" ]; then
    echo "EFFORT=medium"
fi