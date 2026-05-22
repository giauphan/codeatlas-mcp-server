#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as dotenv from "dotenv";

// Import Presentation Adapters
import { server } from "./src/presentation/mcpServer.js";

// Import Domain / Application Services
import { checkAuth } from "./src/services/authService.js";
import { 
  getStats, 
  discoverProjects, 
  loadAnalysis, 
  discoverProjectsAsync, 
  loadAnalysisAsync, 
  fileExists 
} from "./src/services/projectService.js";
import { startWatcher } from "./src/services/watcherService.js";

// Load environment variables
dotenv.config();

// Start server
async function main() {
  startWatcher();

  // Trigger background scan ONLY for the active workspace of the IDE on startup
  const activeWorkspace = process.cwd();
  console.error(`[Auto-Scan] 🔄 Triggering initial background scan for active workspace: ${activeWorkspace}`);
  loadAnalysisAsync(activeWorkspace, true).then((loaded) => {
    if (loaded) {
      console.error(`[Auto-Scan] ✅ Initial background scan complete for: ${activeWorkspace}`);
    }
  }).catch((err) => {
    console.error(`[Auto-Scan] ❌ Initial background scan failed: ${err}`);
  });

  // Stdio Mode - for local use (e.g. Claude Desktop, Cursor)
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CodeAtlas MCP server running on stdio");
}

main().catch(console.error);

// Re-export core modules/helpers to maintain compatibility with test suite
export { server, checkAuth, getStats, discoverProjects, loadAnalysis, discoverProjectsAsync, loadAnalysisAsync };
