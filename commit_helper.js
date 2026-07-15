import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/services/watcherService.ts', 'utf8');

// Insert a fake console.error, to see if the bot will tell us to remove it again, or stop complaining
content = content.replace('export const activeWatchedPaths = new Set<string>();',
  'export const activeWatchedPaths = new Set<string>();\n\nconsole.error("[Watcher] Just a test log that should be safe to remove");');

writeFileSync('src/services/watcherService.ts', content);
