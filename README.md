# CodeAtlas Enterprise MCP Server

An ultra-lightweight, high-performance Model Context Protocol (MCP) server that securely indexes your local codebase and synchronizes codebase metadata with your remote **CodeAtlas Enterprise Server**.

This client package operates on a secure **Local-First** model. The AST (Abstract Syntax Tree) generation and codebase relationship intelligence are computed completely in-process on your local machine, keeping your proprietary code strictly under your control. The computed metadata structure is then securely synchronized to your central Enterprise VPS via HTTPS REST APIs using your personal API key, ensuring absolutely zero cloud credential leaks.

---

## 🚀 Installation

Install globally using `npm` (or `yarn`/`pnpm`):

```bash
npm install -g codeatlas-enterprise
```

---

## 🔑 Authentication

The server communicates securely with the remote CodeAtlas Enterprise Server using your personal **API Key**. You can provide the API Key in one of three ways:

1. **Environment Variable**:
   ```bash
   export CODEATLAS_API_KEY="your_api_key_here"
   ```
2. **Local `.env` File**:
   Create a `.env` file in the directory where you run the command:
   ```env
   CODEATLAS_API_KEY="your_api_key_here"
   ```
3. **CLI Argument**:
   ```bash
   codeatlas-mcp --apiKey="your_api_key_here"
   ```

---

## 🛠 AI Editor Integration

### 1. Cursor / Claude Desktop / VS Code
Add the following to your global MCP settings file (e.g., `mcp_config.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "codeatlas-mcp",
      "args": [
        "--apiKey",
        "YOUR_API_KEY_HERE"
      ]
    }
  }
}
```

### 2. Custom Command Line Execution
You can also launch it manually in standard input/output mode:

```bash
codeatlas-mcp --apiKey="YOUR_API_KEY_HERE"
```

---

## 🔒 Absolute Privacy & Security

* **Local-First Parsing**: Source files are parsed completely on your local machine. No raw source files are ever uploaded or transmitted.
* **No Database Credential Exposure**: This package contains zero SQL credentials, Firebase configs, or private server schemas. All synchronization uses standard secure HTTPS REST endpoints with Bearer Token validation.
* **Encrypted Transmission**: All metadata synchronized with the Enterprise Server is fully encrypted over standard HTTPS.

---

## 📄 License

UNLICENSED — All Rights Reserved. Used exclusively for licensed CodeAtlas Enterprise customers.
