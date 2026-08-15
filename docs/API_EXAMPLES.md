# API Examples

All examples use the MCP protocol. For SSE-based setups, replace `--transport stdio` with your SSE endpoint.

## Authentication

### API Key (Bearer Token)

```bash
# Set CODEATLAS_API_KEY in .env
# Clients send: Authorization: Bearer <your-api-key>
```

### Firebase (JWT)

```bash
# Set GOOGLE_APPLICATION_CREDENTIALS in .env
# Clients send: Authorization: Bearer <firebase-id-token>
```

---

## Dream Memory

### Save a memory

```json
{
  "tool": "save_dream_memory",
  "arguments": {
    "title": "Oracle ORA-12514 fix",
    "content": "Listener not registered with service name. Use SID format in TNS string or restart listener after service changes.",
    "memory_type": "MISTAKE",
    "tags": ["oracle", "database", "connection"],
    "scope": "project"
  }
}
```

### Query memories

```json
{
  "tool": "query_dream_memories",
  "arguments": {
    "query": "Oracle connection error",
    "limit": 5
  }
}
```

### Manage memories (list, update, delete)

```json
{
  "tool": "manage_dream_memory",
  "arguments": {
    "action": "list",
    "scope": "project"
  }
}
```

---

## Code Analysis

### Search entities (functions, classes)

```json
{
  "tool": "search_entities",
  "arguments": {
    "query": "initPool",
    "type": "function"
  }
}
```

### Get file entities

```json
{
  "tool": "get_file_entities",
  "arguments": {
    "file_path": "src/database/oracle.ts"
  }
}
```

### Get dependencies

```json
{
  "tool": "get_dependencies",
  "arguments": {
    "entity": "OracleRepository",
    "direction": "both"
  }
}
```

### Trace feature flow

```json
{
  "tool": "trace_feature_flow",
  "arguments": {
    "keyword": "authentication"
  }
}
```

### Get code snippet by name

```json
{
  "tool": "get_code_snippet",
  "arguments": {
    "function_name": "initPool",
    "context_lines": 10
  }
}
```

---

## Genome Search

### Search for patterns and solutions

```json
{
  "tool": "search_genome",
  "arguments": {
    "query": "rate limiting Express middleware"
  }
}
```

---

## Immune System

### Scan for failure patterns

```json
{
  "tool": "scan_immune_genes",
  "arguments": {
    "code": "const result = await db.execute(query + userInput);",
    "context": "SQL execution"
  }
}
```

---

## Architecture Diagrams

### System flow (Mermaid)

```json
{
  "tool": "generate_system_flow",
  "arguments": {
    "project_id": "my-project"
  }
}
```

### Feature flow (Mermaid)

```json
{
  "tool": "generate_feature_flow_diagram",
  "arguments": {
    "feature": "user authentication",
    "entry_point": "authMiddleware"
  }
}
```

---

## MCP Configuration Snippets

### Claude Desktop (stdio)

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "npx",
      "args": ["-y", "@giauphan/codeatlas-mcp"],
      "env": {
        "ORACLE_USER": "your_user",
        "ORACLE_PASSWORD": "your_password",
        "ORACLE_CONNECTION_STRING": "localhost:1521/ORCLPDB1"
      }
    }
  }
}
```

### Cursor / VSCode (SSE)

```json
{
  "mcpServers": {
    "codeatlas": {
      "type": "sse",
      "url": "https://mcp.your-domain.com/sse"
    }
  }
}
```

### With API Key

```json
{
  "mcpServers": {
    "codeatlas": {
      "type": "sse",
      "url": "https://mcp.your-domain.com/sse",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

---

## CLI Hooks (Optional)

The package includes optional CLI hooks for the UserPromptSubmit event.

### brain-context

Auto-retrieves relevant context before each user message:

```bash
npx @giauphan/codeatlas-mcp brain-context "How do I fix the authentication flow?"
```

### brain-save

Persists new knowledge after Claude responses:

```bash
npx @giauphan/codeatlas-mcp brain-save "KNOWLEDGE" "title" "content"
```

Configure in `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "npx @giauphan/codeatlas-mcp brain-context \"$CLAUDE_USER_PROMPT\""
          }
        ]
      }
    ]
  }
}
```
