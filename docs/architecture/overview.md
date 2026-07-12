# MCP Server Architecture

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

