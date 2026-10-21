# Pre-push checks

GitHub Actions runs checks on pushes to `main` and pull requests targeting
`main`. The workflows have distinct jobs and dependencies; they do not all run
the same check list. See the [pipeline runbook](../docs/PIPELINE.md) for the
exact workflow graph and release flow.

## Optional local Git hook

In a regular clone (not a linked Git worktree), install the local pre-push hook
from the repository root:

```bash
./scripts/setup-git-hooks.sh
```

The hook runs these commands, in order:

1. `npm run lint`
2. `npm run build`
3. `npm run verify-build`
4. `npm test`

If any check fails, the hook rejects the push. To inspect full test output, run
`npm test` directly; the hook suppresses build and test command output.

The hook is installed locally and is not itself a GitHub Actions workflow.
GitHub Actions still runs for configured pushes and pull requests if a local
hook is absent or skipped.

The installer writes directly to `.git/hooks/pre-push`, which works when
`.git` is a directory in a regular clone. In a linked worktree `.git` is a
file, so this installer does not install into the active worktree's hooks
directory.
