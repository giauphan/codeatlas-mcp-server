import chokidar from 'chokidar';
import * as path from 'path';
import { loadAnalysisAsync, registerOnProjectLoaded } from './projectService.js';

export let indexTimeout: NodeJS.Timeout | null = null;
export let watcher: any = null;
export const activeWatchedPaths = new Set<string>();

export function startWatcher() {
  registerOnProjectLoaded(watchProject);
  const watchPaths: string[] = [];
  
  // Default to process.cwd() (the active workspace of the IDE window)
  const activeWorkspace = path.resolve(process.cwd());
  watchPaths.push(activeWorkspace);
  activeWatchedPaths.add(activeWorkspace);

  // Also watch explicitly defined project directory if set
  if (process.env.CODEATLAS_PROJECT_DIR) {
    const envPath = path.resolve(process.env.CODEATLAS_PROJECT_DIR);
    if (!activeWatchedPaths.has(envPath)) {
      watchPaths.push(envPath);
      activeWatchedPaths.add(envPath);
    }
  }

  watcher = chokidar.watch(watchPaths, {
    ignored: [/(^|[\/\\])\../, '**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
    persistent: true,
    ignoreInitial: true
  });

  watcher.on('change', (filePath: string) => {
    // Find which watched directory this file belongs to
    let matchedDir = '';
    for (const dir of activeWatchedPaths) {
      if (filePath.startsWith(dir)) {
        matchedDir = dir;
        break;
      }
    }
    
    const projectName = matchedDir ? path.basename(matchedDir) : 'Unknown';
    
    console.error(`\n[Auto-Scan] ⚡ Change in [${projectName}]: ${filePath}`);
    
    if (indexTimeout) clearTimeout(indexTimeout);
    indexTimeout = setTimeout(() => {
      console.error(`[Auto-Scan] 🔄 Re-indexing [${projectName}]...`);
      
      const cwd = matchedDir || process.cwd();
      loadAnalysisAsync(cwd, true).then((loaded) => {
        if (loaded) {
          console.error(`[Auto-Index] ✅ [${projectName}] re-indexed and synced successfully.`);
        }
      }).catch((err) => {
        console.error(`[Auto-Index] ❌ Error indexing [${projectName}]: ${err}`);
      });
    }, 2000);
  });

  console.error(`\n${'='.repeat(50)}`);
  console.error(`🚀 CODEATLAS ENTERPRISE ONLINE`);
  console.error(`📡 Auto-Indexing: WATCHING ACTIVE WORKSPACE`);
  watchPaths.forEach(p => console.error(`   - ${p}`));
  console.error(`🛡️  Security: SECURE Bearer Token Sync`);
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
