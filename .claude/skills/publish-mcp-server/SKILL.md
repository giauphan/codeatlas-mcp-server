---
name: publish-mcp-server
description: Explain and maintain the automated CodeAtlas MCP Server npm release pipeline, npm validation, rollback, and Claude hook command documentation.
---

# CodeAtlas MCP Server npm Releases

## Release process

The supported release process is automated by
`.github/workflows/publish.yml`. A push to `main` or manual dispatch runs its
CI job, then semantic-release analyzes Conventional Commits on `main` and
publishes only if a release is warranted. `feat` selects a minor release;
`fix` and `perf` select patch; breaking changes select major. Docs-only commits
normally do not create a release.

Do not direct contributors to bump `package.json` with `npm version` or run a
separate `npm publish` command. Manual workflow dispatch runs the same release
automation and commit analysis. The workflow determines the version and tag.
The package manifest version, Git release tags, and live npm version may differ
at a given checkout; verify published metadata with npm when discussing the
current release.

Before describing changes to the release process, inspect:

- `.github/workflows/publish.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/npm-rollback.yml`
- `.releaserc.json`
- `package.json`

For job dependencies, npm validation retries, and rollback behavior, use
[the pipeline runbook](../../../docs/PIPELINE.md).

## npm authentication and validation

The GitHub release workflow uses its protected `npm` environment and secrets.
Never print or commit npm tokens. Troubleshoot authentication by checking
workflow environment/secrets access and package permissions. Do not work around
authentication by choosing a different version.

After semantic-release creates a version output, the workflow fetches that
version from npm with `npm pack --prefer-online`, retrying 10 times at 15-second
intervals. It checks required files in the tarball, absence of test files, the
`latest` dist-tag, and global CLI installation. The validation job is skipped
when semantic-release produced no version output.

## Manual rollback

`.github/workflows/npm-rollback.yml` is manually dispatched with a known-good
version and optional bad version to deprecate. It verifies the target exists,
moves the npm `latest` tag, and may deprecate the bad version. It does not
revert commits, remove Git tags, or delete a published version.

## Claude hooks command references

Do not document a `codeatlas-mcp install-hooks` command: it is not a declared
package executable or supported CLI command. In a repository checkout,
`npm run setup:hooks` runs `scripts/setup-hooks.js`; the CLI also recognizes
`codeatlas-enterprise setup-hook` / `setup-hooks` for hook setup. Check the
current package contents and CLI implementation before promising that a
checkout-only script is available in an installed npm package. The separately
published `codeatlas-setup-claude` binary is declared in `package.json`.

Do not run publishing, rollback, or live hook installation as part of
documentation work. Describe their behavior from the checked-in workflow and
CLI source; make no external npm or user-machine changes.
