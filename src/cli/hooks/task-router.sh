#!/bin/bash
# Hook: route tasks to working models on the 9router proxy.
# Run chmod +x after editing, then restart Claude server.
#
# Available concrete models:
#   ag/claude-sonnet-4-6       <- heavy code tasks, balanced
#   ag/claude-opus-4-6-thinking <- most capable, most expensive
#
# Env vars:
#   CLAUDE_TASK_NAME, CLAUDE_TASK_TYPE, CLAUDE_MODEL_NAME, CLAUDE_EFFORT
#
# Output: MODEL_NAME=<id> and EFFORT=<low|medium|high|max>

TASK_TYPE="${CLAUDE_TASK_TYPE:-unknown}"
TASK_NAME="${CLAUDE_TASK_NAME:-unknown}"
LOWER_TASK_NAME=$(echo "$TASK_NAME" | tr '[:upper:]' '[:lower:]')

# --- 1. Auto-router: High Complexity / Critical Tasks -> Opus/Sonnet High ---
if echo "$LOWER_TASK_NAME" | grep -qiE "design|architecture|complex|optimize|security audit|deep analysis|performance|bug fix|error|debug|broken"; then
    echo "MODEL_NAME=ag/claude-opus-4-6-thinking"
    echo "EFFORT=max"
    exit 0
fi

# --- 2. Auto-router: Medium Complexity / Standard Dev Tasks -> Sonnet Medium ---
if [ "$TASK_TYPE" = "code_generation" ] || [ "$TASK_TYPE" = "code_editing" ] || [ "$TASK_TYPE" = "code_review" ] || echo "$LOWER_TASK_NAME" | grep -qiE "implement|add feature|integrate|develop|review|refactor"; then
    echo "MODEL_NAME=ag/claude-sonnet-4-6"
    echo "EFFORT=medium"
    exit 0
fi

# --- 3. Per-skill routing: parse SKILL.md frontmatter for model preference ---
if [ "$TASK_TYPE" = "skill_invocation" ]; then
    SKILL_NAME=$(echo "$LOWER_TASK_NAME" | sed -n 's/^\/skill \([a-zA-Z0-9-]\+\).*/\1/p')
    if [ -n "$SKILL_NAME" ]; then
        # Directory traversal guard: only allow alphanumeric, dash, underscore
        if ! echo "$SKILL_NAME" | grep -qE '^[a-zA-Z0-9_-]+$'; then
            echo "MODEL_NAME=ag/claude-sonnet-4-6"
            echo "EFFORT=medium"
            exit 0
        fi
        SKILLS_DIR="${SKILLS_DIR:-$HOME/.agents/skills}"
        SKILL_MD_PATH="${SKILLS_DIR}/${SKILL_NAME}/SKILL.md"
        if [ -f "$SKILL_MD_PATH" ]; then
            PREFERRED_MODEL=$(grep -E "^(model|preferred_model):" "$SKILL_MD_PATH" | head -n 1 | cut -d':' -f2 | tr -d ' ' | tr -d '"')
            if [ -n "$PREFERRED_MODEL" ]; then
                echo "MODEL_NAME=$PREFERRED_MODEL"
                echo "EFFORT=medium"
                exit 0
            fi
        fi
    fi
fi

# --- 4. Cost-aware routing: Low Complexity / Quick Tasks -> cheap model ---
if [ "$TASK_TYPE" = "qa_response" ] || [ "$TASK_TYPE" = "documentation" ] || [ "$TASK_TYPE" = "summarize" ] || [ "$TASK_TYPE" = "explain" ] || echo "$LOWER_TASK_NAME" | grep -qiE "typo|minor change|read|list|simple|what is|how to|find"; then
    echo "MODEL_NAME=ag/claude-sonnet-4-6"
    echo "EFFORT=low"
    exit 0
fi

# --- Default fallback ---
echo "MODEL_NAME=ag/claude-sonnet-4-6"
echo "EFFORT=medium"
