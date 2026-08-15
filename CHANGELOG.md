# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.1] - 2025-08-14

### Fixed
- `.npmignore` too aggressive — now allows `dist/` and `README.md` for package publishing
- `.env.example` missing required Oracle and Express env vars
- `.gitignore` missing `dist/` and `node_modules/`

### Added
- `CHANGELOG.md` for public changelog tracking
- Expanded environment variables in `.env.example` (PORT, CODEATLAS_MCP_PORT, ORACLE_USER, Firebase VITE_* vars)

### Security
- Updated `.npmignore` to exclude sensitive files and directories from published package

## [3.0.0] - 2025-07-11

### Added
- Initial public release of CodeAtlas MCP Server
- MCP protocol support with local-first architecture
- Oracle 26ai integration for persistent memory
- Firebase Admin SDK for telemetry (optional)
- Express.js backend with middleware stack
- AST analysis and codebase intelligence tools
- Dream memory management via MCP tools
- Genome and immune system pattern scanning
- CLI hooks for Claude integration

### Features
- `query_dream_memories`, `save_dream_memory`, `manage_dream_memory`
- `search_entities`, `get_file_entities`, `get_dependencies`
- `trace_feature_flow`, `generate_system_flow`, `generate_feature_flow_diagram`
- `search_genome`, `scan_immune_genes`
- Authentication via API key or Firebase JWT
- Multi-tenant support
- Rate limiting and CORS controls

### Documentation
- README.md with setup, usage, and architecture
- CONTRIBUTING.md with contribution guidelines
- CODE_OF_CONDUCT.md
- docs/DEVELOPMENT.md with environment variables and troubleshooting
- docs/DEPLOYMENT.md with PM2, systemd, Nginx, Docker guides
- docs/API_EXAMPLES.md with MCP tool usage examples

### Security
- Bind variables for all SQL queries
- No `any` types — uses `unknown`
- Error handling for database operations
- Secure credential storage via environment variables
- Restricted CORS origins
- Rate limiting on public endpoints

---

Format based on [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).
