#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as dotenv from "dotenv";
// Import Presentation Adapters
import { server } from "./src/presentation/mcpServer.js";
// Import Domain / Application Services
import { checkAuth } from "./src/services/authService.js";
import { getStats, discoverProjects, loadAnalysis, discoverProjectsAsync, loadAnalysisAsync, fileExists } from "./src/services/projectService.js";
import { startWatcher } from "./src/services/watcherService.js";
// Load environment variables
dotenv.config();
// Start server
async function main() {
    startWatcher();
    // Trigger background scan of all discovered projects on startup
    discoverProjectsAsync().then(async (projectsList) => {
        console.error(`[Auto-Scan] 🔍 Discovered ${projectsList.length} potential projects on startup.`);
        for (const p of projectsList) {
            const hasAnalysis = await fileExists(p.analysisPath);
            if (!hasAnalysis) {
                console.error(`[Auto-Scan] 🔄 Triggering initial background scan for: ${p.name}`);
                // Run in background without awaiting, so server startup is instantaneous!
                loadAnalysisAsync(p.dir).then((loaded) => {
                    if (loaded) {
                        console.error(`[Auto-Scan] ✅ Initial background scan complete for: ${p.name}`);
                    }
                }).catch((err) => {
                    console.error(`[Auto-Scan] ❌ Initial background scan failed for ${p.name}: ${err}`);
                });
            }
        }
    }).catch((err) => {
        console.error(`[Auto-Scan] ❌ Failed to discover projects for initial scan: ${err}`);
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