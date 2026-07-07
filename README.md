# CodeAtlas MCP Server

**Enterprise-grade local-first MCP server** for CodeAtlas — AST analysis, codebase intelligence, semantic memory, and AI agent coordination powered by Oracle 26ai.

- **Version:** 2.20.4
- **Protocol:** [Model Context Protocol (MCP)](https://modelcontextprotocol.io)
- **Database:** Oracle 23ai+ with VECTOR data type
- **AI:** NVIDIA NIM Embeddings (nv-embed-v1)

---

## Table of Contents

- [Quick Start](#quick-start)
- [30 MCP Tools](#-30-mcp-tools)
  - [Code Analysis (8 tools)](#code-analysis)
  - [Code Search & Intelligence (6 tools)](#code-search--intelligence)
  - [Dream Memory (3 tools)](#dream-memory)
  - [Genome Immune System (4 tools)](#genome-immune-system)
  - [Git & DevOps (3 tools)](#git--devops)
  - [Second Brain (2 tools)](#second-brain)
  - [Enterprise Security (2 tools)](#enterprise-security)
  - [Feature Flow (2 tools)](#feature-flow)
- [CLI Flags](#-cli-flags)
- [Environment Variables](#-environment-variables)
- [Dream Sync & Cron](#-dream-sync--cron)
- [Oracle 26ai Setup](#-oracle-26ai-setup)
- [Architecture](#-architecture)
- [Troubleshooting](#-troubleshooting)

---

## Quick Start

```bash
# Install
npm install -g codeatlas-mcp-enterprise

# Set environment
export CODEATLAS_API_KEY="ca_..."
export ORACLE_USER="ADMIN"
export ORACLE_PASSWORD="..."
export ORACLE_CONN_STRING="..."
export NVIDIA_API_KEY="nvapi-..."

# Run MCP server (stdio mode)
codeatlas-mcp-enterprise

# Test dream sync
codeatlas-mcp-enterprise --sync-dreams

# View version
codeatlas-mcp-enterprise --version
```

### Configure in AI IDE

**Claude Code (`claude.json`):**
```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "npx",
      "args": ["codeatlas-mcp-enterprise"],
      "env": {
        "CODEATLAS_API_KEY": "ca_...",
        "ORACLE_USER": "ADMIN",
        "ORACLE_PASSWORD": "...",
        "ORACLE_CONN_STRING": "..."
      }
    }
  }
}
```

**Hermes (`config.yaml`):**
```yaml
mcp_servers:
  codeatlas:
    command: npx
    args: [codeatlas-mcp-enterprise]
    env:
      CODEATLAS_API_KEY: "ca_..."
      ORACLE_PASSWORD: "..."
      ORACLE_CONN_STRING: "..."
```

**VS Code / Cursor / Windsurf:** Configure MCP server in settings with command `npx codeatlas-mcp-enterprise`.

---

## 🛠 30 MCP Tools

### Code Analysis

| Tool | Description |
|---|---|
| **`analyze`** | Deep AST analysis of a local project. Generates entity graph (modules, classes, functions) and syncs to CodeAtlas Cloud. |
| **`list_projects`** | List all projects analyzed by CodeAtlas. Returns project names, paths, and last analysis timestamp. |
| **`get_project_structure`** | Get all entities (modules, classes, functions, variables) in a project. Filter by type. |
| **`get_dependencies`** | Get import/call/containment/implements relationships between entities. Filter by source, target, relationship type. |
| **`get_insights`** | AI-generated code insights — refactoring suggestions, security issues, maintainability analysis. |
| **`get_file_entities`** | Get all entities defined in a specific file. |
| **`project_context`** | Comprehensive project overview in one call: package.json, config files, README summary, test framework, git branch. |
| **`run_script`** | Run an npm/pnpm/yarn script from package.json. Returns exit code, stdout/stderr, duration. Timeout configurable. |

### Code Search & Intelligence

| Tool | Description |
|---|---|
| **`search_entities`** | Search functions, classes, modules, or variables by name. Fuzzy matching supported. |
| **`code_search`** | Search source FILE CONTENTS across the entire project for any text string. Unlike `search_entities`, this searches actual code — comments, strings, variable names, function bodies. |
| **`get_callers`** | Find ALL functions/methods/classes that call or reference a specific symbol. The reverse dependency view. Use before refactoring. |
| **`get_callees`** | Find everything a function/method/class calls or depends on. The forward dependency view. |
| **`impact_analysis`** | Full blast radius analysis — traces BOTH callers AND callees in one view. Also finds related test files. Use BEFORE any significant code change. |
| **`generate_system_flow`** | Auto-generate a Mermaid flowchart showing how modules, classes, and functions connect. Supports full, modules-only, and feature scopes. |

### Dream Memory

| Tool | Description |
|---|---|
| **`save_dream_memory`** | Save a dreaming memory entry (mistake, preference, knowledge, pattern) with vector embedding to CodeAtlas Cloud. Used by AI agents to persist learnings across conversations. |
| **`query_dream_memories`** | Semantic search across previously saved dream memories. Uses NVIDIA embeddings + Oracle 26ai VECTOR distance for relevance ranking. |
| **`sync_dreams`** | Check dream memory sync health. Returns count of stored dreams grouped by type and project. Shows 5 most recent dreams. Can be called from any AI IDE, CLI, or Hermes cron. |

### Genome Immune System

| Tool | Description |
|---|---|
| **`search_genome`** | Search CodeAtlas Genome for relevant genes. Semantic search finds the most relevant genes for a problem description. |
| **`get_gene`** | Get a specific gene by ID from the CodeAtlas Genome. |
| **`scan_immune_genes`** | Scan the CodeAtlas Immune System for previously encountered failures matching a problem description. Returns prevention context. |
| **`save_immune_gene`** | Record a failure pattern as an immune gene. Prevents future agents from repeating the same mistake. |

### Git & DevOps

| Tool | Description |
|---|---|
| **`git_changes`** | Get recent git changes: last N commits (hash, author, date, message, files changed), uncommitted changes (modified/added/deleted), branch status (ahead/behind). Saves multiple git commands. |
| **`run_script`** | Execute npm/pnpm/yarn scripts from package.json. |
| **`project_context`** | Quick project onboarding — reads package.json, config files, README, tests, git branch in one call. |

### Second Brain

| Tool | Description |
|---|---|
| **`setup_second_brain`** | Configure CodeAtlas Second Brain for any MCP client (Hermes, Claude Code, Gemini CLI). Installs MCP config and auto-retrieval plugin. |
| **`check_second_brain_status`** | Check the current Second Brain configuration status for all MCP clients. |

### Enterprise Security

| Tool | Description |
|---|---|
| **`scan_enterprise_vulnerabilities`** | Enterprise Scanner: Automatically scan all analyzed projects for bugs, security vulnerabilities (hardcoded secrets, unsafe functions), and architectural problems. Features Admin Insights and Security Scoring. |
| **`detect_architectural_smells`** | Use Oracle 26ai Graph features to automatically detect architectural weaknesses, circular dependencies, God objects, and dead code. |

### Feature Flow

| Tool | Description |
|---|---|
| **`trace_feature_flow`** | Trace the complete flow of a feature through the codebase. Given a keyword (e.g. 'login', 'payment', 'crawl'), finds all related files, classes, and functions, ordered by dependency chain. |
| **`generate_feature_flow_diagram`** | Generate a Mermaid diagram showing the EXECUTION FLOW of a feature. Traces the actual call chain: entry point → controller → service → model → database. |

---

## 🚩 CLI Flags

| Flag | Description |
|---|---|
| `--sync-dreams` | One-shot dream sync — queries cloud API for dream count and exits. Ideal for cron or pre-init hooks. |
| `--version`, `-v` | Print version and exit. |
| `--help`, `-h` | Show help. |
| `--port <number>` | Start in HTTP/SSE mode on the given port (default: 8080). |
| `--projectDir <path>` | Analyze a specific project directory on startup. |

---

## 🌐 Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CODEATLAS_API_KEY` | ✅ Yes | — | API key for CodeAtlas Cloud. Generate from Dashboard → Control Center. |
| `CODEATLAS_API_URL` | ❌ No | `https://atlas.genrostore.com` | Live server URL for dream/genome sync. |
| `NVIDIA_API_KEY` | ❌ No | — | NVIDIA NIM API key for embedding generation (nv-embed-v1). Needed for vector search in dreams. |
| `ORACLE_USER` | ✅ Yes | `ADMIN` | Oracle 26ai database user. |
| `ORACLE_PASSWORD` | ✅ Yes | — | Oracle 26ai password. |
| `ORACLE_CONN_STRING` | ✅ Yes | — | Oracle 26ai connection string (e.g. `host:port/service`). |
| `ORACLE_LIB_DIR` | ❌ No | — | Oracle Instant Client library path (Thick Mode). Required on Linux. |
| `ORACLE_WALLET_DIR` | ❌ No | — | Oracle wallet directory for TLS connections. |
| `CODEATLAS_BYPASS_RLS` | ❌ No | `false` | Set to `true` to bypass VPD (Row-Level Security) for local development. |

---

## 🔄 Dream Sync & Cron

Dreams are automatically saved to CodeAtlas Cloud whenever an AI agent calls `save_dream_memory`. All 3 dream tools work in real-time against the cloud API.

### One-shot sync from CLI

```bash
codeatlas-mcp-enterprise --sync-dreams
# → {"success": true, "count": 100, "message": "✅ 100 dreams synced..."}
```

### Periodic sync with systemd/cron

```bash
# Every 4 hours
0 */4 * * * /usr/bin/codeatlas-mcp-enterprise --sync-dreams >> /var/log/dreams-sync.log
```

### Pre-init hook in AI IDE

**Claude Code:** Add to `claude.json` `onStart` hook.
**Hermes:** Configure cron job pointing to `--sync-dreams` script.

### Scheduling via Dashboard

Open **Dashboard → Control Center → Cron Schedule** to configure sync frequency (daily 19:00, every 4h, etc.) through the UI.

---

## 🗄 Oracle 26ai Setup

The server requires Oracle 23ai+ with VECTOR data type support.

### Required tables (auto-migrated)

```sql
-- Dream Memory
CREATE TABLE ai_dreaming_memory (
  id          VARCHAR2(255) PRIMARY KEY,
  session_id  VARCHAR2(255),
  project     VARCHAR2(255),
  memory_type VARCHAR2(50),
  content     CLOB,
  embedding   VECTOR(1024, FLOAT64),
  importance  NUMBER(2),
  tenant_id   VARCHAR2(255),
  created_at  TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- Genome (immune genes)
CREATE TABLE ai_genome (
  id          VARCHAR2(255) PRIMARY KEY,
  problem     CLOB,
  prevention  CLOB,
  category    VARCHAR2(100),
  usage_count NUMBER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

### Row-Level Security (VPD)

The server uses Oracle Virtual Private Database for multi-tenant isolation. All queries are scoped by `tenant_id` via session context:

```sql
BEGIN ADMIN.codeatlas_ctx_pkg.set_tenant(:tenantId); END;
```

---

## 🏗 Architecture

```
                          ┌──────────────────────────────┐
                          │         AI IDE / CLI          │
                          │ (Claude, Hermes, Cursor, VS…) │
                          └──────────┬───────────────────┘
                                     │ MCP stdio/SSE
                                     ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│     CodeAtlas MCP Server      │   │      Hermes Cron Job         │
│                                │   │   (sync-dreams-cron.sh)    │
│  ┌────────────────────────┐   │   └─────────────┬────────────────┘
│  │    30 MCP Tools        │   │                 │
│  │  Code Analysis         │   │                 │ HTTP API
│  │  Dream Memory          │   │                 ▼
│  │  Genome Immune         │   │   ┌──────────────────────────────┐
│  │  Code Search & Flow    │   │   │      CodeAtlas Cloud         │
│  │  Git & DevOps          │   │   │   (atlas.genrostore.com)    │
│  │  Second Brain          │   │   │                              │
│  │  Enterprise Security   │   │   │  ┌────────────────────────┐ │
│  └────────────────────────┘   │   │  │     Oracle 26ai DB      │ │
│                                │   │  │  - Dream Memory       │ │
│  ┌────────────────────────┐   │   │  │  - Genome Immune      │ │
│  │  Local AST Analyzer    │   │   │  │  - System Memory      │ │
│  │  + Security Scanner    │   │   │  └────────────────────────┘ │
│  └────────────────────────┘   │   └──────────────────────────────┘
└──────────────────────────────┘
```

---

## 🔧 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `CODEATLAS_API_KEY is not set` | Missing API key | Set `CODEATLAS_API_KEY` env var. Generate from Dashboard. |
| `ORA-00942: table does not exist` | Oracle table not created | Ensure auto-migration runs on first server start. |
| `NJS-516: no configuration directory` | Missing Oracle wallet | Set `ORACLE_WALLET_DIR` to wallet path. |
| `DPI-1047: Oracle Client library` | Missing Instant Client | Install Oracle Instant Client or set `ORACLE_LIB_DIR`. |
| `401 Unauthorized` | Invalid/expired API key | Regenerate key from Control Center. |
| `Sync failed: status 400` | Invalid query params | Check `limit` (1-100), `offset` (≥0). |
| Embedding returns null | Missing NVIDIA_API_KEY | Set `NVIDIA_API_KEY` for vector search. |

---

## License

Enterprise License — CodeAtlas Platform.
