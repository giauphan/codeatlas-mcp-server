# Security Policy

## Reporting a vulnerability

Please report vulnerabilities through a [private GitHub security advisory](https://github.com/giauphan/codeatlas-mcp-server/security/advisories/new). You can also contact the repository owner at **giauphan012@gmail.com**, the public email listed on the repository owner's GitHub profile. Include the affected version or commit, affected files or components, steps to reproduce, and the impact.

Please keep reports private while they are being reviewed.

## Security notes for operators

CodeAtlas MCP Server starts as an MCP process over standard input and output. It does not start an HTTP or SSE listener in this entry point. It can make outbound requests when cloud features or an explicitly configured AI scan are used. See [the architecture overview](docs/architecture/overview.md) for the data sent and destination controls.

The server reads `CODEATLAS_API_KEY` from the environment and can also resolve it from supported local MCP client configuration files. Those configuration files may store the key on disk. The process also writes diagnostics to `~/.codeatlas/mcp.log` and a local project-path registry to `~/.codeatlas/registered_projects.json`.

File helpers use `O_NOFOLLOW` for the final file component when opening selected files. This does not protect parent directories from symlink substitution or establish a general filesystem sandbox. Treat the process as having the filesystem permissions of the user who runs it, and limit the workspaces made available to the MCP client.
