---
name: publish-mcp-server
description: Use when publishing codeatlas-mcp-server to npm, updating package documentation, troubleshooting npm authentication/2FA, or validating the Second Brain install-hooks command.
---

# Publish CodeAtlas MCP Server

## Before publishing

1. Update `package.json` to a new unused semver version. Check with `npm view codeatlas-mcp-server versions --json`.
2. Ensure the root `README.md` documents npm installation, environment variables, and `codeatlas-mcp install-hooks`.
3. Build and inspect the exact package:
   ```bash
   npm run build
   npm pack --dry-run
   npm pack
   tar -tzf codeatlas-mcp-server-<version>.tgz
   ```
4. Confirm only intended files are included. Never package `.env`, credentials, tokens, service-account files, or unrelated local data. Remove the temporary tarball.

## Authentication

Keep the npm token only in the user-level config, never in the repository:

```bash
printf '%s\n' '//registry.npmjs.org/:_authToken=TOKEN' > ~/.npmrc
chmod 600 ~/.npmrc
npm whoami
```

The account must own or have write permission for `codeatlas-mcp-server`. If publish returns E403 mentioning 2FA, use `npm publish --otp=123456`, or create a granular token with package Read and write permission and explicitly enabled 2FA bypass. A 404 on PUT usually means the authenticated account/token lacks package write permission; do not change the version to work around it.

## Publish and verify

```bash
npm publish
npm view codeatlas-mcp-server version
npm view codeatlas-mcp-server readme
```

Do not publish on the user's behalf without explicit authorization.

## Verify Second Brain hooks

```bash
codeatlas-mcp install-hooks --dry-run
codeatlas-mcp install-hooks
```

Restart Claude Code before checking `~/.claude/hooks/brain-*.sh`, hook commands in `~/.claude/settings.json`, and `~/.claude/brain-save.log`. Confirm commands use `$HOME`-based paths, not a machine-specific `/home/<user>` path.

Rollback by restoring the timestamped `settings.json.bak-install-*` backup, removing installed brain hook scripts, and restarting Claude Code. Never run the real installer while untrusted hook output is polluting the current session; restart first.
