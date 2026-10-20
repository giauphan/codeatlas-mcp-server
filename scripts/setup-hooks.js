#!/usr/bin/env node
import { installClaudeHooks } from './claude-hook-settings.js';
try {
  const result = installClaudeHooks(process.argv[2]);
  console.log(`CodeAtlas Claude hooks installed in ${result.settingsPath}`);
  console.log('Context injection remains opt-in via CODEATLAS_INJECT_BRAIN_CONTEXT=1.');
} catch {
  console.error('CodeAtlas hook setup failed: settings could not be read or safely merged, or required assets are missing.');
  process.exit(1);
}
