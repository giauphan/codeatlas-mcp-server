# CodeAtlas Enterprise MCP Gateway

An ultra-lightweight, high-performance Model Context Protocol (MCP) gateway that securely bridges your local AI editors (Cursor, Claude Code, Roo Code, VS Code) to the remote **CodeAtlas Enterprise Server**. 

This client-only gateway requires no heavy database engines, AST parsers, or workspace indexers locally. All complex AI analysis and persistence run secure and isolated in the cloud, giving you instant, lightning-fast response times with zero local CPU overhead.

---

## 🚀 Installation

Install globally using `npm` (or `yarn`/`pnpm`):

```bash
npm install -g codeatlas-enterprise
```

---

## 🔑 Authentication

The gateway communicates securely with the CodeAtlas server using your personal **API Key**. You can provide the API Key in one of three ways:

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

* **Zero Local Code Storage**: This client package contains only the necessary transport bridge code. Your intellectual property, credentials, and structural data are never saved on the local machine where this package is installed.
* **Encrypted Transmission**: All data exchanged between your local editor and the server is fully encrypted via secure HTTPS/SSE channels.

---

## 📄 License

UNLICENSED — All Rights Reserved. Used exclusively for licensed CodeAtlas Enterprise customers.
