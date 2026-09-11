import { cpSync, readdirSync, chmodSync, existsSync } from 'fs';
import { join } from 'path';

const SRC = 'src/cli/hooks';
const DEST = 'dist/src/cli/hooks';
const SETUP_CLI = 'src/cli/setup-claude.js';
const SETUP_CLI_DEST = 'dist/src/cli/setup-claude.js';

if (!process.platform.startsWith('win')) {
  // Ensure main binary is executable
  const DIST_INDEX = 'dist/index.js';
  if (existsSync(DIST_INDEX)) {
    chmodSync(DIST_INDEX, 0o755);
  }

  // Copy hooks
  cpSync(SRC, DEST, { recursive: true });
  for (const name of readdirSync(DEST)) {
    if (name.endsWith('.sh') || name.endsWith('.py')) {
      chmodSync(join(DEST, name), 0o755);
    }
  }
  
  // Copy setup script
  if (existsSync(SETUP_CLI)) {
    cpSync(SETUP_CLI, SETUP_CLI_DEST);
    chmodSync(SETUP_CLI_DEST, 0o755);
  }
}
