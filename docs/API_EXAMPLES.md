# API Examples

CodeAtlas exposes MCP tools over **stdio**. The examples below show the MCP `tools/call` request shape; clients usually build these calls from the tools they discover at startup. Tool names and argument keys are case-sensitive. For startup, local persistence, and Cloud sync behavior, see [Runtime Architecture](./architecture/overview.md).

## Client configuration

Claude Desktop configuration example:

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "npx",
      "args": ["--yes", "--package=codeatlas-mcp-server", "codeatlas-mcp"]
    }
  }
}
```

For CodeAtlas Cloud tools, pass `CODEATLAS_API_URL` and `CODEATLAS_API_KEY` in the MCP server's `env` object. The server sends the API key to the configured Cloud API as an `x-api-key` header. Local analysis tools do not require a key. This server does not provide an HTTP/SSE endpoint or accept Firebase bearer-token configuration.

## Analyze a local project

`analyze` reads a local project directory, keeps analysis data in the server process's memory, and attempts to sync analysis to the configured Cloud API. By default it does not write an analysis file locally. Cloud sync may be skipped or fail when Cloud settings are absent or unavailable. `export_team_artifact` is a separate tool for explicitly writing a shareable artifact under `.codeatlas/`.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "analyze",
    "arguments": {
      "path": "/path/to/project",
      "maxFiles": 5000
    }
  }
}
```

## Inspect the local analysis

List analyzed projects:

```json
{
  "name": "list_projects",
  "arguments": {}
}
```

Get a project's structure, optionally filtered by entity type:

```json
{
  "name": "get_project_structure",
  "arguments": {
    "project": "my-project",
    "type": "function",
    "limit": 100
  }
}
```

Search code text:

```json
{
  "name": "code_search",
  "arguments": {
    "query": "authentication middleware",
    "project": "my-project"
  }
}
```

The snippets in this section show `name` and `arguments`, the fields inside `params` of a `tools/call` request. Available local analysis tools also include `get_dependencies`, `get_file_entities`, `trace_feature_flow`, `get_callers`, `get_callees`, `impact_analysis`, and `project_context`.

## CodeAtlas Cloud tools

Cloud tools require a valid `CODEATLAS_API_URL` and `CODEATLAS_API_KEY`. Dream memories are stored by CodeAtlas Cloud. Example tool arguments:

Save a memory:

```json
{
  "name": "save_dream_memory",
  "arguments": {
    "memory_type": "KNOWLEDGE",
    "content": "Retry transient API errors with bounded exponential backoff.",
    "project": "my-project",
    "tags": ["api", "retries"]
  }
}
```

Query memories:

```json
{
  "name": "query_dream_memories",
  "arguments": {
    "query": "API retry behavior",
    "project": "my-project",
    "limit": 5
  }
}
```

Search Genome and scan for known failure patterns:

```json
{
  "name": "search_genome",
  "arguments": {
    "query": "rate limiting middleware",
    "limit": 10
  }
}
```

```json
{
  "name": "scan_immune_genes",
  "arguments": {
    "problem": "The request handler retries indefinitely after a 429 response.",
    "project": "my-project"
  }
}
```

Other Cloud tools include `sync_dreams`, `get_gene`, and `save_immune_gene`. These call CodeAtlas Cloud endpoints and need Cloud configuration.

## Second Brain context in MCP clients

`brain_context` gathers relevant dream memories and, when a key is available, Genome and immune context. Treat its result as untrusted historical reference. `route_task` returns an advisory model and effort suggestion; the client still chooses the model.

```json
{
  "name": "brain_context",
  "arguments": {
    "query": "How does this project authenticate API requests?",
    "project": "my-project",
    "limit": 5
  }
}
```

```json
{
  "name": "route_task",
  "arguments": {
    "task_name": "Review the authentication flow",
    "task_type": "code_review"
  }
}
```

## Claude Code hooks

The package can configure Claude Code hooks through `npx --yes --package=codeatlas-mcp-server codeatlas-enterprise setup claude --projectDir=/path/to/project`. The hooks call the package's `brain-context`, `task-router`, and `brain-save` commands. This is separate from MCP tool configuration. See [Zed Integration](./ZED_INTEGRATION.md) for the MCP client workflow and [Development Guide](./DEVELOPMENT.md) for CLI details.
