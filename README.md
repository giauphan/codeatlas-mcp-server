# CodeAtlas MCP Server

Local-first MCP server for AI-powered codebase intelligence — AST analysis, dependency graphs, and semantic search. Your source code never leaves your machine.

## 🏗 Architecture

```
AI IDE → MCP stdio → Parser (AST) → Dependency Graph → Code Search
                          │
                    codeatlas-platform (HTTP) → Dreams + Genome
```

| Layer | Components |
|---|---|
| **Parser** | TypeScript, Python, PHP AST analysis |
| **Graph** | Dependency graph with chunked force layout |
| **Search** | Semantic code search with regex safety |
| **Cloud** | Optional: connect to codeatlas-platform for dreams/genome |

## 📊 Architecture Diagrams

| Diagram | File |
|---|---|
| MCP Server Flow | [`diagrams/mcp-server.mmd`](docs/diagrams/mcp-server.mmd) |

## 🔧 Quick Start

```bash
pnpm install
pnpm run build
# Local-only mode (no cloud):
node dist/index.js

# With cloud connection:
CODEATLAS_API_URL=http://localhost:8080 CODEATLAS_API_KEY=xxx node dist/index.js
```

## 📡 MCP Tools (30)

| Category | Tools |
|---|---|
| Code Analysis | `analyze_project`, `code_search`, `file_info` |
| AST | `parse_file`, `find_symbol`, `get_dependencies` |
| Graphs | `dependency_graph`, `call_graph` |
| Security | `scan_vulnerabilities` |
| Cloud | `save_dream_memory`, `query_dream_memories`, `sync_dreams` |
| Skills | `search_skills`, `get_skill`, `install_skill` |

## 🔗 Cloud Connection

Set `CODEATLAS_API_URL` and `CODEATLAS_API_KEY` to connect to a running codeatlas-platform instance for:
- Dream memory persistence
- Genome immune system
- Skills synchronization
