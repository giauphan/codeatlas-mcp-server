# CodeAtlas MCP Server

CodeAtlas is a local MCP server for codebase analysis, dependency and call graphs, search, and project context. It reads project files on the machine where it runs, keeps analysis data in process memory by default, and can optionally sync analysis and memory to CodeAtlas Cloud when configured.

[![CI](https://github.com/giauphan/codeatlas-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/giauphan/codeatlas-mcp-server/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub Release](https://img.shields.io/github/v/release/giauphan/codeatlas-mcp-server)](https://github.com/giauphan/codeatlas-mcp-server/releases)

## What it does

- Parses supported source files and builds a code structure and relationship graph.
- Provides MCP tools for project analysis, code search, dependency and call relationships, impact analysis, and security scanning.
- Holds analyzed project data in the server process's memory. By default, analysis data is not saved as a local analysis file.
- Offers optional CodeAtlas Cloud features such as dream memories and Genome search. Cloud tools require `CODEATLAS_API_URL` and an API key.

The source code is read locally for analysis. When cloud sync is configured, analysis results and any cloud tools you call are sent to the configured CodeAtlas API. The `export_team_artifact` tool can explicitly write a shareable analysis artifact to `.codeatlas/`. Review the [runtime architecture](./docs/architecture/overview.md) for local and Cloud data flows.

## Install and run

The package requires Node.js 20 or newer. It publishes several executable names, so select one explicitly when using `npx`:

```bash
npx --yes --package=codeatlas-mcp-server codeatlas-mcp
```

To run from a checkout:

```bash
npm ci
npm run build
npm start
```

The MCP server uses **stdio transport**. Configure it in an MCP client such as Claude Desktop or Zed. This package does not expose an HTTP or SSE MCP endpoint.

## Configure an MCP client

Claude Desktop example:

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

See [Zed Integration](./docs/ZED_INTEGRATION.md) for the client configuration. The package also provides the `codeatlas`, `codeatlas-mcp`, `codeatlas-enterprise`, and `codeatlas-setup-claude` executables.

## Cloud configuration

Local code analysis can run without cloud credentials. Cloud features need both a configured API URL and a key. The API URL has no implicit default; set it explicitly:

```bash
export CODEATLAS_API_URL="https://api.codeatlas.ai"
export CODEATLAS_API_KEY="your_api_key_here"
npx --yes --package=codeatlas-mcp-server codeatlas-mcp
```

For normal MCP startup, you can also place these in a `.env` file in the working directory or `~/.codeatlas/.env`; existing process variables take precedence. One-shot CLI commands run before dotenv loading, so export their settings in the launching environment. The server may resolve a missing key from supported MCP client configuration files, and some setup tools persist configuration locally. Treat local configuration files as sensitive.

| Variable | Behavior |
|---|---|
| `CODEATLAS_API_URL` | CodeAtlas API base URL; no implicit default in the server. Recognized hosts include `api.codeatlas.ai`, subdomains of `codeatlas.ai` and `codeatlas-local.dev`, `opencode.ai`, and loopback hosts. |
| `CODEATLAS_API_KEY` | Credential for Cloud API calls; a missing key may be resolved from supported local client configuration. |
| `CODEATLAS_ALLOW_CUSTOM_URL` | Set to `true` to allow other API hosts. Remote destinations still require HTTPS; HTTP is allowed only for `localhost`, `127.0.0.1`, or `[::1]`. |
| `CODEATLAS_SCAN_AI_URL`, `CODEATLAS_SCAN_AI_KEY` | Optional AI security-scan endpoint and Bearer credential. `OPENCODE_BASE_URL` and `OPENCODE_API_KEY` are fallbacks. This endpoint is separate from the CodeAtlas API. |
| `CODEATLAS_SCAN_AI_MODEL` | Optional model label sent to the configured scan endpoint; it does not select a provider. |

See the [scanner guide](./docs/architecture/scanner.md) for AI request contents and destination rules.

## MCP tools

Tools cover project analysis and structure, entity and code search, dependency and call graphs, feature tracing, impact analysis, vulnerability scanning, project context, architecture decisions, and optional Cloud memory and Genome features. The available tools are registered in the server at runtime; consult the MCP client tool list for the current set. See [API Examples](./docs/API_EXAMPLES.md) for current tool names and argument examples.

## Documentation

| Guide | Description |
|---|---|
| [Runtime architecture](./docs/architecture/overview.md) | Startup, local analysis, persistence, and optional Cloud paths. |
| [CI and npm release pipeline](./docs/PIPELINE.md) | Continuous integration, package release, and rollback workflows. |
| [Development Guide](./docs/DEVELOPMENT.md) | Environment setup, commands, and troubleshooting. |
| [Deployment Guide](./docs/DEPLOYMENT.md) | Deployment notes for supported runtimes. |
| [API Examples](./docs/API_EXAMPLES.md) | MCP configuration and current tool examples. |
| [Zed Integration](./docs/ZED_INTEGRATION.md) | Register and use CodeAtlas from Zed. |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines. The package declares Node.js 20 or newer; CI also exercises Node.js 22.

## License

MIT © [Giau Phan](mailto:giauphan012@gmail.com)

## Related project

- [codeatlas-platform](https://github.com/giauphan/codeatlas-platform) — CodeAtlas Cloud API and services used by optional cloud features.
