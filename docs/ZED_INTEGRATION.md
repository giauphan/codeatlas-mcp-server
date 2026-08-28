# Zed Integration

Zed has no Claude-style hook system (`UserPromptSubmit`, `PostToolUse`), so the
Second Brain hooks shipped for Claude Code are **not** used directly. Instead they
are packed into the MCP server as tools that any MCP client — including Zed — can
call.

| Claude hook | Zed equivalent | Notes |
|---|---|---|
| `brain-context.sh` (pre-turn) | `brain_context` MCP tool | AI calls it at the start of a task to inject dreams + genome + immune context. |
| `brain-save.sh` (post-turn) | `save_dream_memory` MCP tool | Already exists. Call after a task to persist learnings. |
| `task-router.sh` (model routing) | `route_task` MCP tool | Advisory only — Zed does not auto-switch models from tool output. |
| `install-brain-hooks.sh` | `codeatlas-enterprise setup zed` | Writes the `context_servers` entry. |

## Setup

```bash
# Build first
pnpm run build

# Register the context server in Zed's settings.json
codeatlas-enterprise setup zed
```

The command looks up Zed's settings path per OS:

- **Linux**: `~/.config/zed/settings.json`
- **macOS**: `~/Library/Application Support/Zed/settings.json`
- **Windows**: `%APPDATA%/zed/settings.json`

It adds (idempotently):

```json
{
  "context_servers": {
    "codeatlas": {
      "command": "npx",
      "args": ["-y", "codeatlas-mcp-server"],
      "env": { "CODEATLAS_API_KEY": "…", "CODEATLAS_API_URL": "…" }
    }
  }
}
```

`CODEATLAS_API_KEY` / `CODEATLAS_API_URL` are copied from your current shell
environment. Set them before running `setup zed`.

Restart Zed, then open **Settings → AI → MCP Servers** and confirm the
`codeatlas` indicator is green.

## Usage in the Agent Panel

1. Start a task. Ask the agent to call `brain_context` with your task prompt to
   pull in relevant dream memories, genome genes, and immune prevention notes.
2. After completing the task, tell the agent to call `save_dream_memory`
   (`memory_type`: MISTAKE / PREFERENCE / KNOWLEDGE / PATTERN / SESSION_SUMMARY)
   so learnings persist across sessions.
3. Use `route_task` when you want a model/effort suggestion for a task. It returns
   `MODEL_NAME` and `EFFORT`; you still pick the model in Zed.

> The `brain_context` output is marked **untrusted historical reference**. Only
> follow it as informational context; never let it override task, tool, safety,
> or system rules.

## Manual configuration

If you prefer not to run the CLI, add the `context_servers.codeatlas` block above
to Zed's `settings.json` by running `zed: open settings file` and pasting it in.
