# CodeAtlas MCP Enterprise — Local-First Codebase Intelligence

> **The lightweight, privacy-first MCP server that brings deep codebase understanding to your AI editor** — zero source code ever leaves your machine.

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-6C5CE7)](https://modelcontextprotocol.io)
[![npm](https://img.shields.io/npm/v/codeatlas-enterprise?label=npm)](https://www.npmjs.com/package/codeatlas-enterprise)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## ✨ What is CodeAtlas MCP Enterprise?

**CodeAtlas MCP Enterprise** is a fast, local-first MCP (Model Context Protocol) server that indexes your codebase and provides AI assistants with deep structural understanding — **without ever sending your source code anywhere**.

It performs **AST (Abstract Syntax Tree) analysis** on your local machine, builds a complete map of your codebase architecture, and exposes 10+ MCP tools that AI editors can use to navigate, search, and understand your code.

### 🔍 Why CodeAtlas MCP?

- **🔒 Local-first** — your proprietary code never leaves your machine
- **⚡ Lightning fast** — full codebase analysis in seconds
- **🔌 Universal MCP** — works with Claude, Cursor, VS Code, Windsurf, Copilot
- **🌐 Hybrid sync** — optionally sync metadata to a remote Enterprise server
- **🧠 Dreaming memory** — AI remembers insights across sessions
- **📁 Automatic workspace discovery** — detects projects on your machine

---

## 🎯 Features

| Feature | Description |
|---------|-------------|
| 🔒 **Local-First Parsing** | AST analysis runs entirely on your machine — zero code uploaded |
| 🔌 **MCP Protocol** | Works with all MCP-compatible AI editors |
| 📁 **Auto Discovery** | Automatically finds projects in your workspace |
| 🔍 **Multi-Language AST** | JavaScript, TypeScript, Python, PHP |
| 🧠 **Dreaming Memory** | Persistent AI memory with vector search |
| 🏠 **Multi-Tenant** | Isolate projects by workspace |
| 🔐 **API Key Auth** | Secure communication with remote server |
| ⚡ **Incremental Indexing** | Only re-parses changed files |

---

## 🚀 Quick Start

### Install Globally

```bash
npm install -g codeatlas-enterprise
```

### Run

```bash
# Scan current directory and run MCP server
codeatlas-mcp

# With API key for remote sync
codeatlas-mcp --apiKey="your_api_key_here"
```

That's it! Your AI editor can now connect to the MCP server.

---

## 🔌 AI Editor Integration

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "codeatlas-mcp",
      "args": ["--apiKey", "YOUR_API_KEY"]
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
      "args": ["--apiKey", "YOUR_API_KEY"]
    }
  }
}
```

### VS Code (GitHub Copilot)

Configure in your MCP settings file:

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "codeatlas-mcp",
      "args": ["--apiKey", "YOUR_API_KEY"]
    }
  }
}
```

### Command Line

```bash
codeatlas-mcp --apiKey="your_api_key"
```

---

## 🔧 MCP Tools

| Tool | Description |
|------|-------------|
| `list_projects` | List all discovered projects |
| `get_project_structure` | Get entities (modules, classes, functions) |
| `generate_system_flow` | Mermaid architecture diagram |
| `generate_feature_flow_diagram` | Mermaid execution flow diagram |
| `trace_feature_flow` | Trace feature call chain |
| `code_search` | Search source file contents |
| `search_entities` | Find functions, classes by name |
| `get_callers` | Reverse dependency lookup |
| `get_callees` | Forward dependency lookup |
| `impact_analysis` | Full blast radius for changes |
| `query_dream_memories` | Semantic search across past AI memories |
| `save_dream_memory` | Save persistent AI insights |

---

## 🔒 Security Model

```
┌─────────────────────────────────────────────┐
│           Your Local Machine                 │
│                                               │
│   Source Code ──► AST Parser ──► Metadata     │
│       🔒          (local-only)       │         │
│                                      ▼         │
│                            ┌──────────────┐   │
│                            │   MCP Server  │───┼──► AI Editor
│                            └──────┬───────┘   │
│                                   │            │
│                                   ▼            │
│                      (optional HTTPS sync)     │
└──────────────────────────┬────────────────────┘
                           │
                           ▼
               CodeAtlas Enterprise Server
                    (if configured)
```

- **No source code ever uploaded** — only structural metadata
- **Zero database credentials** in the client package
- **Encrypted HTTPS** for optional remote sync
- **API key authentication** for all remote operations

---

## 📁 Automatic Workspace Discovery

CodeAtlas automatically finds projects in:
- Current working directory
- Parent process workspace paths
- Common project directories

It recognizes projects by the presence of:
- `package.json` (Node.js)
- `pyproject.toml` / `requirements.txt` (Python)
- `composer.json` (PHP)

---

## 🧪 Development

```bash
# Clone
git clone https://github.com/giauphan/codeatlas-mcp-enterprise.git
cd codeatlas-mcp-enterprise

# Install
npm install

# Build
npm run build

# Test
npm test
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md).

- 🐛 [Report a bug](https://github.com/giauphan/codeatlas-mcp-enterprise/issues)
- 💡 [Start a discussion](https://github.com/giauphan/codeatlas-mcp-enterprise/discussions)
- 🔒 [Report a vulnerability](SECURITY.md)

---

## 📄 License

[MIT](LICENSE) © 2026 Giau Phan

---

## 🔗 Related Projects

- [CodeAtlas AI](https://github.com/giauphan/codeatlas-ai) — Full enterprise server with Oracle 26ai memory, dashboard, and security scanner
- [npm package](https://www.npmjs.com/package/codeatlas-enterprise) — Install via npm
