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
# Copy the optional local environment template. This file is ignored by Git.
cp .env.example .env

# Edit .env
# Cloud features require both variables; no default URL is used
# Set CODEATLAS_API_URL to your CodeAtlas API base URL
# Set CODEATLAS_API_KEY to your CodeAtlas API key
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

## 📡 MCP Tools (39)

| Category | Tools |
|---|---|
| **Code Analysis** | `analyze`, `list_projects`, `get_project_structure`, `get_insights`, `code_search`, `search_entities`, `get_file_entities`, `get_code_snippet`, `index_coverage`, `project_context` |
| **Dependencies & graphs** | `get_dependencies`, `get_callers`, `get_callees`, `impact_analysis`, `generate_system_flow`, `generate_feature_flow_diagram`, `trace_feature_flow` |
| **Security** | `scan_enterprise_vulnerabilities`, `detect_architectural_smells` |
| **Cloud** | `save_dream_memory`, `query_dream_memories`, `sync_dreams` |
| **Second Brain** | `brain_context`, `memory_bootstrap`, `sync_system_memory`, `get_system_memory`, `search_genome`, `get_gene`, `scan_immune_genes`, `save_immune_gene`, `setup_second_brain`, `check_second_brain_status` |
| **Workspace & utilities** | `run_script`, `git_changes`, `manage_adr`, `detect_code_similarities`, `export_team_artifact`, `sync_skills_inventory`, `route_task` |

### Example: Connect to Claude Desktop
Add to `claude-desktop-config.json`:
```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=codeatlas-mcp-server",
        "codeatlas-mcp"
      ]
    }
  }
}
```

### Example: Connect to Cursor/VSCode (stdio)
Add to `settings.json`:
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

### Connect to Zed (MCP context server)
Zed has no Claude-style hooks, so the Second Brain hooks are exposed as MCP tools instead.

For Claude hook setup, safe diagnostics, rollback controls, and the explicit `memory_bootstrap` tool for hosts without injection hooks, see [Memory pipeline operations](./docs/MEMORY_PIPELINE.md).

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
      "args": ["--yes", "--package=codeatlas-mcp-server", "codeatlas-mcp"],
      "env": {
        "CODEATLAS_API_URL": "https://api.codeatlas.ai",
        "CODEATLAS_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Then in Zed's Agent Panel, call the `brain_context` tool at the start of a task to inject Second Brain memory, and `save_dream_memory` after a task to persist learnings. `route_task` suggests a model/effort (advisory only — Zed does not auto-switch models). See [Zed Integration](./docs/ZED_INTEGRATION.md).

---


## 🔒 Security & Environment Variables

CodeAtlas MCP Server is designed with a local-first architecture and several security hardening measures to protect your credentials and codebase data:

- **Credential Storage**: Set `CODEATLAS_API_KEY` in the process environment to avoid storing it in a file. If you configure it in `.env` or an MCP client setting, the key is stored on disk; protect that file and keep it out of version control.
- **Strict Destination Validation**: When connecting to cloud features, the destination AI and backend URLs are strictly validated. Credentials can only flow to trusted official domains (`*.codeatlas.ai`, `opencode.ai`) or local addresses (`localhost`, `127.0.0.1`).
- **Telemetry & Logging**: Potential credential leaks are sanitized and redacted from all console and error logs.

### Required & Optional Environment Variables

| Variable | Description | Default |
|---|---|---|
| `CODEATLAS_API_KEY` | Secret key to connect to CodeAtlas Cloud services for AI memory and scan features. | (none) |
| `CODEATLAS_API_URL` | Target URL for CodeAtlas Cloud. Validated via allowlists to prevent credential exfiltration. | (none) |
| `CODEATLAS_ALLOW_CUSTOM_URL` | Set to `true` to allow sending credentials to self-hosted or unlisted destinations. Required for private network deployments. | `false` |
| `CODEATLAS_SCAN_AI_KEY` | Key for deep AI security scanning using an external LLM. | (none) |
| `CODEATLAS_SCAN_AI_URL` | Endpoint for deep AI security scanning. | (none) |

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
