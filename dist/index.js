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
try {
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
}
catch (err) {
    // Ignore directory creation errors
}
// Parse command line arguments (e.g. --apiKey <key> or --apiKey=<key>)
const apiKeyArgIndex = process.argv.findIndex(arg => arg.startsWith('--apiKey'));
if (apiKeyArgIndex !== -1) {
    const arg = process.argv[apiKeyArgIndex];
    let val = '';
    if (arg.includes('=')) {
        val = arg.split('=')[1];
    }
    else if (apiKeyArgIndex + 1 < process.argv.length) {
        val = process.argv[apiKeyArgIndex + 1];
    }
    if (val) {
        process.env.CODEATLAS_API_KEY = val;
    }
}
// Parse command line arguments for projectDir
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
import { getStats, discoverProjects, loadAnalysis, discoverProjectsAsync, loadAnalysisAsync, getWorkspaceFromAncestors, isSystemIdeDirectory } from "./src/services/projectService.js";
import { startWatcher, isIndexingEnabledForProject } from "./src/services/watcherService.js";
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
                            console.error(`[Auto-Scan] 🛡️ Ignored IDE system/extensions directory from workspace indexing: ${workspacePath}`);
                            continue;
                        }
                        const projectName = path.basename(workspacePath);
                        isIndexingEnabledForProject(projectName).then((enabled) => {
                            if (!enabled) {
                                console.error(`[Auto-Scan] ⏸️  Auto-indexing is disabled on server for project [${projectName}]. Skipping initial scan.`);
                                return;
                            }
                            console.error(`[Auto-Scan] 🔄 Auto-indexing discovered workspace root: ${workspacePath}`);
                            loadAnalysisAsync(workspacePath, true).then((loaded) => {
                                if (loaded) {
                                    console.error(`[Auto-Scan] ✅ Auto-indexing complete for workspace root: ${workspacePath}`);
                                }
                                else {
                                    console.error(`[Auto-Scan] ⚠️ Auto-indexing skipped or directory not found for: ${workspacePath}`);
                                }
                            }).catch((err) => {
                                console.error(`[Auto-Scan] ❌ Auto-indexing failed for workspace root: ${workspacePath}: ${err}`);
                            });
                        }).catch((err) => {
                            console.error(`[Auto-Scan] ⚠️ Failed to verify indexing status: ${err}. Skipping initial scan.`);
                        });
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
            console.error(`[Auto-Scan] ⚠️ Failed to list workspace roots from client: ${err}. Falling back to active workspace.`);
        }
        if (!succeeded) {
            const activeWorkspace = process.env.CODEATLAS_PROJECT_DIR || getWorkspaceFromAncestors() || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH || process.cwd();
            if (isSystemIdeDirectory(activeWorkspace)) {
                console.error(`[Auto-Scan] 🛡️ Ignored IDE system/extensions directory from workspace indexing fallback: ${activeWorkspace}`);
            }
            else {
                const projectName = path.basename(activeWorkspace);
                isIndexingEnabledForProject(projectName).then((enabled) => {
                    if (!enabled) {
                        console.error(`[Auto-Scan] ⏸️  Auto-indexing is disabled on server for project [${projectName}]. Skipping fallback scan.`);
                        return;
                    }
                    console.error(`[Auto-Scan] 🔄 Triggering initial background scan for active workspace fallback: ${activeWorkspace}`);
                    loadAnalysisAsync(activeWorkspace, true).then((loaded) => {
                        if (loaded) {
                            console.error(`[Auto-Scan] ✅ Initial background scan complete for fallback: ${activeWorkspace}`);
                        }
                        else {
                            console.error(`[Auto-Scan] ⚠️ Initial background scan skipped or directory not found for fallback: ${activeWorkspace}`);
                        }
                    }).catch((err) => {
                        console.error(`[Auto-Scan] ❌ Initial background scan failed for fallback: ${err}`);
                    });
                }).catch((err) => {
                    console.error(`[Auto-Scan] ⚠️ Failed to verify indexing status: ${err}. Skipping fallback scan.`);
                });
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
// Re-export core modules/helpers to maintain compatibility with test suite
export { server, checkAuth, getStats, discoverProjects, loadAnalysis, discoverProjectsAsync, loadAnalysisAsync };
//# sourceMappingURL=index.js.map