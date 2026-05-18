import chokidar from 'chokidar';
import { discoverProjects, loadAnalysisAsync } from './projectService.js';

export let indexTimeout: NodeJS.Timeout | null = null;
export let watcher: any = null;

export function startWatcher() {
  const projects = discoverProjects();
  const watchPaths = projects.map(p => p.dir);

  if (watchPaths.length === 0) {
    watchPaths.push(process.cwd());
  }

  watcher = chokidar.watch(watchPaths, {
    ignored: [/(^|[\/\\])\../, '**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
    persistent: true,
    ignoreInitial: true
  });

  watcher.on('change', (filePath: string) => {
    const project = projects.find(p => filePath.startsWith(p.dir));
    const projectName = project ? project.name : 'Unknown';
    
    console.error(`\n[Auto-Scan] ⚡ Change in [${projectName}]: ${filePath}`);
    
    if (indexTimeout) clearTimeout(indexTimeout);
    indexTimeout = setTimeout(() => {
      console.error(`[Auto-Scan] 🔄 Re-indexing [${projectName}]...`);
      
      const cwd = project?.dir || process.cwd();
      loadAnalysisAsync(cwd).then((loaded) => {
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
  console.error(`📡 Auto-Indexing: WATCHING ${watchPaths.length} PROJECTS`);
  watchPaths.forEach(p => console.error(`   - ${p}`));
  console.error(`🛡️  Security: SECURE Bearer Token Sync`);
  console.error(`${'='.repeat(50)}\n`);
}
