<div align="center">

# CodeAtlas MCP Enterprise

**Enterprise-Grade, Local-First MCP Server for AI-Powered Code Intelligence**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-%5E5.4-blue)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-purple)](https://modelcontextprotocol.io)
[![npm](https://img.shields.io/npm/v/codeatlas-enterprise)](https://www.npmjs.com/package/codeatlas-enterprise)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/giauphan/codeatlas-mcp-enterprise/pulls)

**CodeAtlas MCP Enterprise** is an ultra-lightweight, local-first [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that securely indexes your codebase, performs deep AST-based analysis, and provides 20+ intelligent tools for AI code assistants. **Your source code never leaves your machine.**

</div>

---

## 📋 Table of Contents

- [Why CodeAtlas MCP?](#-why-codeatlas-mcp)
- [Features](#-features)
- [Architecture Overview](#-architecture-overview)
- [Quick Start](#-quick-start)
- [Authentication](#-authentication)
- [AI Editor Integration](#-ai-editor-integration)
  - [Cursor](#cursor)
  - [Claude Desktop](#claude-desktop)
  - [VS Code / Windsurf / Copilot](#vs-code--windsurf--copilot)
- [MCP Tools Reference](#-mcp-tools-reference)
  - [Analysis & Indexing](#analysis--indexing)
  - [Code Exploration](#code-exploration)
  - [Dependency & Impact Analysis](#dependency--impact-analysis)
  - [Visualization & Diagrams](#visualization--diagrams)
  - [Memory & Persistence](#memory--persistence)
  - [Security & Architecture](#security--architecture)
  - [Project Operations](#project-operations)
- [Security Model](#-security-model)
- [Multi-Tenant Mode](#-multi-tenant-mode)
- [Environment Configuration](#-environment-configuration)
- [How It Works](#-how-it-works)
- [License](#-license)

---

## 🎯 Why CodeAtlas MCP?

AI code assistants are powerful — but they work best with **context**. CodeAtlas gives them X-ray vision into your codebase by:

- 🔍 **Deep parsing** — Understands JavaScript, TypeScript, Python, and PHP at the AST level
- 🧠 **Persistent memory** — Retains insights across conversations via Dreaming Memory
- 🔒 **Zero data leakage** — All parsing happens locally, no source code ever transmitted
- ⚡ **Blazing fast** — Full codebase analysis in seconds, incremental re-indexing
- 🔌 **Universal compatibility** — Works with any MCP-compatible editor (Cursor, Claude, VS Code, Windsurf, Copilot)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔒 **Local-First Parsing** | AST analysis runs entirely on your machine — zero code uploaded |
| 🔌 **MCP Protocol** | Works with all MCP-compatible AI editors |
| 📁 **Auto Workspace Discovery** | Automatically finds projects in your workspace |
| 🔍 **Multi-Language AST** | JavaScript, TypeScript, Python, PHP with deep dependency resolution |
| 🧠 **Dreaming Memory** | Persistent AI memory with vector search for cross-session context |
| 🏠 **Multi-Tenant Isolation** | Isolate projects by workspace with sandbox boundaries |
| 🔐 **API Key Auth** | Secure communication via cryptographic hash verification |
| ⚡ **Incremental Indexing** | Only re-parses changed files for near-instant updates |
| 🏗️ **Knowledge Graph** | Visualize modules, classes, and functions as an interactive graph |
| 🌐 **Remote Sync** | Optionally sync metadata to CodeAtlas Enterprise via HTTPS |
| 📊 **Code Metrics** | LOC, complexity scores, function counts per project |
| 🛡️ **Security Scanner** | Detect hardcoded secrets, unsafe functions, SQL injection |
| 🔄 **Real-time Watching** | Auto re-index on file changes via chokidar |

---

## 🏗 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Your Local Machine                     │
│                                                           │
│   ┌──────────┐    ┌────────────┐    ┌────────────────┐   │
│   │  Source   │───▶│    AST     │───▶│   MCP Server   │   │
│   │  Code     │    │   Parser   │    │  (this tool)   │───┼──▶ AI Editor
│   │  (JS/TS/  │    │  (local)   │    └───────┬────────┘   │
│   │   PY/PHP)│    └────────────┘            │            │
│   └──────────┘                               │            │
│                                              ▼            │
│                                  ┌──────────────────┐     │
│                                  │  Dreaming Memory  │     │
│                                  │  (optional: sync) │     │
│                                  └────────┬─────────┘     │
└───────────────────────────────────────────┼───────────────┘
                                            │ HTTPS (optional)
                                            ▼
                               CodeAtlas Enterprise Server
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** v18.0.0 or higher (v20+ recommended)

### Install Globally

```bash
npm install -g codeatlas-enterprise
```

### Run

```bash
# Scan current directory and start MCP server
codeatlas-mcp

# With API key for remote sync
codeatlas-mcp --apiKey="your_api_key_here"

# Point to a specific project directory
codeatlas-mcp --projectDir="/path/to/your/project"
```

That's it! Your AI editor can now connect to the MCP server running on stdio.

---

## 🔑 Authentication

Provide your API Key in one of these ways:

1. **Environment Variable**:
   ```bash
   export CODEATLAS_API_KEY="your_api_key_here"
   ```

2. **CLI Argument**:
   ```bash
   codeatlas-mcp --apiKey="your_api_key_here"
   ```

3. **Local `.env` File** (in the directory where you run the command):
   ```env
   CODEATLAS_API_KEY=your_api_key_here
   ```

---

## 🔌 AI Editor Integration

### Cursor

Add to `~/.cursor/mcp.json` or project-level `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "codeatlas-mcp",
      "args": ["--apiKey", "YOUR_API_KEY_HERE"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "codeatlas-mcp",
      "args": ["--apiKey", "YOUR_API_KEY_HERE"]
    }
  }
}
```

### VS Code / Windsurf / Copilot

For any MCP-compatible editor, use the same JSON structure:

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "codeatlas-mcp",
      "args": ["--apiKey", "YOUR_API_KEY_HERE"]
    }
  }
}
```

> **Note:** If you're running without a remote server, omit the `--apiKey` argument. The local MCP tools (analysis, search, graph) work fully offline.

---

## 🛠 MCP Tools Reference

CodeAtlas MCP exposes **20+ tools** organized into categories:

### Analysis & Indexing
| Tool | Description |
|------|-------------|
| `analyze` | Trigger full AST analysis of the current project |
| `get_project_structure` | Get entities tree (modules, classes, functions, variables) |
| `get_file_entities` | List all entities defined in a specific file |

### Code Exploration
| Tool | Description |
|------|-------------|
| `search_entities` | Search for functions, classes, modules by name (fuzzy) |
| `code_search` | Search source file contents for any text or regex |
| `get_file_content` | Read file contents with line numbers |

### Dependency & Impact Analysis
| Tool | Description |
|------|-------------|
| `get_callers` | Find all functions/callers that reference a symbol |
| `get_callees` | Find everything a function/module imports or calls |
| `impact_analysis` | Full blast radius: callers + callees + test files |
| `get_dependencies` | Get import/call/containment/implements relationships |

### Visualization & Diagrams
| Tool | Description |
|------|-------------|
| `generate_system_flow` | Mermaid flowchart of module architecture |
| `generate_feature_flow_diagram` | Mermaid sequence/flow diagram for a feature |
| `trace_feature_flow` | Ordered call chain from entry point to database |

### Memory & Persistence
| Tool | Description |
|------|-------------|
| `query_dream_memories` | Semantic vector search across past AI memories |
| `save_dream_memory` | Persist an AI insight or observation for future sessions |
| `get_system_memory` | Retrieve business rules and change logs |
| `sync_system_memory` | Save business rules or change descriptions |

### Security & Architecture
| Tool | Description |
|------|-------------|
| `scan_enterprise_vulnerabilities` | Scan all projects for hardcoded secrets, unsafe functions, SQL injection |
| `detect_architectural_smells` | Detect circular dependencies, God objects, dead code |

### Project Operations
| Tool | Description |
|------|-------------|
| `list_projects` | List all discovered and indexed projects |
| `refresh_projects` | Re-scan directories for new or removed projects |
| `get_project_insights` | AI-generated refactoring and maintainability suggestions |

---

## 🔒 Security Model

### 🔐 Local-First by Design

CodeAtlas MCP Enterprise follows a **zero-trust, local-first architecture**:

1. **Parsing is local** — All source file reading, AST generation, and relationship mapping happens on your machine. No source code is ever uploaded.

2. **No credentials embedded** — The package contains zero database passwords, Firebase configs, or private server keys. All remote communication uses standard HTTPS with Bearer token auth.

3. **Encrypted sync** — If you enable remote sync, metadata is transmitted over HTTPS. The server authenticates via cryptographic hash of your API key.

### 🔒 What Gets Sent (When Sync is Enabled)

Only **structural metadata** is transmitted:
- File paths and names (relative to project root)
- Function/class/module names and line numbers
- Import/export relationships
- Analysis statistics (file count, LOC, complexity)

**Raw source code, credentials, and proprietary logic are never transmitted.**

### 🏠 Multi-Tenant Isolation

When multi-tenant mode is enabled:
- Each tenant's projects are isolated in separate sandbox directories
- Path traversal attacks are blocked by strict boundary validation
- Memory and analysis data are scoped per-tenant

---

## 🏠 Multi-Tenant Mode

Enable tenant isolation via environment variables:

```env
CODEATLAS_MULTI_TENANT=true
CODEATLAS_PROJECTS_ROOT=./tenants
```

Each tenant's projects live in `./tenants/{tenantId}/`, with strict path-boundary enforcement.

---

## 🌍 Environment Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEATLAS_API_KEY` | — | API key for authenticating with remote server |
| `CODEATLAS_API_URL` | `https://your-server.com/api` | Remote CodeAtlas server URL |
| `CODEATLAS_MULTI_TENANT` | `false` | Enable multi-tenant isolation |
| `CODEATLAS_PROJECTS_ROOT` | `./tenants` | Root directory for tenant sandboxes |
| `CODEATLAS_PROJECT_DIR` | `process.cwd()` | Default project path |
| `NODE_ENV` | `production` | Environment mode |

---

## ⚙️ How It Works

1. **Start** — Run `codeatlas-mcp` in your project directory or point it with `--projectDir`
2. **Auto-Discover** — The server scans for projects by detecting `package.json`, `pyproject.toml`, `composer.json`
3. **AST Parse** — Each source file is parsed into an Abstract Syntax Tree
4. **Build Graph** — Modules, classes, functions, and their relationships form a Knowledge Graph
5. **Serve MCP** — AI editors query the graph through 20+ MCP tools
6. **Dream** — Insights persist across sessions via Dreaming Memory (optional remote vector store)

---

## 📄 License

[MIT](LICENSE) © 2026 Giau Phan

---

## 🔗 Related Projects

- [CodeAtlas AI](https://github.com/giauphan/codeatlas-ai) — Full enterprise server with Oracle 26ai memory, dashboard, security scanner
- [npm package](https://www.npmjs.com/package/codeatlas-enterprise) — Install via npm
