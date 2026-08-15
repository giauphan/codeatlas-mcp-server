# Contributing to CodeAtlas MCP Server

Thank you for contributing! Please read this guide before opening a PR.

## Requirements

- Node.js >= 20.0.0
- pnpm 9 (`corepack enable && corepack prepare pnpm@9 --activate`)

## Setup

```bash
git clone https://github.com/giauphan/codeatlas-mcp-server.git
cd codeatlas-mcp-server
pnpm install
cp .env.example .env
# Edit .env with your credentials
pnpm run build
pnpm test
```

## Project Structure

```
codeatlas-mcp-server/
├── src/
│   ├── index.ts             # Entry point
│   ├── cli/                 # CLI hooks (brain-context, brain-save)
│   ├── tools/               # MCP tool implementations
│   └── utils/               # Shared utilities
├── dist/                    # Compiled output (git-ignored)
├── docs/                    # Documentation
├── .env.example             # Environment variable template
└── package.json
```

## Workflow

1. Fork and create a branch with a prefix:
   - `feat/` — new feature
   - `fix/` — bug fix
   - `docs/` — documentation only
   - `refactor/` — code restructure
   - `test/` — tests only

2. Make changes with tests where applicable.

3. Run quality gate before opening PR:
   ```bash
   pnpm run build && pnpm test
   ```

4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add new AST parser for Ruby
   fix: handle null dependency graph nodes
   docs: update MCP tools table
   ```

5. Open a Pull Request against `main`.

## Code Standards

- TypeScript strict mode — no `any` types.
- Meaningful variable names, no abbreviations.
- Comments only for non-obvious logic.
- All public functions must have return type annotations.

## Questions?

Open an [issue](https://github.com/giauphan/codeatlas-mcp-server/issues) or
[discussion](https://github.com/giauphan/codeatlas-mcp-server/discussions).

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for community standards.
