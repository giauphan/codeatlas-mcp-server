#!/usr/bin/env node
/**
 * Setup Claude Hooks for CodeAtlas MCP Server
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..', '..');
const SETUP_SCRIPT = join(REPO_ROOT, 'scripts', 'setup-hooks.js');

console.log('🚀 CodeAtlas MCP Server - Claude Hooks Setup');
console.log('='.repeat(50));

try {
  if (!existsSync(SETUP_SCRIPT)) {
    console.error(`❌ Setup script not found: ${SETUP_SCRIPT}`);
    process.exit(1);
  }

  console.log('📄 Found setup script, executing...\n');

  execSync(`node ${SETUP_SCRIPT}`, {
    stdio: 'inherit',
    cwd: REPO_ROOT,
  });

  console.log('\n✅ All done!');
} catch (error) {
  console.error(`\n❌ Setup failed: ${error.message}`);
  process.exit(1);
}
