# Development Guide

## Requirements

- Node.js 20 or newer (the package declares `>=20.0.0`). The CI build, test,
  release, and pre-push workflow jobs currently use Node 22; CI lint uses Node
  20.
- npm for the commands used by CI. This repository also keeps a pnpm lockfile
  and workspace configuration; keep both lockfiles in sync when changing
  dependencies. `.npmrc` sets `install-links=false`, and the vendored
  `vendor/original-unmodified-fork.tgz` plus `tools/braces-compat` adapter are
  needed for a clean dependency install.

No Oracle, Firebase, or local HTTP service is required to build and run the MCP
server. Its MCP transport is stdio. Cloud-backed memory and genome features are
optional and use the separate `codeatlas-platform` HTTP API.

## Install and run

```bash
npm ci
npm run build
npm start
```

For development, `npm run dev` runs `index.ts` through `tsx`. Configure an MCP
client to launch the package executable and communicate over stdio; the server
does not open an HTTP or SSE listener.

Cloud features are disabled unless configured. To connect them, set
`CODEATLAS_API_URL` to the platform API base URL and provide
`CODEATLAS_API_KEY`. During normal MCP startup, the server loads `.env` from
the working directory and then `~/.codeatlas/.env` without overriding existing
process variables. One-shot CLI commands are dispatched before dotenv loading,
so export the URL and key in the launching process; the API key may also be
resolved from supported MCP client or CodeAtlas config files. See the
environment variable table in the [root README](../README.md). Do not put
credentials in committed files.

## Package scripts

| Command | Purpose |
|---|---|
| `npm run build` | Clean and compile production output to `dist/`, then copy runtime hooks and CLI files. |
| `npm run verify-build` | Check `dist/` for test files, source maps, and hardcoded fallback URLs. |
| `npm run lint` | TypeScript type-check with `tsc --noEmit`. |
| `npm test` | Run the Node test suite through `tsx`. |
| `npm run coverage` | Run tests with a text coverage report. The CI coverage gate is 40% lines. |
| `npm start` | Start the compiled stdio MCP server (or handle supported one-shot CLI commands). |
| `npm run dev` | Start the TypeScript entry point through `tsx`. |
| `npm run setup:hooks` | Install CodeAtlas Claude hooks into the current user's Claude configuration. |
| `npm run validate:hooks` | Validate an installed Claude hooks setup. |

The `setup:hooks` command configures Claude runtime hooks. The separate
`scripts/setup-git-hooks.sh` script installs a Git pre-push hook.

## Checks before opening a pull request

Run the checks relevant to the change:

```bash
npm run lint
npm run build
npm run verify-build
npm test
```

CI also runs `npm pack --dry-run` to inspect package contents and enforces a
40% line coverage threshold on the main CI workflow. The [pipeline runbook](./PIPELINE.md)
describes the automated workflows and release behavior.

An optional local Git pre-push hook can be installed with
`./scripts/setup-git-hooks.sh`. It runs lint, build, build verification, and
tests before a push. GitHub Actions still runs independently.

## Code and dependency changes

- Keep TypeScript strict and avoid adding `any` without a clear reason.
- Add or update tests for behavior changes.
- Preserve the `npm ci` cold-checkout path, the pnpm workspace lockfile, and
  the local braces compatibility package when changing dependencies.
- Use Conventional Commit messages; release automation uses them to determine
  whether a version should be published.

See [Contributing](../CONTRIBUTING.md) for the pull request workflow.
