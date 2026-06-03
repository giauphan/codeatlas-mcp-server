import chokidar from 'chokidar';
import * as path from 'path';
import * as https from 'https';
import { loadAnalysisAsync, registerOnProjectLoaded, getWorkspaceFromAncestors, getResolvedApiKey, isSystemIdeDirectory } from './projectService.js';
export const httpsWrapper = {
    request: https.request
};
export let indexTimeout = null;
export let watcher = null;
export const activeWatchedPaths = new Set();
export async function isIndexingEnabledForProject(projectName) {
    const apiKey = getResolvedApiKey();
    if (!apiKey)
        return true;
    return new Promise((resolve) => {
        try {
            const serverUrlStr = process.env.CODEATLAS_API_URL || "https://atlas.genrostore.com";
            const serverUrl = new URL(serverUrlStr);
            const options = {
                hostname: serverUrl.hostname,
                port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
                path: `/api/projects/settings?apiKey=${encodeURIComponent(apiKey)}&projectName=${encodeURIComponent(projectName)}`,
                method: "GET",
                headers: {
                    "x-api-key": apiKey
                }
            };
            const req = httpsWrapper.request(options, (res) => {
                let data = "";
                res.on("data", (chunk) => { data += chunk; });
                res.on("end", () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed.indexingEnabled !== false);
                        }
                        catch {
                            resolve(true);
                        }
                    }
                    else {
                        resolve(true);
                    }
                });
            });
            req.on("error", () => {
                resolve(true);
            });
            req.setTimeout(5000, () => {
                req.destroy();
                resolve(true);
            });
            req.end();
        }
        catch {
            resolve(true);
        }
    });
}
export function startWatcher() {
    registerOnProjectLoaded(watchProject);
    const watchPaths = [];
    const defaultProjDir = process.env.CODEATLAS_PROJECT_DIR || getWorkspaceFromAncestors() || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
    if (defaultProjDir) {
        const envPath = path.resolve(defaultProjDir);
        if (!isSystemIdeDirectory(envPath)) {
            watchPaths.push(envPath);
            activeWatchedPaths.add(envPath);
        }
        else {
            console.error(`[Watcher] 🛡️ Ignored watching system IDE directory at startup: ${envPath}`);
        }
    }
    watcher = chokidar.watch(watchPaths, {
        ignored: [/(^|[\/\\])\./, '**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
        persistent: true,
        ignoreInitial: true
    });
    watcher.on('all', (event, filePath) => {
        if (event !== 'add' && event !== 'change' && event !== 'unlink')
            return;
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
        if (indexTimeout)
            clearTimeout(indexTimeout);
        indexTimeout = setTimeout(() => {
            isIndexingEnabledForProject(projectName).then((enabled) => {
                if (!enabled) {
                    console.error(`[Auto-Scan] ⏸️  Auto-indexing is disabled on server for project [${projectName}]. Skipping scan/sync.`);
                    return;
                }
                console.error(`\n[Auto-Scan] ⚡ File ${event} in [${projectName}]: ${relPath}`);
                const cwd = matchedDir || process.env.CODEATLAS_PROJECT_DIR || getWorkspaceFromAncestors() || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH || process.cwd();
                loadAnalysisAsync(cwd, false, filePath).then((loaded) => {
                    if (loaded) {
                        console.error(`[Auto-Index] ✅ [${projectName}] incremental sync complete.`);
                    }
                }).catch((err) => {
                    console.error(`[Auto-Index] ❌ Error in incremental sync for [${projectName}]: ${err}`);
                });
            }).catch((err) => {
                console.error(`[Auto-Scan] ⚠️ Failed to verify indexing status: ${err}. Skipping scan.`);
            });
        }, 500); // reduced delay to 500ms for instant feel
    });
    console.error(`\n${'='.repeat(50)}`);
    console.error(`🚀 CODEATLAS ENTERPRISE ONLINE`);
    console.error(`📡 Auto-Indexing: DYNAMIC WORKSPACE DISCOVERY MODE`);
    if (watchPaths.length > 0) {
        watchPaths.forEach(p => console.error(`   - ${p}`));
    }
    else {
        console.error(`   - Waiting for IDE workspace roots...`);
    }
    console.error(`🛡️  Security: SECURE API Key Sync`);
    console.error(`${'='.repeat(50)}\n`);
}
export function watchProject(dir) {
    const absPath = path.resolve(dir);
    if (!watcher)
        return;
    if (isSystemIdeDirectory(absPath)) {
        console.error(`[Watcher] 🛡️ Ignored watching system IDE directory dynamically: ${absPath}`);
        return;
    }
    if (!activeWatchedPaths.has(absPath)) {
        activeWatchedPaths.add(absPath);
        watcher.add(absPath);
        console.error(`[Watcher] ➕ Dynamically started watching: ${absPath}`);
    }
}
//# sourceMappingURL=watcherService.js.map