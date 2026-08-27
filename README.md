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

### Install from npm

```bash
npm install -g codeatlas-mcp-server
codeatlas-mcp --help
```

Use it directly from an AI client with `npx`:

```bash
npx -y codeatlas-mcp-server
```

### Install from source

```bash
# Clone the repo
git clone https://github.com/giauphan/codeatlas-mcp-server.git
cd codeatlas-mcp-server
pnpm install
pnpm run build
```

### Configure optional cloud memory

```bash
export CODEATLAS_API_URL="http://localhost:3381"
export CODEATLAS_API_KEY="your_api_key_here"
```

### Run

```bash
# Local-only mode (no cloud)
codeatlas-mcp

# From a source checkout
pnpm start
```

### Add to an AI agent (CLI)

**Claude Code** (`claude mcp add`):

```bash
# stdio server from npm, user scope (available in every project)
claude mcp add codeatlas -s user -- npx -y codeatlas-mcp-server

# with optional cloud memory
claude mcp add codeatlas -s user \
  --env CODEATLAS_API_URL=http://localhost:3381 \
  --env CODEATLAS_API_KEY=your_api_key_here \
  -- npx -y codeatlas-mcp-server

# from a source checkout
claude mcp add codeatlas -- node /absolute/path/to/codeatlas-mcp-server/dist/index.js

claude mcp list          # verify connection
claude mcp remove codeatlas
```

Scopes: `-s local` (default, current project only), `-s project` (shared via `.mcp.json`), `-s user` (all projects).

**Codex CLI** (`codex mcp add`):

```bash
codex mcp add codeatlas -- npx -y codeatlas-mcp-server
codex mcp list
```

Or edit `~/.codex/config.toml`:

```toml
[mcp_servers.codeatlas]
command = "npx"
args = ["-y", "codeatlas-mcp-server"]

[mcp_servers.codeatlas.env]
CODEATLAS_API_URL = "http://localhost:3381"
CODEATLAS_API_KEY = "your_api_key_here"
```

Secrets go in env vars or `~/.codeatlas/.env`, never in CLI args — command lines are visible to other users via `ps aux`.

### Add to Zed

#### Local MCP server (recommended)

CodeAtlas MCP runs over stdio. In Zed, open **Settings → AI → MCP Servers → Add Server → Add Local Server**, or add this to `settings.json`:

```json
{
  "context_servers": {
    "codeatlas-mcp": {
      "command": "npx",
      "args": ["-y", "codeatlas-mcp-server"],
      "env": {
        "CODEATLAS_API_URL": "http://localhost:3381",
        "CODEATLAS_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Open the Zed Agent Panel and enable `codeatlas-mcp` under context servers.

#### Remote MCP server

Use **Add Remote Server** only when your CodeAtlas deployment exposes an HTTP MCP endpoint:

| Field | Value |
|---|---|
| **Server Name** | `codeatlas-mcp` |
| **URL** | Deployed HTTP MCP endpoint |
| **Timeout** | `60` seconds |
| **Headers** | `Authorization: Bearer your_api_key_here` when required |

`http://localhost:3381` is the CodeAtlas Platform backend URL (set via `CODEATLAS_API_URL`), not this package's MCP endpoint. Do not enter it as a remote MCP URL unless your platform explicitly exposes MCP there.

Verify after setup:

```bash
codeatlas-mcp doctor
```

### Install Claude Code Second Brain hooks

```bash
codeatlas-mcp install-hooks --dry-run
codeatlas-mcp install-hooks
```

See [Second Brain Hooks Setup](./docs/HOOKS_SETUP.md) for requirements, verification, and uninstall/rollback.

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

---

## 📚 Documentation

| Guide | Description |
|---|---|
| [Development Guide](./docs/DEVELOPMENT.md) | Full environment setup, commands, and troubleshooting. |
| [Deployment Guide](./docs/DEPLOYMENT.md) | PM2, systemd, Nginx TLS, and healthchecks. |
| [API Examples](./docs/API_EXAMPLES.md) | Auth, dream memory, and MCP config examples. |
| [Second Brain Hooks Setup](./docs/HOOKS_SETUP.md) | Install, configure, verify, and uninstall Claude Code memory hooks. |

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

- **Optional persistence service**: Local code analysis, AST parsing, dependency graphs, and code search run without a database. Dream memory, genome, and immune-system features require a reachable CodeAtlas Platform instance.
- **SQLite + vector-search storage**: CodeAtlas Platform persists memories and vectors locally with SQLite and vector search. Oracle and a hosted cloud service are not required.
- **Dream query filters**: `scope`, `tags`, `memory_type`, and `related_ids` are forwarded to the configured platform instance. `tags` is encoded as a JSON string; supported filters depend on the installed platform version.
- **Multi-tenant mode**: Single-tenant mode is the supported configuration.
- **Production security**: This package does not provide HTTP rate limiting. When exposing the platform remotely, put it behind an authenticated reverse proxy with TLS and rate limiting.

---

## 🐛 Issues & Support

- Report bugs or request features: [GitHub Issues](https://github.com/giauphan/codeatlas-mcp-server/issues)
- For questions: [Discussions](https://github.com/giauphan/codeatlas-mcp-server/discussions)
