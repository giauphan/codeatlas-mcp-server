#!/bin/bash

# setup-git-hooks.sh
# Sets up Git hooks for the codeatlas-mcp-server repository
# Run this script to enable pre-push testing

echo "Setting up Git hooks..."

# Create hooks directory if it doesn't exist
GIT_HOOKS_DIR="$(git rev-parse --show-toplevel)/.git/hooks"
mkdir -p "$GIT_HOOKS_DIR"

# Create pre-push hook
PRE_PUSH_HOOK="$GIT_HOOKS_DIR/pre-push"

cat > "$PRE_PUSH_HOOK" << 'HOOK_SCRIPT'
#!/bin/bash

# Git pre-push hook for codeatlas-mcp-server
# This hook runs tests before allowing a push to ensure code quality

echo "Running pre-push checks for codeatlas-mcp-server..."

# Store exit code
EXIT_CODE=0

# 1. Run TypeScript type checking
echo "🔍 Running TypeScript type check..."
npm run lint
if [ $? -ne 0 ]; then
    echo "❌ TypeScript type check failed!"
    EXIT_CODE=1
else
    echo "✅ TypeScript type check passed"
fi

# 2. Run build verification
echo "🔍 Running build verification..."
npm run build > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    EXIT_CODE=1
else
    echo "✅ Build passed"
fi

npm run verify-build > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Build verification failed!"
    EXIT_CODE=1
else
    echo "✅ Build verification passed"
fi

# 3. Run tests (silent mode for faster execution)
echo "🔍 Running tests..."
npm test > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Tests failed!"
    echo "Run 'npm test' to see detailed test failures"
    EXIT_CODE=1
else
    echo "✅ All tests passed"
fi

if [ $EXIT_CODE -ne 0 ]; then
    echo ""
    echo "🛑 Push rejected: Pre-push checks failed!"
    echo "Please fix the issues above and try pushing again."
    echo "To skip these checks, use: git push --no-verify"
    exit 1
else
    echo ""
    echo "✅ All pre-push checks passed!"
    echo "Push allowed."
fi

exit $EXIT_CODE
HOOK_SCRIPT

# Make hook executable
chmod +x "$PRE_PUSH_HOOK"

echo "✅ Pre-push hook installed successfully!"
echo ""
echo "The hook will now run tests before each push."
echo "To skip the checks for a specific push, use: git push --no-verify"
echo ""