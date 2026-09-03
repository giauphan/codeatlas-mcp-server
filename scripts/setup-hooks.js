#!/usr/bin/env node
/**
 * setup-hooks.js - Comprehensive hook setup system for CodeAtlas Claude integration
 * 
 * This script provides:
 * 1. Easy hook installation to ~/.claude/hooks/
 * 2. Automatic settings.json configuration with new flow
 * 3. Update capability for existing installations
 * 4. Status checking
 * 5. Cleanup/uninstall
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..');
const HOOKS_SRC = path.join(REPO_ROOT, 'src', 'cli', 'hooks');
const CLAUDE_DIR = path.join(process.env.HOME || '/root', '.claude');
const HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');

const HOOK_SCRIPTS = [
  'brain-context.sh',
  'brain-save.sh', 
  'task-router.sh'
];

const NEW_HOOK_NAMES = {
  'brain-context.sh': 'codeatlas hook brain-context',
  'brain-save.sh': 'codeatlas hook brain-save',
  'task-router.sh': 'codeatlas hook task-router'
};

function printHeader(title) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60) + '\n');
}

function printSuccess(message) {
  console.log(`✅  ${message}`);
}

function printWarning(message) {
  console.log(`⚠️  ${message}`);
}

function printError(message) {
  console.log(`❌  ${message}`);
}

function printInfo(message) {
  console.log(`ℹ️  ${message}`);
}

function checkPrerequisites() {
  printHeader('Checking Prerequisites');
  
  // Check if we're in the right directory
  if (!fs.existsSync(path.join(REPO_ROOT, 'package.json'))) {
    printError('Please run this script from the codeatlas-mcp-server repository root.');
    process.exit(1);
  }
  printSuccess('Repository root detected');

  // Check if hook scripts exist
  for (const hook of HOOK_SCRIPTS) {
    const hookPath = path.join(HOOKS_SRC, hook);
    if (!fs.existsSync(hookPath)) {
      printError(`Hook script not found: ${hookPath}`);
      process.exit(1);
    }
  }
  printSuccess('All hook scripts found');
  
  // Check if ~/.claude directory exists
  if (!fs.existsSync(CLAUDE_DIR)) {
    printWarning(`~/.claude directory not found. This may mean Claude CLI is not installed.`);
    console.log(`   You may need to install Claude CLI first: https://claude.ai/cli`);
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve) => {
      rl.question('Continue anyway? (y/N): ', (answer) => {
        rl.close();
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          // Create the directory
          fs.mkdirSync(CLAUDE_DIR, { recursive: true });
          printInfo(`Created ${CLAUDE_DIR} directory`);
          resolve();
        } else {
          printError('Setup cancelled.');
          process.exit(0);
        }
      });
    });
  }
  
  return Promise.resolve();
}

function getCurrentSetup() {
  const status = {
    hooksInstalled: false,
    settingsConfigured: false,
    settingsContent: null,
    hookFiles: [],
    wrapperExists: false
  };

  // Check if hooks directory exists and has our files
  if (fs.existsSync(HOOKS_DIR)) {
    const files = fs.readdirSync(HOOKS_DIR);
    
    // Check for wrapper
    const wrapperPath = path.join(HOOKS_DIR, 'codeatlas');
    status.wrapperExists = fs.existsSync(wrapperPath);
    
    // Check for individual hook files
    for (const hook of HOOK_SCRIPTS) {
      const installedPath = path.join(HOOKS_DIR, hook);
      status.hookFiles.push({
        name: hook,
        exists: fs.existsSync(installedPath),
        path: installedPath
      });
    }
    
    status.hooksInstalled = status.hookFiles.every(f => f.exists) || status.wrapperExists;
  }

  // Check settings.json
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      status.settingsContent = settings;
      status.settingsConfigured = settings.hooks && 
        Object.values(settings.hooks).some((arr) => 
          arr && Array.isArray(arr) && arr.some(h => h && h.includes('codeatlas'))
        );
    } catch (e) {
      printWarning(`Could not parse ${SETTINGS_FILE}: ${e.message}`);
    }
  }

  return status;
}

function printStatus(currentSetup) {
  printHeader('Current Setup Status');
  
  console.log('Hook Scripts:');
  for (const hook of currentSetup.hookFiles) {
    const status = hook.exists ? '✅' : '❌';
    console.log(`  ${status} ${hook.name}`);
  }
  console.log(`  ${currentSetup.wrapperExists ? '✅' : '❌'} codeatlas wrapper`);
  
  console.log('\nSettings:');
  if (currentSetup.settingsContent) {
    console.log(`  ✅ ${SETTINGS_FILE} exists`);
    console.log(`  ${currentSetup.settingsConfigured ? '✅' : '❌'} CodeAtlas hooks configured`);
  } else {
    console.log(`  ❌ ${SETTINGS_FILE} not found or invalid`);
  }
}

function installHooks(force = false) {
  printHeader('Installing CodeAtlas Hooks');
  
  // Create hooks directory
  if (!fs.existsSync(HOOKS_DIR)) {
    fs.mkdirSync(HOOKS_DIR, { recursive: true });
    printSuccess(`Created ${HOOKS_DIR}`);
  }

  // Copy hook scripts
  for (const hook of HOOK_SCRIPTS) {
    const src = path.join(HOOKS_SRC, hook);
    const dest = path.join(HOOKS_DIR, hook);
    
    if (fs.existsSync(dest) && !force) {
      printWarning(`Hook ${hook} already exists, skipping (use --force to overwrite)`);
      continue;
    }
    
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
    printSuccess(`Installed ${hook}`);
  }

  // Create codeatlas wrapper script
  const wrapperPath = path.join(HOOKS_DIR, 'codeatlas');
  const wrapperContent = '#!/bin/bash\n' +
    'set -euo pipefail\n' +
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
    'if [ "${1:-}" != "hook" ]; then\n' +
    '  echo "usage: codeatlas hook <brain-context|brain-save|task-router>" >&2\n' +
    '  exit 2\n' +
    'fi\n' +
    'case "${2:-}" in\n' +
    '  brain-context) exec "$SCRIPT_DIR/brain-context.sh" ;;\n' +
    '  brain-save) exec "$SCRIPT_DIR/brain-save.sh" ;;\n' +
    '  task-router) exec "$SCRIPT_DIR/task-router.sh" ;;\n' +
    '  *) echo "unknown codeatlas hook: ${2:-}" >&2; exit 2 ;;\n' +
    'esac\n';
  
  fs.writeFileSync(wrapperPath, wrapperContent);
  fs.chmodSync(wrapperPath, 0o755);
  printSuccess('Created codeatlas wrapper');

  return true;
}

function configureSettings(force = false) {
  printHeader('Configuring Claude Settings');
  
  let settings = {};
  
  // Load existing settings if they exist
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      printInfo('Loaded existing settings');
    } catch (e) {
      printWarning(`Could not parse existing settings: ${e.message}, starting fresh`);
    }
  }

  // Backup existing settings with timestamp
  if (fs.existsSync(SETTINGS_FILE)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${SETTINGS_FILE}.codeatlas-backup-${timestamp}`;
    fs.copyFileSync(SETTINGS_FILE, backupPath);
    printInfo(`Backed up existing settings to ${backupPath}`);
  }

  // Merge hooks configuration - preserve existing hooks for other tools
  if (!settings.hooks) {
    settings.hooks = {};
  }
  
  // Add our hooks, preserving any existing hooks
  if (!settings.hooks.prePrompt) {
    settings.hooks.prePrompt = [];
  }
  
  // Remove any old codeatlas hooks first
  settings.hooks.prePrompt = settings.hooks.prePrompt.filter(
    h => !h || typeof h !== 'string' || !h.includes('codeatlas')
  );
  
  // Add our brain-context hook to prePrompt, but avoid duplicates
  if (!settings.hooks.prePrompt.includes("codeatlas hook brain-context")) {
    settings.hooks.prePrompt.push("codeatlas hook brain-context");
  }
  
  if (!settings.hooks.postToolUse) {
    settings.hooks.postToolUse = [];
  }
  
  // Remove any old codeatlas hooks from postToolUse
  settings.hooks.postToolUse = settings.hooks.postToolUse.filter(
    h => !h || typeof h !== 'string' || !h.includes('codeatlas')
  );
  
  // Add our hooks to postToolUse, avoiding duplicates
  const ourHooks = ["codeatlas hook brain-save", "codeatlas hook task-router"];
  for (const hook of ourHooks) {
    if (!settings.hooks.postToolUse.includes(hook)) {
      settings.hooks.postToolUse.push(hook);
    }
  }

  // Write the updated settings
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
  fs.chmodSync(SETTINGS_FILE, 0o600);
  printSuccess(`Updated ${SETTINGS_FILE}`);

  return true;
}

function uninstallHooks() {
  printHeader('Uninstalling CodeAtlas Hooks');

  if (!fs.existsSync(HOOKS_DIR)) {
    printWarning(`Hooks directory ${HOOKS_DIR} not found, nothing to uninstall.`);
    return true;
  }

  // Remove our hook files
  const filesToRemove = [
    'brain-context.sh',
    'brain-save.sh',
    'task-router.sh',
    'codeatlas',
    'install-brain-hooks.sh'
  ];

  for (const file of filesToRemove) {
    const filePath = path.join(HOOKS_DIR, file);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
      printSuccess(`Removed ${file}`);
    }
  }

  // Remove from settings.json if it exists
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      let settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      const hadHooks = settings.hooks && 
        Object.values(settings.hooks).some(arr => 
          arr && arr.some(h => h && h.includes('codeatlas'))
        );
      
      if (hadHooks) {
        // Remove codeatlas hooks
        if (settings.hooks && settings.hooks.prePrompt) {
          settings.hooks.prePrompt = settings.hooks.prePrompt.filter(
            h => !h || !h.includes('codeatlas')
          );
        }
        if (settings.hooks && settings.hooks.postToolUse) {
          settings.hooks.postToolUse = settings.hooks.postToolUse.filter(
            h => !h || !h.includes('codeatlas')
          );
        }
        
        // Clean up empty arrays
        if (settings.hooks) {
          if (settings.hooks.prePrompt && settings.hooks.prePrompt.length === 0) {
            delete settings.hooks.prePrompt;
          }
          if (settings.hooks.postToolUse && settings.hooks.postToolUse.length === 0) {
            delete settings.hooks.postToolUse;
          }
          if (Object.keys(settings.hooks).length === 0) {
            delete settings.hooks;
          }
        }
        
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
        printSuccess(`Updated ${SETTINGS_FILE}`);
      }
    } catch (e) {
      printWarning(`Could not update settings: ${e.message}`);
    }
  }

  return true;
}

function updateHooks() {
  printHeader('Updating CodeAtlas Hooks');
  
  // First uninstall old versions
  printInfo('Removing old hook files...');
  uninstallHooks();
  
  // Then reinstall fresh
  printInfo('Installing new hook files...');
  installHooks(true);
  
  // Reconfigure settings
  printInfo('Updating settings...');
  configureSettings(true);
  
  printSuccess('CodeAtlas hooks updated successfully!');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const force = args.includes('--force') || args.includes('-f');

  try {
    await checkPrerequisites();
    
    switch (command) {
      case 'install':
      case 'setup':
        installHooks(force);
        configureSettings(force);
        printSuccess('\n✅ CodeAtlas hooks installed successfully!');
        console.log('\nTo activate the hooks:');
        console.log('1. Ensure CODEATLAS_API_KEY and CODEATLAS_API_URL are set in your environment');
        console.log('2. Set CODEATLAS_INJECT_BRAIN_CONTEXT=1 if you want brain-context.sh to inject memory');
        console.log('3. Restart Claude CLI');
        break;

      case 'update':
        updateHooks();
        break;

      case 'uninstall':
      case 'remove':
        uninstallHooks();
        printSuccess('\n✅ CodeAtlas hooks uninstalled successfully!');
        break;

      case 'status':
      case 'check':
        const currentSetup = getCurrentSetup();
        printStatus(currentSetup);
        
        if (currentSetup.hooksInstalled && currentSetup.settingsConfigured) {
          printSuccess('\n✅ CodeAtlas hooks are properly installed and configured!');
        } else {
          printWarning('\n⚠️  CodeAtlas hooks are not fully configured.');
          console.log('Run: npm run setup:hooks');
        }
        break;

      case undefined:
      case 'help':
      case '-h':
      case '--help':
      default:
        printHeader('CodeAtlas Hooks Setup - Usage');
        console.log('Commands:');
        console.log('  npm run setup:hooks install   - Install hooks to Claude CLI');
        console.log('  npm run setup:hooks update    - Update existing hook installation');
        console.log('  npm run setup:hooks uninstall - Remove hooks from Claude CLI');
        console.log('  npm run setup:hooks status    - Check current installation status');
        console.log('\nYou can also use:');
        console.log('  npm run install:hooks         - Same as install (legacy)');
        console.log('\nOptions:');
        console.log('  --force, -f                   - Force overwrite existing files');
        console.log('\nEnvironment Variables:');
        console.log('  CODEATLAS_API_KEY            - Your CodeAtlas API key');
        console.log('  CODEATLAS_API_URL            - CodeAtlas server URL');
        console.log('  CODEATLAS_INJECT_BRAIN_CONTEXT=1 - Enable brain context injection');
        break;
    }
  } catch (error) {
    printError(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Handle --version
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log('CodeAtlas Hooks Setup v1.0.0');
  console.log('Part of codeatlas-mcp-server');
  process.exit(0);
}

main().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
