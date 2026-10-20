# Memory pipeline operations

CodeAtlas stores a canonical `project_id` for project scoping. The legacy `project` field and `display_name` are labels; `workspace_path` is transport metadata for alias auditing. Git worktrees and symlink paths resolve to the same project ID. Set `CODEATLAS_PROJECT_ID` only when a stable ID is managed explicitly; `CODEATLAS_PROJECT` changes the display label.

## Claude hooks

Install or upgrade routes with `codeatlas setup-hook`. The installer adds CodeAtlas routes while retaining other hook groups and permission rules. All entrypoints (`setup-hook`, `setup claude`, npm setup, and legacy shell/Python installers) share one merger and preserve matcher groups and deny rules. Installed native hook command strings bind the Node executable and compiled CLI path; reinstall after relocating the package. Shell compatibility bridges also accept `CODEATLAS_CLI_PATH`. Hook assets are installed under `~/.claude/hooks/`.

Capture hooks queue redacted evidence durably before sending it. `Stop` and `PreCompact` read only the matching Claude session transcript beneath `~/.claude/projects/<encoded-workspace>/<session-id>.jsonl`. The transcript path and session ID must match. Local queues and traces live under `~/.codeatlas/` with restrictive permissions.

The session spool keeps a local transcript read cursor separate from its backend acknowledgment cursor. Retryable transport, authentication/configuration, rate-limit, and server failures retain the event and use bounded exponential backoff without dropping it. A permanent event rejection or mismatched acknowledgment is copied to a private `quarantine.json` with credential patterns redacted; later events continue to dispatch, while the backend cursor remains before that unresolved gap. The local read cursor may continue so later transcript events are not replayed indefinitely. Inspect the quarantine payload and reason locally before resolving it; never move the backend cursor past quarantined data manually.

Context injection is opt-in. Set `CODEATLAS_INJECT_BRAIN_CONTEXT=1` in the trusted hook environment to allow SessionStart and UserPromptSubmit context output. Claude receives a bounded `hookSpecificOutput.additionalContext` packet labelled as untrusted historical evidence. If the host has no lifecycle hooks, call the `memory_bootstrap` MCP tool; it returns the latest checkpoint to the agent as a tool result and explicitly reports `automatic_injection: false`.

## Diagnostics and rollback

Run `codeatlas doctor hooks --json` for machine-readable diagnostics. It reports hook registration, executable availability and resolved path, endpoint/key presence booleans, canonical project ID/source, and the latest save/load outcome codes. It never includes API key values, request content, checkpoint text, or endpoint URLs. Structured per-event traces are written to `~/.codeatlas/memory-pipeline-events.jsonl`; they contain status/reason codes, trace ID, project ID, and packet character count only.

Useful controls:

- `CODEATLAS_DURABLE_CAPTURE=0` keeps new capture durably queued and disables dispatch. Re-enable it to drain the queue.
- `CODEATLAS_INJECT_BRAIN_CONTEXT=0` or leaving it unset disables hook context output while capture continues.
- `CODEATLAS_CONTEXT_SUPPRESS_DUPLICATES=0` disables same-session unchanged-packet suppression.
- `CODEATLAS_CONTEXT_MAX_CHARS` sets the context budget from 500 to 20,000 characters; the default is 6,000.
- `CODEATLAS_HOOK_TOOLS_ALLOWLIST` optionally narrows capture to comma-separated tool names; `CODEATLAS_HOOK_TOOLS_DENYLIST` excludes tools, and deny rules take precedence.

The decoder also excludes sensitive source paths and redacts common credential forms before writing local spool files or sending requests. Hook registration alone does not establish pipeline health; use the JSON doctor outcomes and an end-to-end capture/retrieval check.

Retrieval distinguishes `ok`, `empty`, `no_match`, `filtered`, `auth_error`, `transport_error`, and `backend_error`. Partial provider failures remain observable even when another source supplies useful context. Request bodies and backend error bodies are excluded from diagnostics. Claude command hooks use a quoted complete shell command for compatibility; current hosts also support exec-form `command` plus `args` ([Claude hook reference](https://code.claude.com/docs/en/hooks#command-hook-fields)).
