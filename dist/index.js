#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
// Configure centralized log file in ~/.codeatlas/mcp.log
const homeDir = os.homedir();
const logDir = path.join(homeDir, ".codeatlas");
const logFilePath = path.join(logDir, "mcp.log");
const pidFilePath = path.join(logDir, "mcp.pid");
try {
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
}
catch (err) {
    // Ignore directory creation errors
}
// ── Single-instance PID guard ──────────────────────────────────────────
// Prevents duplicate MCP server processes from consuming excessive memory.
// But allow --version and --help flags to pass through.
// Handle --version before PID guard
if (process.argv.includes('--version') || process.argv.includes('-v')) {
    // Try both relative locations (source: index.ts, dist: dist/index.js)
    let pkg;
    for (const p of ['./package.json', '../package.json']) {
        try {
            pkg = JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf-8'));
            break;
        }
        catch { }
    }
    if (pkg)
        console.log(pkg.version);
    process.exit(0);
}
if (!process.argv.includes('--help') && !process.argv.includes('-h')) {
    try {
        if (fs.existsSync(pidFilePath)) {
            const existingPid = parseInt(fs.readFileSync(pidFilePath, "utf-8").trim(), 10);
            if (!isNaN(existingPid) && existingPid > 0) {
                try {
                    process.kill(existingPid, 0); // Check if alive
                    // Another instance is already running. Exit immediately to avoid duplicates.
                    // DO NOT kill the old instance — that would break the active MCP connection
                    // and cause Hermes to reconnect in an infinite kill-restart loop.
                    console.error(`[PID-Guard] 🔒 Instance already running (PID: ${existingPid}). New instance exiting.`);
                    process.exit(0);
                }
                catch (e) {
                    if (e?.code === 'ESRCH') {
                        console.error(`[PID-Guard] 🗑️ Stale PID ${existingPid} — old instance is gone. Starting fresh.`);
                    }
                    else {
                        console.error(`[PID-Guard] ⚠️ Cannot verify PID ${existingPid}. Will overwrite.`);
                    }
                }
            }
        }
        fs.writeFileSync(pidFilePath, String(process.pid));
        console.error(`[PID-Guard] 🔒 Lock acquired (PID: ${process.pid})`);
    }
    catch (err) {
        console.error(`[PID-Guard] ⚠️ Could not write PID file — running without guard: ${err}`);
    }
}
// ────────────────────────────────────────────────────────────────────────
// ⚠️ NOTE: API key must be set via CODEATLAS_API_KEY environment variable or .env file.
// Passing API keys via command-line arguments is NOT supported — they are visible
// to all users on the system via `ps aux`. Use environment variables instead.
// Parse command line arguments for projectDir (safe directory path, not a secret)
const projectDirArgIndex = process.argv.findIndex(arg => arg.startsWith('--projectDir'));
if (projectDirArgIndex !== -1) {
    const arg = process.argv[projectDirArgIndex];
    let val = '';
    if (arg.includes('=')) {
        val = arg.split('=')[1];
    }
    else if (projectDirArgIndex + 1 < process.argv.length) {
        val = process.argv[projectDirArgIndex + 1];
    }
    if (val) {
        process.env.CODEATLAS_PROJECT_DIR = val;
    }
}
// Async logging queue to prevent blocking the Event Loop on console.error
const logQueue = [];
let isWritingLogs = false;
async function flushLogQueue() {
    if (isWritingLogs || logQueue.length === 0)
        return;
    isWritingLogs = true;
    while (logQueue.length > 0) {
        const message = logQueue.shift();
        if (message) {
            try {
                await fs.promises.appendFile(logFilePath, message);
            }
            catch (err) {
                // Ignore write errors
            }
        }
    }
    isWritingLogs = false;
}
const originalConsoleError = console.error;
console.error = (...args) => {
    originalConsoleError(...args);
    try {
        const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        const timestamp = new Date().toISOString();
        // Cap log queue at 1000 entries to prevent unbounded memory growth
        if (logQueue.length >= 1000) {
            logQueue.shift();
        }
        logQueue.push(`[${timestamp}] ${message}\n`);
        flushLogQueue().catch(() => { });
    }
    catch (err) {
        // Ignore queue errors
    }
};
// Import Presentation Adapters
import { server } from "./src/presentation/mcpServer.js";
// Import Domain / Application Services
import { checkAuth } from "./src/services/authService.js";
import { getStats, discoverProjects, loadAnalysis, discoverProjectsAsync, loadAnalysisAsync, getWorkspaceFromAncestors, isSystemIdeDirectory, discoverGitSubProjects } from "./src/services/projectService.js";
import { startWatcher, stopWatcher, isIndexingEnabledForProject } from "./src/services/watcherService.js";
// Load environment variables
dotenv.config();
// Start server
async function main() {
    startWatcher();
    // Function to scan workspace roots from the client
    async function scanRoots() {
        let succeeded = false;
        try {
            const result = await server.server.listRoots();
            if (result && result.roots && result.roots.length > 0) {
                succeeded = true;
                console.error(`[Auto-Scan] 📂 Discovered ${result.roots.length} workspace root(s) from client.`);
                for (const root of result.roots) {
                    if (root.uri.startsWith("file://")) {
                        const workspacePath = fileURLToPath(root.uri).trim();
                        if (isSystemIdeDirectory(workspacePath)) {
                            console.error(`[Auto-Scan] 🛡️ Ignored IDE system/extensions directory: ${workspacePath}`);
                            continue;
                        }
                        // Scan subdirectories for .git projects
                        const subProjects = await discoverGitSubProjects(workspacePath, true);
                        if (subProjects.length > 0) {
                            console.error(`[Auto-Scan] 📦 Found ${subProjects.length} project(s) with .git and open in IDE inside ${path.basename(workspacePath)}`);
                            for (const subDir of subProjects) {
                                const subName = path.basename(subDir);
                                isIndexingEnabledForProject(subName).then((enabled) => {
                                    if (!enabled) {
                                        console.error(`[Auto-Scan] ⏸️  Auto-indexing disabled for [${subName}]. Skipping.`);
                                        return;
                                    }
                                    console.error(`[Auto-Scan] 🔄 Indexing sub-project: ${subDir}`);
                                    loadAnalysisAsync(subDir, true).then((loaded) => {
                                        if (loaded)
                                            console.error(`[Auto-Scan] ✅ Indexed: ${subDir}`);
                                        else
                                            console.error(`[Auto-Scan] ⚠️ Skipped: ${subDir}`);
                                    }).catch((err) => {
                                        console.error(`[Auto-Scan] ❌ Failed: ${subDir}: ${err}`);
                                    });
                                }).catch(() => { });
                            }
                        }
                        else {
                            console.error(`[Auto-Scan] ℹ️ No .git projects found under container root: ${workspacePath}`);
                        }
                    }
                    else {
                        console.error(`[Auto-Scan] ⚠️ Ignored non-file URI root: ${root.uri}`);
                    }
                }
            }
            else {
                console.error("[Auto-Scan] ℹ️ No workspace roots returned by client. Falling back to active workspace.");
            }
        }
        catch (err) {
            console.error(`[Auto-Scan] ⚠️ Failed to list workspace roots: ${err}. Falling back to active workspace.`);
        }
        if (!succeeded) {
            const activeWorkspace = process.env.CODEATLAS_PROJECT_DIR || getWorkspaceFromAncestors() || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH || process.cwd();
            if (isSystemIdeDirectory(activeWorkspace)) {
                console.error(`[Auto-Scan] 🛡️ Ignored IDE system directory fallback: ${activeWorkspace}`);
                return;
            }
            const subProjects = await discoverGitSubProjects(activeWorkspace, true);
            if (subProjects.length > 0) {
                console.error(`[Auto-Scan] 📦 Fallback: found ${subProjects.length} IDE-open .git project(s) in ${activeWorkspace}`);
                for (const subDir of subProjects) {
                    const subName = path.basename(subDir);
                    isIndexingEnabledForProject(subName).then((enabled) => {
                        if (!enabled)
                            return;
                        loadAnalysisAsync(subDir, true).catch(() => { });
                    }).catch(() => { });
                }
            }
            else {
                console.error(`[Auto-Scan] ℹ️ No .git projects found in workspace fallback: ${activeWorkspace}`);
            }
        }
    }
    // Hook into client initialized event to fetch and index workspace roots
    server.server.oninitialized = () => {
        console.error("[Auto-Scan] 🔌 MCP Client connection initialized. Checking workspace roots...");
        scanRoots();
    };
    // Listen for changes to workspace roots
    server.server.setNotificationHandler(RootsListChangedNotificationSchema, (notification) => {
        console.error("[Auto-Scan] 🔔 Received roots/list_changed notification from client. Re-scanning workspace roots...");
        scanRoots();
    });
    // Stdio Mode - for local use (e.g. Claude Desktop, Cursor)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("CodeAtlas MCP server running on stdio");
}
main().catch(console.error);
// ── Graceful shutdown handlers ─────────────────────────────────────────
// Prevent zombie processes by cleaning up watchers, cache, and PID file.
function cleanup(signal) {
    console.error(`[Cleanup] 🧹 Received ${signal}. Shutting down...`);
    try {
        stopWatcher();
    }
    catch (e) {
        console.error(`[Cleanup] ⚠️ Watcher cleanup error: ${e}`);
    }
    try {
        if (fs.existsSync(pidFilePath)) {
            fs.unlinkSync(pidFilePath);
            console.error(`[Cleanup] 🗑️ PID file removed.`);
        }
    }
    catch (e) {
        console.error(`[Cleanup] ⚠️ PID file cleanup error: ${e}`);
    }
    process.exit(0);
}
process.on("SIGTERM", () => cleanup("SIGTERM"));
process.on("SIGINT", () => cleanup("SIGINT"));
process.on("SIGQUIT", () => cleanup("SIGQUIT"));
process.on("uncaughtException", (err) => {
    console.error(`[Fatal] 💥 Uncaught exception: ${err}`);
    cleanup("uncaughtException");
});
// ────────────────────────────────────────────────────────────────────────
// Re-export core modules/helpers to maintain compatibility with test suite
export { server, checkAuth, getStats, discoverProjects, loadAnalysis, discoverProjectsAsync, loadAnalysisAsync };
//# sourceMappingURL=index.js.map