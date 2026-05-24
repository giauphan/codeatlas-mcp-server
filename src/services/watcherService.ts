import chokidar from 'chokidar';
import * as path from 'path';
import { loadAnalysisAsync, registerOnProjectLoaded } from './projectService.js';

export let indexTimeout: NodeJS.Timeout | null = null;
export let watcher: any = null;
export const activeWatchedPaths = new Set<string>();

export function startWatcher() {
  registerOnProjectLoaded(watchProject);
  const watchPaths: string[] = [];
  
  // Only watch explicitly defined project directory if set via env var
  // Real workspace paths will be added dynamically via watchProject() after client handshake
  const defaultProjDir = process.env.CODEATLAS_PROJECT_DIR || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
  if (defaultProjDir) {
    const envPath = path.resolve(defaultProjDir);
    watchPaths.push(envPath);
    activeWatchedPaths.add(envPath);
  }

  watcher = chokidar.watch(watchPaths, {
    ignored: [/(^|[\/\\])\./, '**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
    persistent: true,
    ignoreInitial: true
  });

  watcher.on('all', (event: string, filePath: string) => {
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return;

    // Find which watched directory this file belongs to
    let matchedDir = '';
    for (const dir of activeWatchedPaths) {
      if (filePath.startsWith(dir)) {
        matchedDir = dir;
        break;
      }
    }
    
    const projectName = matchedDir ? path.basename(matchedDir) : 'Unknown';
    const relPath = matchedDir ? path.relative(matchedDir, filePath) : filePath;
    
    console.error(`\n[Auto-Scan] ⚡ File ${event} in [${projectName}]: ${relPath}`);
    
    if (indexTimeout) clearTimeout(indexTimeout);
    indexTimeout = setTimeout(() => {
      const cwd = matchedDir || process.env.CODEATLAS_PROJECT_DIR || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH || process.cwd();
      loadAnalysisAsync(cwd, false, filePath).then((loaded) => {
        if (loaded) {
          console.error(`[Auto-Index] ✅ [${projectName}] incremental sync complete.`);
        }
      }).catch((err) => {
        console.error(`[Auto-Index] ❌ Error in incremental sync for [${projectName}]: ${err}`);
      });
    }, 500); // reduced delay to 500ms for instant feel
  });

  console.error(`\n${'='.repeat(50)}`);
  console.error(`🚀 CODEATLAS ENTERPRISE ONLINE`);
  console.error(`📡 Auto-Indexing: DYNAMIC WORKSPACE DISCOVERY MODE`);
  if (watchPaths.length > 0) {
    watchPaths.forEach(p => console.error(`   - ${p}`));
  } else {
    console.error(`   - Waiting for IDE workspace roots...`);
  }
  console.error(`🛡️  Security: SECURE API Key Sync`);
  console.error(`${'='.repeat(50)}\n`);
}

export function watchProject(dir: string) {
  const absPath = path.resolve(dir);
  if (!watcher) return;
  if (!activeWatchedPaths.has(absPath)) {
    activeWatchedPaths.add(absPath);
    watcher.add(absPath);
    console.error(`[Watcher] ➕ Dynamically started watching: ${absPath}`);
  }
}
