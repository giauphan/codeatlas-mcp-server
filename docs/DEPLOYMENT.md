# Installation and Deployment

CodeAtlas MCP Server is a local MCP process. An MCP client launches it and
communicates through standard input and output. It does not host an HTTP/SSE
endpoint, healthcheck URL, or database service, so deploying this package behind
a reverse proxy or process manager is not part of this repository's runtime
model.

## Use the published package

Configure an MCP client to run the package with Node.js 20 or newer. For
example, a client configuration that supports `npx` can use:

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

The package publishes the `codeatlas`, `codeatlas-mcp`,
`codeatlas-enterprise`, and `codeatlas-setup-claude` executables. The server
commands communicate with MCP clients over stdio. Use the command supported by
your MCP client's configuration format.

## Run from a checkout

```bash
npm ci
npm run build
npm start
```

Or point the MCP client at `node` and the built `dist/index.js`. The client must
own the process lifetime and stdio connection.

## Optional CodeAtlas platform connection

Local code analysis runs without cloud credentials. To enable cloud-backed
memory and genome features, configure `CODEATLAS_API_URL` and
`CODEATLAS_API_KEY` in the MCP client's process environment. These values
connect this process to the separate `codeatlas-platform` HTTP API; they do not
turn this package into an HTTP server. See the environment variable table in
the [root README](../README.md).

For normal MCP startup, the server also loads `.env` from its working directory
and then `~/.codeatlas/.env`; already-set process variables take precedence.
One-shot CLI commands run before dotenv loading, so pass their cloud settings in
the process environment. The API key can also be resolved from supported MCP
client or CodeAtlas config files.

## Release rollback

The repository's manually dispatched npm rollback workflow can promote an
existing version to the `latest` dist-tag and optionally deprecate another
version. It does not revert Git commits or remove a published package version.
See [Pipeline and release runbook](./PIPELINE.md#manual-npm-tag-rollback).
