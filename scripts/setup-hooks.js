#!/usr/bin/env node
/**
 * Setup Claude hooks for CodeAtlas MCP Server
 *
 * This script:
 * 1. Cleans up old CodeAtlas hook configurations ONLY (preserves all other hooks)
 * 2. Installs hook scripts to ~/.claude/hooks/
 * 3. Creates the codeatlas wrapper for new hook syntax
 * 4. Updates ~/.claude/settings.json with proper nested hooks format
 * 5. Registers brain-save, brain-context, task-router hooks for Claude Code
 *
 * Usage: node scripts/setup-hooks.js
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync } from 'fs';
import { homedir, platform } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const HOOKS_SRC = join(REPO_ROOT, 'src', 'cli', 'hooks');
const CLAUDE_HOOKS_DIR = join(homedir(), '.claude', 'hooks');
const SETTINGS_FILE = join(homedir(), '.claude', 'settings.json');

console.log('🚀 Starting CodeAtlas Claude hooks setup...');

try {
  // Validate source files exist
  const requiredHooks = ['brain-save.sh', 'brain-context.sh', 'task-router.sh'];
  for (const hook of requiredHooks) {
    const srcPath = join(HOOKS_SRC, hook);
    if (!existsSync(srcPath)) {
      throw new Error(`❌ Missing source hook: ${srcPath}`);
    }
  }

  // Create Claude hooks directory if it doesn't exist
  mkdirSync(CLAUDE_HOOKS_DIR, { recursive: true });
  console.log(`✅ Created hooks directory: ${CLAUDE_HOOKS_DIR}`);

  // Copy hook scripts
  copyFileSync(join(HOOKS_SRC, 'brain-save.sh'), join(CLAUDE_HOOKS_DIR, 'brain-save.sh'));
  copyFileSync(join(HOOKS_SRC, 'brain-context.sh'), join(CLAUDE_HOOKS_DIR, 'brain-context.sh'));
  copyFileSync(join(HOOKS_SRC, 'task-router.sh'), join(CLAUDE_HOOKS_DIR, 'task-router.sh'));

  // Make executable
  chmodSync(join(CLAUDE_HOOKS_DIR, 'brain-save.sh'), 0o755);
  chmodSync(join(CLAUDE_HOOKS_DIR, 'brain-context.sh'), 0o755);
  chmodSync(join(CLAUDE_HOOKS_DIR, 'task-router.sh'), 0o755);
  console.log('✅ Copied and made executable: brain-save.sh, brain-context.sh, task-router.sh');

  // Create codeatlas wrapper for new hook syntax
  // Use String.raw to avoid template literal interpretation issues
  const wrapperLines = [
    '#!/bin/bash',
    'set -euo pipefail',
    `HOOKS_DIR="${CLAUDE_HOOKS_DIR}"`,
    'if [ "${1:-}" != "hook" ]; then',
    '  echo "usage: codeatlas hook <brain-context|brain-save|task-router>" >&2',
    '  exit 2',
    'fi',
    'case "${2:-}" in',
    '  brain-context) exec "$HOOKS_DIR/brain-context.sh" ;;',
    '  brain-save) exec "$HOOKS_DIR/brain-save.sh" ;;',
    '  task-router) exec "$HOOKS_DIR/task-router.sh" ;;',
    '  *) echo "unknown codeatlas hook: ${2:-}" >&2; exit 2 ;;',
    'esac',
    ''
  ];
  const wrapperContent = wrapperLines.join('\n');

  writeFileSync(join(CLAUDE_HOOKS_DIR, 'codeatlas'), wrapperContent);
  chmodSync(join(CLAUDE_HOOKS_DIR, 'codeatlas'), 0o755);
  console.log('✅ Created codeatlas wrapper for new hook syntax');

  // Clean up and update settings.json with new hook registration format
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let settings = {};

  // Backup existing settings
  if (existsSync(SETTINGS_FILE)) {
    try {
      const backupFile = `${SETTINGS_FILE}.bak-setup-${timestamp}`;
      copyFileSync(SETTINGS_FILE, backupFile);
      console.log(`✅ Backed up existing settings to: ${backupFile}`);

      // Load existing settings
      const content = readFileSync(SETTINGS_FILE, 'utf8');
      settings = JSON.parse(content);
    } catch (err) {
      console.warn(`⚠️  Could not read existing settings: ${err.message}`);
    }
  }

  // Initialize hooks if not present
  if (!settings.hooks) settings.hooks = {};

  // Helper to get hooks array for an event (handles both nested and flat formats)
  const getHooksArray = (event) => {
    if (!settings.hooks[event] || !Array.isArray(settings.hooks[event])) {
      return [];
    }
    
    // If first element has 'hooks' property (nested format), return that
    if (settings.hooks[event].length > 0 && settings.hooks[event][0].hooks) {
      return settings.hooks[event][0].hooks || [];
    }
    
    // Flat format - return the array directly
    return settings.hooks[event] || [];
  };

  // Helper to set hooks array for an event (uses nested format)
  const setHooksArray = (event, hooks) => {
    settings.hooks[event] = [{
      hooks: hooks
    }];
  };

  // Clean up old CodeAtlas .sh script hooks from ALL events
  for (const event in settings.hooks) {
    if (settings.hooks[event] && Array.isArray(settings.hooks[event])) {
      const hooks = getHooksArray(event);
      const filtered = hooks.filter(hook => {
        if (!hook) return false;
        if (typeof hook === 'string') {
          // Remove old codeatlas string hooks and .sh script references
          return !hook.includes('codeatlas') && !hook.includes('.sh');
        }
        if (hook.command) {
          // Remove old .sh script hooks that point to our hooks directory
          const isOldCodeAtlas = hook.command.includes('/home/ubuntu/.claude/hooks/') && hook.command.includes('.sh');
          return !isOldCodeAtlas;
        }
        return true;
      });
      
      if (filtered.length > 0) {
        setHooksArray(event, filtered);
      } else {
        delete settings.hooks[event];
      }
    }
  }

  // Add CodeAtlas hooks in nested format
  const preToolUseHooks = getHooksArray('PreToolUse');
  const hasTaskRouter = preToolUseHooks.some(h => h.command === 'codeatlas' && h.args?.includes('task-router'));
  if (!hasTaskRouter) {
    preToolUseHooks.push({ command: 'codeatlas', args: ['hook', 'task-router'] });
  }
  setHooksArray('PreToolUse', preToolUseHooks);

  const sessionStartHooks = getHooksArray('SessionStart');
  const hasBrainContext = sessionStartHooks.some(h => h.command === 'codeatlas' && h.args?.includes('brain-context'));
  if (!hasBrainContext) {
    sessionStartHooks.push({ command: 'codeatlas', args: ['hook', 'brain-context'] });
  }
  setHooksArray('SessionStart', sessionStartHooks);

  const postToolUseHooks = getHooksArray('PostToolUse');
  const hasBrainSave = postToolUseHooks.some(h => h.command === 'codeatlas' && h.args?.includes('brain-save'));
  if (!hasBrainSave) {
    postToolUseHooks.push({ command: 'codeatlas', args: ['hook', 'brain-save'] });
  }
  setHooksArray('PostToolUse', postToolUseHooks);

  // Save updated settings
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
  console.log(`✅ Updated ${SETTINGS_FILE} with clean new hook registration`);

  console.log('\n🎯 Hook Registration Summary:');
  console.log('   PreToolUse:      codeatlas hook task-router');
  console.log('   SessionStart:    codeatlas hook brain-context');
  console.log('   PostToolUse:     codeatlas hook brain-save');

  console.log('\n📋 Next steps:');
  console.log('   1. restart Claude Code to load new hooks');
  console.log('   2. ensure codeatlas-mcp server is running (npm run start)');
  console.log('   3. verify hooks are working with CODEATLAS_TEST_MODE=1');

  console.log('\n✅ Setup complete! CodeAtlas hooks installed successfully.');

} catch (error) {
  console.error(`❌ Setup failed: ${error.message}`);
  process.exit(1);
}
