# CodeAtlas MCP Server

Local-first MCP server for AI-powered codebase intelligence — AST analysis, dependency graphs, and semantic search. Your source code never leaves your machine.

[![CI](https://github.com/giauphan/codeatlas-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/giauphan/codeatlas-mcp-server/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub Release](https://img.shields.io/github/v/release/giauphan/codeatlas-mcp-server)](https://github.com/giauphan/codeatlas-mcp-server/releases)

## 📌 What is CodeAtlas MCP Server?

A **Model Context Protocol (MCP)** server that provides:
- **AST Analysis**: Parse TypeScript, Python, PHP, and more.
- **Dependency Graphs**: Visualize call chains and module relationships.
- **Semantic Search**: Find code by meaning, not just syntax.
- **Local-First**: Your code stays on your machine; no telemetry by default.
- **Cloud Optional**: Connect to [codeatlas-platform](https://github.com/giauphan/codeatlas-platform) for dream memory, genome immune system, and skills sync.

### Why Use It?
| Use Case | Benefit |
|---|---|
| **AI IDE Integration** | Claude Desktop, Cursor, VSCode — get context-aware code intelligence. |
| **Codebase Audits** | Automate dependency analysis, security scans, and refactoring insights. |
| **Semantic Search** | Find functions, classes, or modules by intent, not just name. |
| **Multi-Language Support** | Works with TypeScript, Python, PHP, and more via AST parsers. |

---

## 🏗 Architecture

```
AI IDE → MCP stdio/SSE → Parser (AST) → Dependency Graph → Code Search
                          │
                    codeatlas-platform (HTTP) → Dreams + Genome
```

| Layer | Components |
|---|---|
| **Parser** | TypeScript, Python, PHP AST analysis |
| **Graph** | Dependency graph with chunked force layout |
| **Search** | Semantic code search with regex safety |
| **Cloud** | Optional: connect to codeatlas-platform for dreams/genome |

---

## 🔧 Quick Start

### 1. Install
```bash
# Clone the repo
git clone https://github.com/giauphan/codeatlas-mcp-server.git
cd codeatlas-mcp-server

# Install dependencies (requires Node.js 20+)
pnpm install
```

### 2. Configure
```bash
# Copy env template
cp .env.example .env

# Edit .env (Oracle DB optional for persistent memory)
# Set CODEATLAS_API_URL and CODEATLAS_API_KEY if using cloud
```

### 3. Build
```bash
pnpm run build
```

### 4. Run
```bash
# Local-only mode (no cloud)
pnpm start

# With cloud connection (requires codeatlas-platform running)
CODEATLAS_API_URL=http://localhost:8080 CODEATLAS_API_KEY=your_api_key_here pnpm start
```

---

## 📡 MCP Tools (30+)

| Category | Tools |
|---|---|
| **Code Analysis** | `analyze_project`, `code_search`, `file_info` |
| **AST** | `parse_file`, `find_symbol`, `get_dependencies` |
| **Graphs** | `dependency_graph`, `call_graph` |
| **Security** | `scan_vulnerabilities` |
| **Cloud** | `save_dream_memory`, `query_dream_memories`, `sync_dreams` |
| **Skills** | `search_skills`, `get_skill`, `install_skill` |

### Example: Connect to Claude Desktop
Add to `claude-desktop-config.json`:
```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "npx",
      "args": [
        "-y",
        "codeatlas-mcp-server"
      ]
    }
  }
}
```

### Example: Connect to Cursor/VSCode (SSE)
Add to `settings.json`:
```json
{
  "mcp.sse": {
    "codeatlas": "npx codeatlas-mcp-server"
  }
}
```

### Connect to Zed (MCP context server)
Zed has no Claude-style hooks, so the Second Brain hooks are exposed as MCP tools instead.

**Option A — automatic setup:**
```bash
codeatlas-enterprise setup zed
```
This writes a `codeatlas` entry into Zed's `context_servers` (passing `CODEATLAS_API_KEY`/`CODEATLAS_API_URL` from your environment). Restart Zed afterward.

**Option B — manual:** add to Zed `settings.json` (open via `zed: open settings file`):
```json
{
  "context_servers": {
    "codeatlas": {
      "command": "npx",
      "args": ["-y", "codeatlas-mcp-server"],
      "env": { "CODEATLAS_API_KEY": "your_api_key_here" }
    }
  }
}
```

Then in Zed's Agent Panel, call the `brain_context` tool at the start of a task to inject Second Brain memory, and `save_dream_memory` after a task to persist learnings. `route_task` suggests a model/effort (advisory only — Zed does not auto-switch models). See [Zed Integration](./docs/ZED_INTEGRATION.md).

---

## 📚 Documentation

| Guide | Description |
|---|---|
| [Development Guide](./docs/DEVELOPMENT.md) | Full environment setup, commands, and troubleshooting. |
| [Deployment Guide](./docs/DEPLOYMENT.md) | PM2, systemd, Nginx TLS, and healthchecks. |
| [API Examples](./docs/API_EXAMPLES.md) | Auth, dream memory, and MCP config examples. |

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## 📜 License

MIT © [Giau Phan](mailto:giauphan012@gmail.com)

---

## 🔗 Related Projects

- [codeatlas-platform](https://github.com/giauphan/codeatlas-platform) — HTTP server for dream memory and genome.
- [codeatlas-mcp](https://www.npmjs.com/package/codeatlas-mcp) — npm package for easy installation.

---

## ⚠️ Known Limitations

- **Oracle DB Required for Persistent Memory**: Local-only mode works without Oracle, but dream memory persistence requires it.
- **Cloud Dream Query Filters**: When querying memories with `scope`, `tags`, or `memory_type` filters, the backend performs vector hybrid search on the query text plus SQL filtering on the other parameters. The `tags` parameter is passed as a JSON string to the upstream API. The `related_ids` parameter is also supported for filtering by related memory IDs.
- **Multi-Tenant Not Supported**: Only single-tenant mode available.
- **Security**: No built-in rate limiting; use a reverse proxy (Nginx) in production.

---

## 🐛 Issues & Support

- Report bugs or request features: [GitHub Issues](https://github.com/giauphan/codeatlas-mcp-server/issues)
- For questions: [Discussions](https://github.com/giauphan/codeatlas-mcp-server/discussions)
