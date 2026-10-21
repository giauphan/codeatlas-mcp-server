# Contributing to CodeAtlas MCP Server

Thank you for helping improve CodeAtlas MCP Server.

## Requirements and setup

- Node.js 20 or newer.
- npm for the install and checks used in GitHub Actions.

From a fresh checkout:

```bash
npm ci
npm run build
npm test
```

The package also tracks a pnpm lockfile and workspace configuration. Preserve
both package lockfiles when changing dependencies. The `.npmrc` setting
`install-links=false` and the checked-in braces compatibility adapter and
vendored archive support reproducible cold installs.

The MCP server uses stdio and can run locally without a cloud service. Oracle,
Firebase, and a separately hosted web application are not prerequisites for
contributing to this package. Cloud-backed memory and genome functionality can
be exercised with `CODEATLAS_API_URL` and `CODEATLAS_API_KEY` configured for the
separate `codeatlas-platform` API.

## Change workflow

1. Create a focused branch for your change.
2. Make the change and update relevant documentation. Add or update tests for
   behavior changes.
3. Run appropriate local checks:

   ```bash
   npm run lint
   npm run build
   npm run verify-build
   npm test
   ```

4. Use a [Conventional Commit](https://www.conventionalcommits.org/) message,
   such as `feat: add Ruby parser`, `fix: handle empty graph nodes`, or
   `docs: clarify local setup`.
5. Open a pull request against `main` and review the GitHub Actions checks.

The detailed workflow dependencies and release rules are in the
[pipeline runbook](./docs/PIPELINE.md). A documentation-only commit normally
does not publish a package because semantic-release only creates releases for
commits whose Conventional Commit type or breaking-change marker selects a
release.

## Code standards

- Keep TypeScript strict and avoid `any` unless needed at an external boundary.
- Use clear names and comments for non-obvious behavior.
- Keep public APIs and security-sensitive behavior covered by focused tests.
- Do not commit credentials, local `.env` files, or machine-specific settings.

See the [Code of Conduct](./CODE_OF_CONDUCT.md) and report bugs through
[GitHub Issues](https://github.com/giauphan/codeatlas-mcp-server/issues).
