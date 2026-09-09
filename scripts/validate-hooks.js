#!/usr/bin/env node
/**
 * Validate CodeAtlas Claude hooks installation
 * 
 * This script validates that:
 * 1. Hook scripts are properly installed in ~/.claude/hooks/
 * 2. Settings.json has correct hook registration
 * 3. Hook scripts are executable and functional
 * 4. codeatlas wrapper works correctly
 * 
 * Usage: node scripts/validate-hooks.js
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

const CLAUDE_HOOKS_DIR = join(homedir(), '.claude', 'hooks');
const SETTINGS_FILE = join(homedir(), '.claude', 'settings.json');

console.log('🔍 Validating CodeAtlas Claude hooks installation...\n');

let allChecks = 0;
let passedChecks = 0;
const results = [];

function check(description, test) {
  allChecks++;
  try {
    const result = test();
    if (result) {
      console.log(`✅ ${description}`);
      passedChecks++;
      results.push({ description, status: 'PASS' });
      return true;
    } else {
      console.log(`❌ ${description}`);
      results.push({ description, status: 'FAIL' });
      return false;
    }
  } catch (error) {
    console.log(`❌ ${description} - Error: ${error.message}`);
    results.push({ description, status: 'ERROR', error: error.message });
    return false;
  }
}

// 1. Check hook directory exists
check('Hook directory exists', () => {
  return existsSync(CLAUDE_HOOKS_DIR);
});

// 2. Check required hook scripts exist
const requiredHooks = ['brain-save.sh', 'brain-context.sh', 'task-router.sh', 'codeatlas'];
for (const hook of requiredHooks) {
  check(`${hook} exists`, () => {
    return existsSync(join(CLAUDE_HOOKS_DIR, hook));
  });
}

// 3. Check hook scripts are executable
for (const hook of requiredHooks) {
  check(`${hook} is executable`, () => {
    const hookPath = join(CLAUDE_HOOKS_DIR, hook);
    if (!existsSync(hookPath)) return false;
    const stats = statSync(hookPath);
    return (stats.mode & 0o111) !== 0; // Check execute permission
  });
}

// 4. Check settings.json exists and has hooks
check('Settings file exists', () => {
  return existsSync(SETTINGS_FILE);
});

check('Settings file contains hook configuration', () => {
  if (!existsSync(SETTINGS_FILE)) return false;
  const settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
  if (!settings.hooks) return false;
  
  // Check for hooks in nested format
  const hasPreToolUse = settings.hooks.PreToolUse && 
    Array.isArray(settings.hooks.PreToolUse) && 
    settings.hooks.PreToolUse.length > 0 &&
    settings.hooks.PreToolUse[0].hooks;
  const hasPostToolUse = settings.hooks.PostToolUse && 
    Array.isArray(settings.hooks.PostToolUse) && 
    settings.hooks.PostToolUse.length > 0 &&
    settings.hooks.PostToolUse[0].hooks;
  const hasSessionStart = settings.hooks.SessionStart && 
    Array.isArray(settings.hooks.SessionStart) && 
    settings.hooks.SessionStart.length > 0 &&
    settings.hooks.SessionStart[0].hooks;
  
  return hasPreToolUse || hasPostToolUse || hasSessionStart;
});

// 5. Test codeatlas wrapper functionality
check('codeatlas wrapper shows correct usage', () => {
  const wrapperPath = join(CLAUDE_HOOKS_DIR, 'codeatlas');
  if (!existsSync(wrapperPath)) return false;
  
  try {
    const output = execFileSync("bash", [wrapperPath], { encoding: 'utf8', timeout: 5000, shell: false });
    return false; // Should exit with error and show usage
  } catch (error) {
    // Expected to fail with usage message - check stderr or stdout
    const errorOutput = error.stderr || error.stdout || '';
    return errorOutput.includes('usage: codeatlas hook') || errorOutput.includes('codeatlas hook <');
  }
});

// 6. Test hook scripts syntax
for (const hook of ['brain-save.sh', 'brain-context.sh', 'task-router.sh']) {
  check(`${hook} has valid bash syntax`, () => {
    const hookPath = join(CLAUDE_HOOKS_DIR, hook);
    if (!existsSync(hookPath)) return false;
    
    try {
      execFileSync("bash", ["-n", hookPath], { timeout: 5000, shell: false });
      return true;
    } catch (error) {
      return false;
    }
  });
}

// 7. Test brain-context.sh in test mode
check('brain-context.sh works in test mode', () => {
  const hookPath = join(CLAUDE_HOOKS_DIR, 'brain-context.sh');
  if (!existsSync(hookPath)) return false;
  
  try {
    const output = execFileSync("bash", [hookPath], {
      encoding: 'utf8',
      timeout: 5000,
      shell: false,
      env: {
        ...process.env,
        CODEATLAS_INJECT_BRAIN_CONTEXT: '1',
        CODEATLAS_TEST_MODE: '1'
      }
    });
    return output.includes('Parser uses ESTree');
  } catch (error) {
    return false;
  }
});

// 8. Test brain-save.sh exits cleanly without API
check('brain-save.sh exits cleanly without API URL', () => {
  const hookPath = join(CLAUDE_HOOKS_DIR, 'brain-save.sh');
  if (!existsSync(hookPath)) return false;
  
  try {
    const output = execFileSync("bash", [hookPath], {
      input: '{"test":"data"}',
      encoding: 'utf8',
      timeout: 5000,
      shell: false,
      env: {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        CODEATLAS_API_KEY: 'test-key'
        // No CODEATLAS_API_URL set
      }
    });
    return true; // Should exit cleanly
  } catch (error) {
    return error.status === 0; // Exit code 0 is success
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`📊 Validation Results: ${passedChecks}/${allChecks} checks passed`);

if (passedChecks === allChecks) {
  console.log('🎉 All hooks are properly installed and functional!');
  console.log('\n📋 Next steps:');
  console.log('   1. Restart Claude Code to load new hooks');
  console.log('   2. Ensure codeatlas-mcp server is running (npm run start)');
  console.log('   3. Test hooks with actual Claude CLI usage');
  process.exit(0);
} else {
  console.log('⚠️  Some validation checks failed.');
  console.log('   Run: codeatlas setup-hook to reinstall hooks');
  process.exit(1);
}