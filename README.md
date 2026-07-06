<div align="center">

**AI Second Brain** — Persistent memory for any AI client via MCP.

Automatically store and retrieve Dreams, Memories, Genome (DNA), and Immune Genes across Hermes, Claude Code, Gemini CLI, Cursor, and any MCP-compatible AI client.

---

## 🚀 Quick Start

```bash
# Install
npm install -g codeatlas-enterprise

# Setup (interactive wizard)
export CODEATLAS_API_KEY="ca_..."
codeatlas init

# Or just run the MCP server (auto-detected by clients)
codeatlas
```

---

## 📋 CLI Commands

| Command | Description |
|---------|-------------|
| `codeatlas` | Run MCP server (default, no args) |
| `codeatlas init` | Interactive Second Brain setup wizard |
| `codeatlas setup` | Same as `init` |
| `codeatlas doctor` | Health check & diagnostics |
| `codeatlas --help` | Show usage |
| `codeatlas --version` | Show version |

### `codeatlas init` — Setup Wizard

Steps through:
1. **Authenticate** with CodeAtlas Cloud
2. **Connect** your project
3. **Enable** AI Second Brain
4. **Initialize** Dreams, DNA, Immune System
5. **Verify** synchronization
6. **Health check** — confirm everything works

### `codeatlas doctor` — Health Check

```
$ codeatlas doctor

CodeAtlas Second Brain — Health Check
==================================================
  ✓ CODEATLAS_API_KEY (ca_7d94a...)
  ✓ Cloud connection (https://atlas.genrostore.com/)
  ✓ MCP config (Hermes)
  ✓ Auto plugin (Hermes)
  ✓ Dream persistence
  ✓ Genome (DNA)
  ✓ Immune System
==================================================
7/7 checks passed. All systems operational.
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

Set your API key as an environment variable:

```bash
export CODEATLAS_API_KEY="ca_your_key_here"
```

Or provide it via the setup wizard's interactive prompt.

3. **Local `.env` File** (in the directory where you run the command):
   ```env
   CODEATLAS_API_KEY=your_api_key_here
   ```

---

## 🧠 AI Second Brain Features

The Second Brain is a persistent knowledge layer shared across all your AI clients:

| Feature | MCP Tool | Description |
|---------|----------|-------------|
| **Dreams** | `save_dream_memory` | Save persistent memories |
| | `query_dream_memories` | Search memories semantically |
| **Genome (DNA)** | `search_genome` | Search DNA/genes by relevance |
| | `get_gene` | Get gene by ID |
| **Immune System** | `scan_immune_genes` | Check for known failure patterns |
| | `save_immune_gene` | Record a failure prevention |
| **Setup** | `setup_second_brain` | Auto-configure any MCP client |
| | `check_second_brain_status` | Show config status for all clients |
| **System Memory** | `sync_system_memory` | Generate project memory docs |
| | `get_system_memory` | Retrieve system documentation |

---

## 🤖 AI Client Integration

### Hermes Agent

Config is automatic via `codeatlas init`. The auto-retrieval plugin is installed at:

```
~/.hermes/plugins/codeatlas_second_brain/
```

The plugin hooks into every conversation turn:
- **pre_llm_call**: auto-retrieve Dreams + DNA + Immune context
- **post_llm_call**: auto-save new knowledge as Dreams

No user commands needed. The AI automatically recalls past knowledge and saves new learnings.

### Claude Code / Claude Desktop

Add to `~/.claude/claude.json`:

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "npx",
      "args": ["-y", "codeatlas-enterprise"],
      "env": { "CODEATLAS_API_KEY": "ca_your_key_here" }
    }
  }
}
```

Or run `codeatlas init` which configures this automatically.

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "npx",
      "args": ["-y", "codeatlas-enterprise"]
    }
  }
}
```

### Gemini CLI

```bash
gemini mcp add codeatlas --command "npx" --args "-y" --args "codeatlas-enterprise" --env CODEATLAS_API_KEY="ca_your_key_here"
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

## 🔄 Automatic Second Brain Workflow

When the Hermes auto plugin is active, every conversation follows this pipeline:

```
User: "Continue implementing the AI Gateway"
                        │
                        ▼
  ┌─────────────────────────────────────┐
  │  pre_llm_call (auto)                │
  │  ├─ query_dreams("AI Gateway")      │  → 5 relevant dreams found
  │  ├─ search_genome("AI Gateway")     │  → 3 DNA genes found
  │  └─ scan_immune("AI Gateway")       │  → Prevention context injected
  └──────────────┬──────────────────────┘
                 │
                 ▼
        LLM Reasoning
   (with Second Brain context)
                 │
                 ▼
  ┌─────────────────────────────────────┐
  │  post_llm_call (auto)                │
  │  └─ save_dream("new knowledge")      │  → Dream auto-persisted
  └──────────────────────────────────────┘

No user said "search", "load", "save", or "memories" — all automatic.
```

---

## 📦 All MCP Tools (30 total)

| Tool | Purpose |
|------|---------|
| `save_dream_memory` | ✅ Save a dream memory |
| `query_dream_memories` | ✅ Query dreams by semantic search |
| `search_genome` | ✅ Search CodeAtlas Genome |
| `get_gene` | ✅ Get a specific gene by ID |
| `scan_immune_genes` | ✅ Scan immune system for prevention |
| `save_immune_gene` | ✅ Record a failure pattern |
| `setup_second_brain` | ✅ Auto-configure MCP clients |
| `check_second_brain_status` | ✅ Show Second Brain config |
| `analyze` | ✅ Deep code analysis |
| `list_projects` | ✅ List analyzed projects |
| `get_file_entities` | ✅ Get entities in a file |
| `get_project_structure` | ✅ Get project structure |
| `code_search` | ✅ Search file contents |
| `get_callers` | ✅ Find reverse dependencies |
| `get_callees` | ✅ Find forward dependencies |
| `impact_analysis` | ✅ BLAST radius analysis |
| `get_dependencies` | ✅ Get import/call relationships |
| `generate_system_flow` | ✅ Generate Mermaid flow diagram |
| `trace_feature_flow` | ✅ Trace execution flow |
| `get_system_memory` | ✅ Get system documentation |
| `sync_system_memory` | ✅ Generate memory docs |
| `get_insights` | ✅ AI code insights |
| `detect_architectural_smells` | ✅ Detect circular deps, God objects |
| `scan_enterprise_vulnerabilities` | ✅ Security scan |
| `project_context` | ✅ Project overview |
| `run_script` | ✅ Run npm scripts |
| `git_changes` | ✅ Recent git changes |
| `generate_feature_flow_diagram` | ✅ Feature flow diagrams |
| `list_resources` | ✅ List MCP resources |
| `read_resource` | ✅ Read MCP resource |

---

## 🏗 Architecture

```
┌─────────────────────┐     MCP stdio      ┌──────────────────────┐
│  Hermes Agent       │◄──────────────────►│  codeatlas-enterprise │
│  Claude Code        │                    │  MCP Server           │
│  Gemini CLI         │                    │                       │
│  Cursor             │                    │  CLI:                 │
│  Any MCP client     │                    │  ├─ init, setup       │
└─────────────────────┘                    │  ├─ doctor            │
                                           │  └─ (no args → MCP)  │
                                           │                       │
                                           │  HTTPS (REST)         │
                                           │         │             │
                                           │         ▼             │
                                           │  CodeAtlas Cloud API  │
                                           │  atlas.genrostore.com │
                                           └──────────────────────┘
```

---

## 🔒 Security

- **Local-First**: Source code is parsed locally. No raw files uploaded.
- **API Key Auth**: All cloud requests authenticated via `CODEATLAS_API_KEY`.
- **HTTPS Only**: All communication encrypted.
- **PID Guard**: Prevents duplicate MCP server instances.

---

## 📄 License

[MIT](LICENSE) © 2026 Giau Phan

---

## 🔗 Related Projects

- [CodeAtlas AI](https://github.com/giauphan/codeatlas-ai) — Full enterprise server with Oracle 26ai memory, dashboard, security scanner
- [npm package](https://www.npmjs.com/package/codeatlas-enterprise) — Install via npm
