# Pre-Push Code Quality Checks

This repository uses Git hooks to ensure code quality before allowing pushes to the main branch.

## How It Works

### GitHub Actions CI Checks (Automatic)

The repository has GitHub Actions workflows that run on every push and pull request:

- **`.github/workflows/pre-push-tests.yml`** - Runs type checking, tests, and build verification
- **`.github/workflows/ci.yml`** - Existing CI workflow for lint, build, and test

These ensure that any code pushed to `main` or in pull requests passes all quality checks.

### Local Pre-Push Hook (Optional but Recommended)

For local development, you can set up a Git pre-push hook that runs the same checks before allowing you to push.

#### Setup Instructions

```bash
# From the repository root directory:
./scripts/setup-git-hooks.sh
```

This will:
1. Create the `.git/hooks` directory if it doesn't exist
2. Install the pre-push hook script
3. Make it executable

#### What the Hook Checks

1. **TypeScript Type Checking** (`npm run lint`)
   - Ensures no TypeScript compilation errors
   - Runs `tsc --noEmit` to check types without emitting files

2. **Build Verification** (`npm run build` + `npm run verify-build`)
   - Builds the project to ensure it compiles
   - Verifies the build output is valid

3. **Tests** (`npm test`)
   - Runs the full test suite
   - Ensures all 95+ tests pass

#### Skipping the Hook

If you need to push changes without running the checks (not recommended):

```bash
git push --no-verify
```

Or to temporarily disable a specific hook:

```bash
mv .git/hooks/pre-push .git/hooks/pre-push.disabled
```

## Recommendations

1. **Always run the pre-push hook** to catch issues early
2. **Fix failing tests locally** before creating pull requests
3. **Use feature branches** for development and test thoroughly before merging to main
4. **Review CI results** on GitHub - the workflows will run regardless of local hooks

## Troubleshooting

If the hook is taking too long:
- The hook runs tests in silent mode (`> /dev/null 2>&1`) for speed
- To see detailed output, run the commands manually:
  ```bash
  npm run lint
  npm run build
  npm run verify-build
  npm test
  ```

If you believe the hook is malfunctioning:
- Check the hook script at `.git/hooks/pre-push`
- Verify it's executable: `chmod +x .git/hooks/pre-push`
- Test it manually: `./.git/hooks/pre-push`

## Integration with CI/CD

The GitHub Actions workflows provide an additional safety net:
- Even if someone uses `--no-verify`, the CI workflows will still run
- Pull requests must pass all checks before they can be merged
- The `pre-push-tests.yml` workflow runs the same checks as the local hook

This provides defense-in-depth:
- ✅ Local development: pre-push hook (optional)
- ✅ GitHub push: CI workflows (automatic)
- ✅ Pull requests: CI workflows (automatic)