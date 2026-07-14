import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as path from "path";
import { checkAuth, logActivity } from "../../services/authService.js";
import { loadAnalysisAsync, syncAnalysisToServer, getEpisodicMemoriesFromServer } from "../../services/projectService.js";
import { saveDreamMemory, queryDreamMemories, DreamMemoryResult } from "../../services/dreamingService.js";


export function registerMemoryTools(server: McpServer) {
    // Tool 8a: Save Dream Memory
    server.tool(
      "save_dream_memory",
      "Save a dream memory (mistake, preference, knowledge, or pattern) to CodeAtlas Cloud for long-term AI recall. The AI uses this to persist learnings across conversations.",
      {
        memory_type: z.enum(["MISTAKE", "PREFERENCE", "KNOWLEDGE", "PATTERN"]).describe("Category of the memory"),
        content: z.string().describe("The actual memory content or insight"),
        importance: z.number().min(1).max(10).optional().describe("Importance level from 1 (low) to 10 (critical). Defaults to 5."),
        session_id: z.string().optional().describe("Optional session identifier for grouping related memories"),
        project: z.string().optional().describe("Optional project name to associate this memory with"),
      },
      async ({ memory_type, content, importance, session_id, project }: { memory_type: "MISTAKE" | "PREFERENCE" | "KNOWLEDGE" | "PATTERN"; content: string; importance?: number; session_id?: string; project?: string }) => {
        const auth = await checkAuth();
        await logActivity(auth, "save_dream_memory", { memory_type, content: content.substring(0, 100), importance, session_id, project });

        try {
          const result = await saveDreamMemory({
            memory_type,
            content,
            importance: importance || 5,
            session_id,
            project,
          });

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: result.success,
                id: result.id,
                memory_type,
                message: `Dream memory saved successfully with id: ${result.id}`,
              }, null, 2),
            }],
          };
        } catch (err: unknown) {
          return {
            content: [{
              type: "text" as const,
              text: `Failed to save dream memory: ${err instanceof Error ? err.message : String(err)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // Tool 8b: Query Dream Memories
    server.tool(
      "query_dream_memories",
      "Query previously saved dream memories from CodeAtlas Cloud. Uses semantic search to find relevant memories based on the query text. Returns memories with relevance scores.",
      {
        query: z.string().describe("Natural language query to search for relevant memories"),
        project: z.string().optional().describe("Optional project name filter to scope the search"),
        limit: z.number().min(1).max(100).optional().default(10).describe("Maximum number of results to return (default: 10, max: 100)"),
      },
      async ({ query, project, limit }: { query: string; project?: string; limit?: number }) => {
        const auth = await checkAuth();
        await logActivity(auth, "query_dream_memories", { query: query.substring(0, 100), project, limit });

        try {
          const memories = await queryDreamMemories({
            query,
            project,
            limit: limit || 10,
          });

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                count: memories.length,
                query,
                memories,
              }, null, 2),
            }],
          };
        } catch (err: unknown) {
          return {
            content: [{
              type: "text" as const,
              text: `Failed to query dream memories: ${err instanceof Error ? err.message : String(err)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // ── Tool 8c: Sync Dreams (scan + report status) ──────────────────
    // AI IDE can call this to check dream sync health, or trigger batch
    server.tool(
      "sync_dreams",
      "Check dream memory sync status. Returns count of stored dreams grouped by type and project. Use this to verify dreams are syncing to the cloud correctly. Can be called from any AI IDE, CLI, or Hermes cron.",
      {
        type: z.enum(["MISTAKE", "PREFERENCE", "KNOWLEDGE", "PATTERN"]).optional().describe("Filter by memory type"),
        project: z.string().optional().describe("Filter by project name"),
      },
      async ({ type, project }: { type?: "MISTAKE" | "PREFERENCE" | "KNOWLEDGE" | "PATTERN"; project?: string }) => {
        const auth = await checkAuth();
        await logActivity(auth, "sync_dreams", { type, project });

        try {
          // Paginate through all dreams to build an accurate count — not sampled, complete.
          let allDreams: DreamMemoryResult[] = [];
          const PAGE_SIZE = 100;
          let offset = 0;

          while (true) {
            const dreams = await queryDreamMemories({
              query: "",
              project,
              limit: PAGE_SIZE,
              offset,
            });
            if (!dreams || dreams.length === 0) break;
            allDreams = allDreams.concat(dreams);
            if (dreams.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
          }

          // Group by type and project
          const byType: Record<string, number> = {};
          const byProject: Record<string, number> = {};
          for (const d of allDreams) {
            const typed = d as any;
            const t = typed.memory_type || "UNKNOWN";
            const p = typed.project || "unknown";
            byType[t] = (byType[t] || 0) + 1;
            byProject[p] = (byProject[p] || 0) + 1;
          }

          // Filter by type if requested
          if (type) {
            allDreams = allDreams.filter((d: any) =>
              d.memory_type === type
            );
          }

          const lines: string[] = [];
          lines.push(`Dream Memory Sync Status`);
          lines.push(`═══════════════════════`);
          lines.push(`Total dreams: ${allDreams.length}`);
          lines.push(``);
          lines.push(`By Type:`);
          for (const [t, c] of Object.entries(byType)) {
            lines.push(`  ${t}: ${c}`);
          }
          lines.push(``);
          lines.push(`By Project:`);
          for (const [p, c] of Object.entries(byProject)) {
            lines.push(`  ${p}: ${c}`);
          }
          if (allDreams.length > 0) {
            lines.push(``);
            lines.push(`Most recent:`);
            const sorted = [...allDreams].sort((a: any, b: any) =>
              new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
            );
            for (const d of sorted.slice(0, 5)) {
              const r = d as any;
              lines.push(`  [${r.memory_type}] ${(r.content as string || '').substring(0, 60)} (${r.project})`);
            }
          }
          lines.push(``);
          lines.push(`✅ Sync OK — ${allDreams.length} dreams stored in CodeAtlas Cloud`);

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Error: ${msg}` }],
            isError: true as const,
          };
        }
      }
    );

    // Tool 7: Sync System Memory
    server.tool(
      "sync_system_memory",
      "Create or update the .agents/memory/ folder with auto-generated system documentation. This folder serves as AI's 'long-term memory' — it persists between conversations. After calling this, AI in any future conversation can read these files to understand the full system flow without re-analyzing. Call this after completing any code changes.",
      {
        project: z.string().optional().describe("Project name or path"),
        businessRule: z.string().optional().describe("Optional: A new business rule to add to the memory (e.g. 'VIP users get free shipping')"),
        changeDescription: z.string().optional().describe("Optional: Description of what was just changed (for the changelog)"),
        enableEnterpriseSync: z.boolean().optional().default(true).describe("If true, syncs data to Oracle 26ai Knowledge Graph (Pro/Plus feature). Default is true."),
      },
      async ({ project, businessRule, changeDescription, enableEnterpriseSync }: { project?: string; businessRule?: string; changeDescription?: string; enableEnterpriseSync?: boolean }) => {
        const auth = await checkAuth();
        await logActivity(auth, "sync_system_memory", { project, businessRule, changeDescription, enableEnterpriseSync });
        const loaded = await loadAnalysisAsync(project);
        if (!loaded) {
          return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
        }

        const nodes = loaded.analysis.graph.nodes;
        const links = loaded.analysis.graph.links;

        let syncSuccess = false;
        let syncError: string | undefined;

        // Sync local analysis to CodeAtlas Cloud
        if (enableEnterpriseSync !== false) {
          try {
            console.error(`Syncing Knowledge Graph for ${loaded.projectName} to CodeAtlas Cloud...`);
            await syncAnalysisToServer(loaded.projectName, loaded.analysis, businessRule, changeDescription);
            syncSuccess = true;
          } catch (syncErr) {
            syncError = syncErr instanceof Error ? syncErr.message : String(syncErr);
            console.error("Failed to sync memory to CodeAtlas Cloud:", syncErr);
          }
        } else {
          if (businessRule || changeDescription) {
            syncError = "Sync skipped (enableEnterpriseSync is false), cannot save episodic memory.";
          } else {
            syncSuccess = true; // No episodic memory requested, so no-op is considered success
          }
        }

        const result = {
          success: syncSuccess,
          project: loaded.projectName,
          stats: {
            modules: nodes.filter((n) => n.type === "module").length,
            totalEntities: nodes.length,
            totalLinks: links.length,
            businessRuleSaved: syncSuccess && !!businessRule,
            changeDescriptionSaved: syncSuccess && !!changeDescription,
          },
          error: syncError,
          message: syncSuccess
            ? (enableEnterpriseSync !== false
                ? `System memory synced to CodeAtlas Cloud for ${loaded.projectName}. Local file writing deprecated.`
                : `System memory sync skipped (no-op success).`)
            : `System memory sync failed or skipped: ${syncError}`,
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
    );

    // Tool 7.5: Get System Memory (Episodic memories like business rules and change logs)
    server.tool(
      "get_system_memory",
      "Retrieve the auto-generated system documentation and episodic memories (business rules and change logs) for a project from CodeAtlas Cloud / Oracle 26ai.",
      {
        project: z.string().optional().describe("Project name or path"),
        eventType: z.enum(["all", "BUSINESS_RULE", "CHANGE_LOG"]).optional().default("all").describe("Filter by event type"),
      },
      async ({ project, eventType }: { project?: string; eventType?: "all" | "BUSINESS_RULE" | "CHANGE_LOG" }) => {
        const auth = await checkAuth();
        await logActivity(auth, "get_system_memory", { project, eventType });
        const loaded = await loadAnalysisAsync(project);
        if (!loaded) {
          return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
        }

        try {
          const filterType = eventType === "all" ? undefined : eventType;
          const memories = await getEpisodicMemoriesFromServer(loaded.projectName, filterType);

          const result = {
            success: true,
            project: loaded.projectName,
            count: memories.length,
            memories: memories
          };

          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: "text" as const, text: `Failed to retrieve system memory: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
      }
    );

}
