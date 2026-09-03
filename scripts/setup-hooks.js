#!/usr/bin/env node
/**
 * Setup Claude hooks for CodeAtlas MCP Server
 * 
 * This script:
 * 1. Installs hook scripts to ~/.claude/hooks/
 * 2. Creates the codeatlas wrapper for new hook syntax
 * 3. Updates ~/.claude/settings.json with proper hook registration
 * 4. Registers brain-save and brain-context hooks for Claude Code
 * 
 * Usage: node scripts/setup-hooks.js
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync } from 'fs';
import { homedir, platform } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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
  const wrapperContent = `#!/bin/bash
${platform() === 'win32' ? '@echo off' : ''}
set -euo pipefail
HOOKS_DIR="${CLAUDE_HOOKS_DIR}"
if [ "\${1:-}" != "hook" ]; then
  echo "usage: codeatlas hook <brain-context|brain-save|task-router>" >&2
  exit 2
fi
case "\${2:-}" in
  brain-context) exec "\$HOOKS_DIR/brain-context.sh" ;;
  brain-save) exec "\$HOOKS_DIR/brain-save.sh" ;;
  task-router) exec "\$HOOKS_DIR/task-router.sh" ;;
  *) echo "unknown codeatlas hook: \${2:-}" >&2; exit 2 ;;
esac
`;
  
  writeFileSync(join(CLAUDE_HOOKS_DIR, 'codeatlas'), wrapperContent);
  chmodSync(join(CLAUDE_HOOKS_DIR, 'codeatlas'), 0o755);
  console.log('✅ Created codeatlas wrapper for new hook syntax');

  // Update settings.json with new hook registration format
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
      console.warn(`⚠️ Could not read existing settings: ${err.message}`);
    }
  }

  // Register hooks using the new command flow
  settings.hooks = settings.hooks || {};
  settings.hooks.preToolUse = [
    {
      command: "codeatlas",
      args: ["hook", "task-router"]
    }
  ];
  
  settings.hooks.preSessionStart = [
    {
      command: "codeatlas",
      args: ["hook", "brain-context"]
    }
  ];
  
  settings.hooks.postToolUse = [
    {
      command: "codeatlas",
      args: ["hook", "brain-save"]
    }
  ];

  // Save updated settings
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
  console.log(`✅ Updated ${SETTINGS_FILE} with new hook registration`);
  
  console.log('\n🎯 Hook Registration Summary:');
  console.log('   preToolUse:    codeatlas hook task-router');
  console.log('   preSessionStart: codeatlas hook brain-context'); 
  console.log('   postToolUse:   codeatlas hook brain-save');
  
  console.log('\n📋 Next steps:');
  console.log('   1. restart Claude Code to load new hooks');
  console.log('   2. ensure codeatlas-mcp server is running (npm run start)');
  console.log('   3. verify hooks are working with CLAUDE_TEST_MODE=1');
  
  console.log('\n✅ Setup complete! CodeAtlas hooks installed successfully.');

} catch (error) {
  console.error(`\n❌ Setup failed: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
}
