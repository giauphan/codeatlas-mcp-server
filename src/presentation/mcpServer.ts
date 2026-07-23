import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getHomePath, getHermesConfigPath, getHermesPluginDir, getClaudeConfigPath } from "../utils/pathUtils.js";
import { checkAuth, logActivity } from "../services/authService.js";
import {
  discoverProjectsAsync,
  isPathInAuthorizedProjects,
  loadAnalysisAsync,
  getStats,
  fileExists,
  syncAnalysisToServer,
  getEpisodicMemoriesFromServer,
  inMemoryAnalysisCache,
  AnalysisResultLocal
} from "../services/projectService.js";
import { saveDreamMemory, queryDreamMemories, DreamMemoryResult } from "../services/dreamingService.js";
import { CodeAnalyzer } from "../analyzer/parser.js";
import { SecurityScanner } from "../securityScanner.js";

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ⚡ Bolt Optimization: Use explicit for-loops to instantiate Maps/Sets to avoid the
// massive memory spikes and GC overhead caused by intermediate `nodes.map(n => [n.id, n])` arrays.
function createNodeMap<T extends { id: string }>(nodes: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (let i = 0; i < nodes.length; i++) {
    map.set(nodes[i].id, nodes[i]);
  }
  return map;
}

// ⚡ Bolt Optimization: Avoid intermediate array allocations for id -> label mapping
function createNodeLabelMap<T extends { id: string; label: string }>(nodes: T[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < nodes.length; i++) {
    map.set(nodes[i].id, nodes[i].label);
  }
  return map;
}

// ⚡ Bolt Optimization: Avoid intermediate array allocations for id sets
function createNodeIdSet<T extends { id: string }>(nodes: T[]): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    set.add(nodes[i].id);
  }
  return set;
}

const SHELL_METACHAR_RE = /[&|;<>$`\\\n\r]/;

export function registerTools(server: McpServer) {
  // Tool -1: Analyze a project
  server.tool(
    "analyze",
    "Perform deep code analysis on a local project directory. Generates AST analysis in memory and syncs to CodeAtlas Cloud.",
    {
      path: z.string().max(255).describe("Absolute path to the project directory to analyze"),
      maxFiles: z.number().optional().describe("Maximum files to analyze (default: 5000)"),
    },
    async ({ path: projectPath, maxFiles }: { path: string; maxFiles?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "analyze", { path: projectPath, maxFiles });

      if (!(await fileExists(projectPath))) {
        return { content: [{ type: "text" as const, text: `Error: Directory does not exist: ${projectPath}` }] };
      }

      // Safety: reject paths that are the user's home directory or system roots
      const resolvedPath = path.resolve(projectPath);
      const homeDir = getHomePath();
      if (resolvedPath === homeDir || resolvedPath === "/" || resolvedPath === "/home") {
        return { content: [{ type: "text" as const, text: `Error: Refusing to analyze '${resolvedPath}' — path is too broad. Please specify a project subdirectory.` }] };
      }

      try {
        const analyzer = new CodeAnalyzer(projectPath, maxFiles || 5000);
        const result = await analyzer.analyzeProject();

        // Save in-memory cache
        inMemoryAnalysisCache.set(path.resolve(projectPath), result);

        // Sync to cloud server
        try {
          await syncAnalysisToServer(path.basename(projectPath), result);
        } catch (syncErr) {
          console.error(`[Analyze-Tool] ❌ Background cloud sync failed: ${syncErr}`);
        }

        const stats = getStats(result as AnalysisResultLocal);
        const summary = `Analysis complete for ${path.basename(projectPath)}:
- Modules: ${stats.modules}
- Functions: ${stats.functions}
- Classes: ${stats.classes}
- Dependencies: ${stats.dependencies}
- Total files: ${result.totalFilesAnalyzed}
- Files skipped: ${result.totalFilesSkipped}
(Data kept in memory and background sync to CodeAtlas Cloud initiated)`;

        return { content: [{ type: "text" as const, text: summary }] };
      } catch (error: unknown) {
        return { content: [{ type: "text" as const, text: `Analysis failed: ${(error instanceof Error ? error.message : String(error))}` }] };
      }
    }
  );

  // Tool 0: List all discovered projects
  server.tool(
    "list_projects",
    "List all projects that have been analyzed by CodeAtlas. Returns project names, paths, and last analysis time.",
    {},
    async () => {
      const auth = await checkAuth();
      await logActivity(auth, "list_projects", {});
      const projects = await discoverProjectsAsync(auth.uid);
      if (projects.length === 0) {
        return { content: [{ type: "text" as const, text: "No analyzed projects found. Run 'analyze' tool first." }] };
      }

      const result = {
        projectCount: projects.length,
        projects: projects.map((p) => ({
          name: p.name,
          path: p.dir,
          lastAnalyzed: p.modifiedAt.toISOString(),
        })),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 1: Get project structure
  server.tool(
    "get_project_structure",
    "Get all modules, classes, functions, and variables in the analyzed project. Returns entity type, name, file path, and line number.",
    {
      project: z.string().max(255).optional().describe("Project name or path (auto-detects if omitted)"),
      type: z.enum(["all", "module", "class", "function", "variable"]).optional().describe("Filter by entity type. Choose one of: all, module, class, function, variable"),
      limit: z.number().optional().describe("Max results to return (default: 100)"),
    },
    async ({ project, type, limit }: { project?: string; type?: string; limit?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "get_project_structure", { project, type, limit });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) {
        return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
      }

      let nodes = loaded.analysis.graph.nodes;
      if (type && type !== "all") {
        nodes = nodes.filter((n) => n.type === type);
      }

      // Filter out venv/node_modules entities
      nodes = nodes.filter((n) => {
        const fp = n.filePath || "";
        return !fp.includes("node_modules") && !fp.includes("venv") && !fp.includes(".venv") && !fp.includes("site-packages");
      });

      const maxResults = limit || 500;
      const truncated = nodes.length > maxResults;
      nodes = nodes.slice(0, maxResults);

      const stats = getStats(loaded.analysis);

      const result = {
        project: loaded.projectName,
        projectDir: loaded.projectDir,
        total: loaded.analysis.graph.nodes.length,
        showing: nodes.length,
        truncated,
        stats,
        entities: nodes.map((n) => ({
          name: n.label,
          type: n.type,
          filePath: n.filePath ? (path.isAbsolute(n.filePath) ? n.filePath : path.resolve(loaded.projectDir, n.filePath)) : null,
          line: n.line || null,
        })),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 2: Get dependencies
  server.tool(
    "get_dependencies",
    "Get import/call/containment/implements relationships between entities. Shows how modules, classes, and functions are connected.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      source: z.string().max(255).optional().describe("Filter by source entity name"),
      target: z.string().max(255).optional().describe("Filter by target entity name"),
      relationship: z.enum(["all", "import", "call", "contains", "implements"]).optional().describe("Filter by relationship type. Choose one of: all, import, call, contains, implements"),
      limit: z.number().optional().describe("Max results (default: 100)"),
    },
    async ({ project, source, target, relationship, limit }: { project?: string; source?: string; target?: string; relationship?: string; limit?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "get_dependencies", { project, source, target, relationship, limit });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) {
        return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
      }

      const nodeMap = createNodeLabelMap(loaded.analysis.graph.nodes);
      let links = loaded.analysis.graph.links;

      if (relationship && relationship !== "all") {
        links = links.filter((l) => l.type === relationship);
      }
      if (source) {
        const sourceRegex = new RegExp(escapeRegExp(source), 'i');
        links = links.filter((l) => {
          const label = nodeMap.get(l.source) || l.source;
          return sourceRegex.test(label);
        });
      }
      if (target) {
        const targetRegex = new RegExp(escapeRegExp(target), 'i');
        links = links.filter((l) => {
          const label = nodeMap.get(l.target) || l.target;
          return targetRegex.test(label);
        });
      }

      // Deduplicate links
      const linkDedup = new Set<string>();
      links = links.filter((l) => {
        const key = l.source + '|' + l.target + '|' + l.type;
        if (linkDedup.has(key)) return false;
        linkDedup.add(key);
        return true;
      });

      const maxResults = limit || 100;
      const truncated = links.length > maxResults;
      links = links.slice(0, maxResults);

      const result = {
        total: loaded.analysis.graph.links.length,
        showing: links.length,
        truncated,
        dependencies: links.map((l) => ({
          source: nodeMap.get(l.source) || l.source,
          target: nodeMap.get(l.target) || l.target,
          type: l.type,
        })),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 3: Get AI insights
  server.tool(
    "get_insights",
    "Get AI-generated code insights including refactoring suggestions, security issues, and maintainability analysis.",
    {},
    async () => {
      const auth = await checkAuth();
      await logActivity(auth, "get_insights", {});
      const loaded = await loadAnalysisAsync();
      if (!loaded) {
        return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
      }

      const stats = getStats(loaded.analysis);

      const result = {
        project: loaded.projectName,
        stats,
        insights: loaded.analysis.insights,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 4: Search entities
  server.tool(
    "search_entities",
    "Search for functions, classes, modules, or variables by name. Supports fuzzy matching.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      query: z.string().max(255).describe("Search query (case-insensitive, partial match)"),
      type: z.enum(["all", "module", "class", "function", "variable"]).optional().describe("Filter by entity type. Choose one of: all, module, class, function, variable"),
    },
    async ({ project, query, type }: { project?: string; query: string; type?: string }) => {
      const auth = await checkAuth();
      await logActivity(auth, "search_entities", { project, query, type });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) {
        return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
      }

      let nodes = loaded.analysis.graph.nodes;
      if (type && type !== "all") {
        nodes = nodes.filter((n) => n.type === type);
      }

      // Filter out venv/node_modules entities for cleaner results
      nodes = nodes.filter((n) => {
        if (n.id.startsWith('external:')) return false;
        if (n.filePath && (
          n.filePath.includes('/venv/') ||
          n.filePath.includes('/.venv/') ||
          n.filePath.includes('/node_modules/') ||
          n.filePath.includes('/site-packages/')
        )) return false;
        return true;
      });

      const searchRegex = new RegExp(escapeRegExp(query), 'i');
      const matches = nodes.filter((n) => searchRegex.test(n.label));

      // For each match, find its relationships
      const links = loaded.analysis.graph.links;
      const nodeMap = createNodeLabelMap(loaded.analysis.graph.nodes);

      const result = {
        query,
        matchCount: matches.length,
        results: matches.slice(0, 50).map((n) => {
          const incomingLinks = links
            .filter((l) => l.target === n.id)
            .map((l) => ({ from: nodeMap.get(l.source) || l.source, type: l.type }));
          const outgoingLinks = links
            .filter((l) => l.source === n.id)
            .map((l) => ({ to: nodeMap.get(l.target) || l.target, type: l.type }));

          return {
            name: n.label,
            type: n.type,
            filePath: n.filePath ? (path.isAbsolute(n.filePath) ? n.filePath : path.resolve(loaded.projectDir, n.filePath)) : null,
            line: n.line || null,
            incomingRelationships: incomingLinks,
            outgoingRelationships: outgoingLinks,
          };
        }),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 5: Get file entities
  server.tool(
    "get_file_entities",
    "Get all entities (classes, functions, variables) defined in a specific file.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      filePath: z.string().max(255).describe("File path (partial match, e.g. 'User.php' or 'src/models')"),
    },
    async ({ filePath, project }: { project?: string; filePath: string }) => {
      const auth = await checkAuth();
      await logActivity(auth, "get_file_entities", { filePath, project });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) {
        return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
      }

      const searchRegex = new RegExp(escapeRegExp(filePath.replace(/\\/g, "/")), 'i');
      const matches = loaded.analysis.graph.nodes.filter((n) => {
        const fp = (n.filePath || n.id).replace(/\\/g, "/");
        return searchRegex.test(fp);
      });

      const links = loaded.analysis.graph.links;
      const nodeMap = createNodeLabelMap(loaded.analysis.graph.nodes);

      // Group by file
      const byFile = new Map<string, typeof matches>();
      for (const n of matches) {
        const fp = n.filePath || "unknown";
        if (!byFile.has(fp)) byFile.set(fp, []);
        byFile.get(fp)!.push(n);
      }

      let filesEntries = Array.from(byFile.entries());

      const result = {
        query: filePath,
        filesFound: byFile.size,
        showing: filesEntries.length,
        truncated: byFile.size > filesEntries.length,
        files: filesEntries.map(([fp, entities]) => ({
          filePath: fp === "unknown" ? "unknown" : (path.isAbsolute(fp) ? fp : path.resolve(loaded.projectDir, fp)),
          entities: entities.map((e) => ({
            name: e.label,
            type: e.type,
            line: e.line || null,
            dependencies: links
              .filter((l) => l.source === e.id)
              .map((l) => ({ to: nodeMap.get(l.target) || l.target, type: l.type })),
          })),
        })),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 6: Generate System Flow
  server.tool(
    "generate_system_flow",
    "Auto-generate a Mermaid flowchart diagram showing how modules, classes, and functions connect in the system. Returns a Mermaid diagram string that AI can read to understand the full system flow without reading every file.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      scope: z.enum(["full", "modules-only", "feature"]).optional().describe("Scope of the diagram: 'full' shows all entities, 'modules-only' shows only module relationships (recommended for large projects), 'feature' requires the 'feature' param. Choose one of: full, modules-only, feature"),
      feature: z.string().max(255).optional().describe("Feature keyword to focus the diagram on (e.g. 'auth', 'crawl', 'payment'). Only used when scope='feature'"),
      maxNodes: z.number().optional().describe("Maximum nodes in diagram (default: 60). Reduce for large projects"),
    },
    async ({ project, scope, feature, maxNodes }: { project?: string; scope?: string; feature?: string; maxNodes?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "generate_system_flow", { project, scope, feature, maxNodes });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) {
        return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
      }

      const max = maxNodes || 60;
      const diagramScope = scope || "modules-only";
      let nodes = loaded.analysis.graph.nodes;
      let links = loaded.analysis.graph.links;
      const nodeMap = createNodeMap(nodes);

      // Filter by scope
      if (diagramScope === "modules-only") {
        nodes = nodes.filter((n) => n.type === "module" && (n.filePath || n.id.startsWith("external:")));
        const nodeIds = createNodeIdSet(nodes);
        links = links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target) && l.type === "import");
      } else if (diagramScope === "feature" && feature) {
        const featureRegex = new RegExp(escapeRegExp(feature), 'i');
        const matchingNodes = new Set<string>();
        nodes.forEach((n) => {
          if (featureRegex.test(n.label) || (n.filePath && featureRegex.test(n.filePath))) {
            matchingNodes.add(n.id);
          }
        });
        links.forEach((l) => {
          if (matchingNodes.has(l.source)) matchingNodes.add(l.target);
          if (matchingNodes.has(l.target)) matchingNodes.add(l.source);
        });
        nodes = nodes.filter((n) => matchingNodes.has(n.id));
        const nodeIds = createNodeIdSet(nodes);
        links = links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target));
      }

      // Truncate if too many nodes
      if (nodes.length > max) {
        const priorityOrder = ["module", "class", "function", "variable"];
        nodes.sort((a, b) => {
          const ia = priorityOrder.indexOf(a.type);
          const ib = priorityOrder.indexOf(b.type);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
        nodes = nodes.slice(0, max);
      }

      const truncatedNodeIds = createNodeIdSet(nodes);
      links = links.filter((l) => truncatedNodeIds.has(l.source) && truncatedNodeIds.has(l.target));

      // Remove duplicate links
      const linkSet = new Set<string>();
      links = links.filter((l) => {
        const key = `${l.source}|${l.target}|${l.type}`;
        if (linkSet.has(key)) return false;
        linkSet.add(key);
        return true;
      });

      // Generate Mermaid JS flowchart syntax from the entity graph.
      const nodeIdMap = new Map<string, string>();
      let counter = 0;

      const getMermaidId = (nodeId: string) => {
        if (!nodeIdMap.has(nodeId)) {
          nodeIdMap.set(nodeId, `n${counter++}`);
        }
        return nodeIdMap.get(nodeId)!;
      };

      const lines: string[] = ["graph TD"];

      for (const node of nodes) {
        const mid = getMermaidId(node.id);
        const label = node.label.replace(/"/g, "'");
        const typeIcon = node.type === "module" ? "📄" : node.type === "class" ? "🏗️" : node.type === "function" ? "⚡" : "📦";
        if (node.type === "module") {
          lines.push(`    ${mid}["${typeIcon} ${label}"]`);
        } else if (node.type === "class") {
          lines.push(`    ${mid}[["${typeIcon} ${label}"]]`);
        } else {
          lines.push(`    ${mid}("${typeIcon} ${label}")`);
        }
      }

      const arrowMap: Record<string, string> = { import: "-->", call: "-.->", contains: "-->", implements: "-.->|implements|" };
      const labelMap: Record<string, string> = { import: "imports", call: "calls", contains: "contains", implements: "implements" };
      for (const link of links) {
        const src = getMermaidId(link.source);
        const tgt = getMermaidId(link.target);
        if (src && tgt) {
          const arrow = arrowMap[link.type] || "-->";
          if (link.type === "contains") {
            lines.push(`    ${src} ${arrow} ${tgt}`);
          } else {
            lines.push(`    ${src} ${arrow}|${labelMap[link.type] || link.type}| ${tgt}`);
          }
        }
      }

      const mermaid = lines.join("\n");

      const result = {
        project: loaded.projectName,
        scope: diagramScope,
        feature: feature || null,
        nodeCount: nodes.length,
        linkCount: links.length,
        truncated: loaded.analysis.graph.nodes.length > max,
        mermaidDiagram: mermaid,
        summary: `System flow for ${loaded.projectName}: ${nodes.filter((n) => n.type === "module").length} modules, ${nodes.filter((n) => n.type === "class").length} classes, ${nodes.filter((n) => n.type === "function").length} functions connected by ${links.length} relationships.`,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 7: Sync System Memory
  server.tool(
    "sync_system_memory",
    "Create or update the .agents/memory/ folder with auto-generated system documentation. This folder serves as AI's 'long-term memory' — it persists between conversations. After calling this, AI in any future conversation can read these files to understand the full system flow without re-analyzing. Call this after completing any code changes.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      businessRule: z.string().max(255).optional().describe("Optional: A new business rule to add to the memory (e.g. 'VIP users get free shipping')"),
      changeDescription: z.string().max(50000).optional().describe("Optional: Description of what was just changed (for the changelog)"),
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
      project: z.string().max(255).optional().describe("Project name or path"),
      eventType: z.enum(["all", "BUSINESS_RULE", "CHANGE_LOG"]).optional().default("all").describe("Filter by event type. Choose one of: all, BUSINESS_RULE, CHANGE_LOG"),
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

  // Tool 8a: Save Dream Memory
  server.tool(
    "save_dream_memory",
    "Save a dream memory (mistake, preference, knowledge, or pattern) to CodeAtlas Cloud for long-term AI recall. The AI uses this to persist learnings across conversations.",
    {
      memory_type: z.enum(["MISTAKE", "PREFERENCE", "KNOWLEDGE", "PATTERN"]).describe("Category of the memory. Choose one of: MISTAKE, PREFERENCE, KNOWLEDGE, PATTERN"),
      content: z.string().max(50000).describe("The actual memory content or insight"),
      importance: z.number().min(1).max(10).optional().describe("Importance level from 1 (low) to 10 (critical). Defaults to 5."),
      session_id: z.string().max(255).optional().describe("Optional session identifier for grouping related memories"),
      project: z.string().max(255).optional().describe("Optional project name to associate this memory with"),
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
      query: z.string().max(255).describe("Natural language query to search for relevant memories"),
      project: z.string().max(255).optional().describe("Optional project name filter to scope the search"),
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
      type: z.enum(["MISTAKE", "PREFERENCE", "KNOWLEDGE", "PATTERN"]).optional().describe("Filter by memory type. Choose one of: MISTAKE, PREFERENCE, KNOWLEDGE, PATTERN"),
      project: z.string().max(255).optional().describe("Filter by project name"),
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

  // ── Tool 8d: Search Genome ─────────────────────────────────────
  server.tool(
    "search_genome",
    "Search CodeAtlas Genome for relevant genes. Uses semantic search to find the most relevant genes.",
    {
      query: z.string().max(255).describe("Natural language search query"),
      project: z.string().max(255).optional().describe("Filter by project"),
      limit: z.number().min(1).max(50).optional().default(10).describe("Max results (default: 10)"),
    },
    async ({ query, project, limit }) => {
      const auth = await checkAuth();
      await logActivity(auth, "search_genome", { query: query.substring(0, 100), project, limit });
      try {
        const serverUrl = process.env.CODEATLAS_API_URL || "https://your-server.com";
        const apiKey = process.env.CODEATLAS_API_KEY;
        if (!apiKey) throw new Error("CODEATLAS_API_KEY not set");

        const qs = new URLSearchParams({ query, limit: String(limit || 10) });
        if (project) qs.set("project", project);
        const url = `${serverUrl.replace(/\/+$/, "")}/api/genome/search?${qs}`;

        const resp = await fetch(url, {
          headers: { "x-api-key": apiKey, "User-Agent": "codeatlas-enterprise/2.0" },
        });
        if (!resp.ok) throw new Error(`Genome search failed: ${resp.status} ${await resp.text()}`);
        const data = await resp.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Failed to search genome: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Tool 8e: Get Gene ──────────────────────────────────────────
  server.tool(
    "get_gene",
    "Get a specific gene by ID from the CodeAtlas Genome.",
    {
      geneId: z.string().max(255).describe("The gene ID to retrieve"),
    },
    async ({ geneId }) => {
      const auth = await checkAuth();
      await logActivity(auth, "get_gene", { geneId });
      try {
        const serverUrl = process.env.CODEATLAS_API_URL || "https://your-server.com";
        const apiKey = process.env.CODEATLAS_API_KEY;
        if (!apiKey) throw new Error("CODEATLAS_API_KEY not set");

        const url = `${serverUrl.replace(/\/+$/, "")}/api/genome/gene/${encodeURIComponent(geneId)}`;
        const resp = await fetch(url, {
          headers: { "x-api-key": apiKey, "User-Agent": "codeatlas-enterprise/2.0" },
        });
        if (resp.status === 404) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "Gene not found" }, null, 2) }] };
        }
        if (!resp.ok) throw new Error(`Get gene failed: ${resp.status} ${await resp.text()}`);
        const data = await resp.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Failed to get gene: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Tool 8f: Scan Immune Genes ─────────────────────────────────
  server.tool(
    "scan_immune_genes",
    "Scan the CodeAtlas Immune System for previously encountered failures matching a problem description. Returns prevention context to inject into prompts.",
    {
      problem: z.string().max(50000).describe("Describe the problem or error to scan for"),
      project: z.string().max(255).optional().describe("Filter by project"),
    },
    async ({ problem, project }) => {
      const auth = await checkAuth();
      await logActivity(auth, "scan_immune_genes", { problem: problem.substring(0, 100), project });
      try {
        const serverUrl = process.env.CODEATLAS_API_URL || "https://your-server.com";
        const apiKey = process.env.CODEATLAS_API_KEY;
        if (!apiKey) throw new Error("CODEATLAS_API_KEY not set");

        const qs = new URLSearchParams({ problem });
        if (project) qs.set("project", project);
        const url = `${serverUrl.replace(/\/+$/, "")}/api/genome/immune/context?${qs}`;

        const resp = await fetch(url, {
          headers: { "x-api-key": apiKey, "User-Agent": "codeatlas-enterprise/2.0" },
        });
        if (!resp.ok) throw new Error(`Immune scan failed: ${resp.status} ${await resp.text()}`);
        const data = await resp.json();
        return { content: [{ type: "text" as const, text: data.context || "No immune responses found." }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Failed to scan immune genes: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Tool 8g: Save Immune Gene ──────────────────────────────────
  server.tool(
    "save_immune_gene",
    "Record a failure pattern as an immune gene in CodeAtlas Genome. This helps prevent future agents from repeating the same mistake.",
    {
      problem: z.string().max(50000).describe("The problem or task context"),
      failure: z.string().max(50000).describe("What went wrong — the failure description"),
      prevention: z.string().max(50000).describe("How to prevent or fix this failure"),
      project: z.string().max(255).optional().describe("Project to associate with this immune gene"),
    },
    async ({ problem, failure, prevention, project }) => {
      const auth = await checkAuth();
      await logActivity(auth, "save_immune_gene", { problem: problem.substring(0, 50), failure: failure.substring(0, 50), project });
      try {
        const serverUrl = process.env.CODEATLAS_API_URL || "https://your-server.com";
        const apiKey = process.env.CODEATLAS_API_KEY;
        if (!apiKey) throw new Error("CODEATLAS_API_KEY not set");

        const url = `${serverUrl.replace(/\/+$/, "")}/api/genome/immune`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "User-Agent": "codeatlas-enterprise/2.0" },
          body: JSON.stringify({ problem, failure, prevention, project }),
        });
        if (!resp.ok) throw new Error(`Save immune gene failed: ${resp.status} ${await resp.text()}`);
        const data = await resp.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Failed to save immune gene: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 8c: Trace Feature Flow
  server.tool(
    "trace_feature_flow",
    "Trace the complete flow of a feature through the codebase. Given a keyword (e.g. 'login', 'payment', 'crawl'), finds all related files, classes, and functions, then orders them by dependency chain to show the execution flow. This helps AI understand which files to read when working on a feature.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      keyword: z.string().max(255).describe("Feature keyword to trace (e.g. 'auth', 'crawl', 'payment', 'upload')"),
      depth: z.number().optional().describe("How many hops to follow from matching nodes (default: 2)"),
    },
    async ({ keyword, project, depth }: { keyword: string; project?: string; depth?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "trace_feature_flow", { keyword, project, depth });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) {
        return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
      }

      const maxDepth = depth || 2;
      const searchRegex = new RegExp(escapeRegExp(keyword), 'i');
      const nodes = loaded.analysis.graph.nodes;
      const links = loaded.analysis.graph.links;
      const nodeMap = createNodeMap(nodes);

      const seedNodes = new Set<string>();
      for (const node of nodes) {
        if (node.id.startsWith('external:')) continue;
        if (node.filePath && (
          node.filePath.includes('/venv/') ||
          node.filePath.includes('/.venv/') ||
          node.filePath.includes('/node_modules/') ||
          node.filePath.includes('/vendor/') ||
          node.filePath.includes('/site-packages/')
        )) continue;

        if (
          searchRegex.test(node.label) ||
          (node.filePath && searchRegex.test(node.filePath)) ||
          searchRegex.test(node.id)
        ) {
          seedNodes.add(node.id);
        }
      }

      if (seedNodes.size === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                keyword,
                matchCount: 0,
                message: `No entities found matching '${keyword}'. Try a broader keyword.`,
                suggestions: nodes
                  .filter((n) => n.type === "module" && n.filePath)
                  .map((n) => n.label)
                  .slice(0, 10),
              }, null, 2),
            },
          ],
        };
      }

      const visited = new Set<string>(seedNodes);
      let frontier = new Set<string>(seedNodes);

      for (let d = 0; d < maxDepth; d++) {
        const nextFrontier = new Set<string>();
        for (const link of links) {
          if (frontier.has(link.source) && !visited.has(link.target)) {
            nextFrontier.add(link.target);
            visited.add(link.target);
          }
          if (frontier.has(link.target) && !visited.has(link.source)) {
            nextFrontier.add(link.source);
            visited.add(link.source);
          }
        }
        frontier = nextFrontier;
      }

      const traceNodes = nodes.filter((n) => visited.has(n.id));
      const traceLinks = links.filter((l) => visited.has(l.source) && visited.has(l.target));

      const byFile = new Map<string, Array<{ name: string; type: string; isSeed: boolean; line: number | null }>>();
      for (const node of traceNodes) {
        const filePath = node.filePath || "external";
        if (!byFile.has(filePath)) byFile.set(filePath, []);
        byFile.get(filePath)!.push({
          name: node.label,
          type: node.type,
          isSeed: seedNodes.has(node.id),
          line: node.line || null,
        });
      }

      const filesArray = Array.from(byFile.entries())
        .map(([filePath, entities]) => {
          const isExt = filePath === "external";
          const relPath = isExt ? "external" : (path.isAbsolute(filePath) ? path.relative(loaded.projectDir, filePath) : filePath);
          const absPath = isExt ? "external" : (path.isAbsolute(filePath) ? filePath : path.resolve(loaded.projectDir, filePath));
          return {
            filePath: relPath,
            absolutePath: absPath,
            entities,
            hasSeedMatch: entities.some((e) => e.isSeed),
            entityCount: entities.length,
          };
        })
        .sort((a, b) => {
          if (a.hasSeedMatch && !b.hasSeedMatch) return -1;
          if (!a.hasSeedMatch && b.hasSeedMatch) return 1;
          return b.entityCount - a.entityCount;
        });

      const result = {
        keyword,
        project: loaded.projectName,
        seedMatches: seedNodes.size,
        totalConnected: visited.size,
        depth: maxDepth,
        files: filesArray.filter((f) => f.filePath !== "external").slice(0, 30),
        externalDeps: filesArray.find((f) => f.filePath === "external")?.entities.map((e) => e.name) || [],
        relationships: traceLinks.slice(0, 50).map((l) => ({
          from: nodeMap.get(l.source)?.label || l.source,
          to: nodeMap.get(l.target)?.label || l.target,
          type: l.type,
        })),
        readingOrder: filesArray
          .filter((f) => f.hasSeedMatch && f.filePath !== "external")
          .map((f) => f.filePath),
        message: `Found ${seedNodes.size} direct matches and ${visited.size - seedNodes.size} connected entities for '${keyword}'. Start reading from the files in 'readingOrder'.`,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 9: Generate Feature Flow Diagram
  server.tool(
    "generate_feature_flow_diagram",
    "Generate a Mermaid diagram showing the EXECUTION FLOW of a feature. Unlike generate_system_flow (which shows module imports), this traces the actual call chain: entry point → controller → service → model → database. Given a keyword, it finds all related functions and classes, then builds a flowchart or sequence diagram showing how they call each other at runtime. This is the best tool for understanding HOW a feature works step-by-step.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      keyword: z.string().max(255).describe("Feature keyword to trace (e.g. 'login', 'payment', 'upload', 'auth')"),
      diagramType: z.enum(["flowchart", "sequence"]).optional().describe("Type of Mermaid diagram: 'flowchart' (default) shows call graph, 'sequence' shows step-by-step execution order. Choose one of: flowchart, sequence"),
      depth: z.number().optional().describe("How many call hops to follow (default: 3)"),
      maxNodes: z.number().optional().describe("Maximum nodes in diagram (default: 40)"),
    },
    async ({ project, keyword, diagramType, depth, maxNodes }: { project?: string; keyword: string; diagramType?: 'flowchart' | 'sequence'; depth?: number; maxNodes?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "generate_feature_flow_diagram", { project, keyword, diagramType, depth, maxNodes });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) {
        return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
      }

      const searchRegex = new RegExp(escapeRegExp(keyword), 'i');
      const maxDepth = depth || 3;
      const maxN = maxNodes || 40;
      const dType = diagramType || "flowchart";
      const nodes = loaded.analysis.graph.nodes;
      const links = loaded.analysis.graph.links;
      const nodeMap = createNodeMap(nodes);
      const nodeNameMap = createNodeLabelMap(nodes);

      const seedNodes = new Set<string>();
      for (const node of nodes) {
        if (node.id.startsWith('external:')) continue;
        if (node.filePath && (
          node.filePath.includes('/venv/') ||
          node.filePath.includes('/.venv/') ||
          node.filePath.includes('/node_modules/') ||
          node.filePath.includes('/vendor/') ||
          node.filePath.includes('/site-packages/')
        )) continue;

        if (
          searchRegex.test(node.label) ||
          (node.filePath && searchRegex.test(node.filePath)) ||
          searchRegex.test(node.id)
        ) {
          seedNodes.add(node.id);
        }
      }

      if (seedNodes.size === 0) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              keyword,
              matchCount: 0,
              message: `No entities found matching '${keyword}'. Try a broader keyword.`,
              suggestions: nodes
                .filter((n) => n.type === "function" || n.type === "class")
                .map((n) => n.label)
                .filter((l, i, arr) => arr.indexOf(l) === i)
                .slice(0, 15),
            }, null, 2),
          }],
        };
      }

      const visited = new Set<string>(seedNodes);
      let frontier = new Set<string>(seedNodes);
      const callAndContainsLinks = links.filter((l) => l.type === "call" || l.type === "contains");

      for (let d = 0; d < maxDepth; d++) {
        const nextFrontier = new Set<string>();
        for (const link of callAndContainsLinks) {
          if (frontier.has(link.source) && !visited.has(link.target)) {
            nextFrontier.add(link.target);
            visited.add(link.target);
          }
          if (frontier.has(link.target) && !visited.has(link.source)) {
            nextFrontier.add(link.source);
            visited.add(link.source);
          }
        }
        frontier = nextFrontier;
        if (nextFrontier.size === 0) break;
      }

      let traceNodes = nodes.filter((n) => visited.has(n.id) && (n.type === "function" || n.type === "class"));

      if (traceNodes.length > maxN) {
        const callConnections = new Map<string, number>();
        for (const link of links) {
          if (link.type === "call") {
            callConnections.set(link.source, (callConnections.get(link.source) || 0) + 1);
            callConnections.set(link.target, (callConnections.get(link.target) || 0) + 1);
          }
        }
        traceNodes.sort((a, b) => {
          if (seedNodes.has(a.id) && !seedNodes.has(b.id)) return -1;
          if (!seedNodes.has(a.id) && seedNodes.has(b.id)) return 1;
          return (callConnections.get(b.id) || 0) - (callConnections.get(a.id) || 0);
        });
        traceNodes = traceNodes.slice(0, maxN);
      }

      const traceNodeIds = createNodeIdSet(traceNodes);
      const traceLinks = links.filter(
        (l) => traceNodeIds.has(l.source) && traceNodeIds.has(l.target) && l.type === "call"
      );

      const linkSet = new Set<string>();
      const dedupLinks = traceLinks.filter((l) => {
        const key = `${l.source}|${l.target}`;
        if (linkSet.has(key)) return false;
        linkSet.add(key);
        return true;
      });

      const hasIncoming = new Set<string>();
      for (const link of dedupLinks) {
        hasIncoming.add(link.target);
      }
      const entryPoints = traceNodes.filter(
        (n) => !hasIncoming.has(n.id) || seedNodes.has(n.id)
      );

      let mermaid = "";
      const sanitizeLabel = (s: string) => s.replace(/"/g, "'").replace(/[<>]/g, "");

      if (dType === "sequence") {
        const seqLines: string[] = ["sequenceDiagram"];
        const participantMap = new Map<string, string>();
        let pCounter = 0;
        for (const node of traceNodes) {
          const pid = `P${pCounter++}`;
          participantMap.set(node.id, pid);
          const icon = node.type === "class" ? "🏗️" : "⚡";
          const fileSuffix = node.filePath ? ` (${path.basename(node.filePath)})` : "";
          seqLines.push(`    participant ${pid} as ${icon} ${sanitizeLabel(node.label)}${fileSuffix}`);
        }

        for (const link of dedupLinks) {
          const src = participantMap.get(link.source);
          const tgt = participantMap.get(link.target);
          if (src && tgt && src !== tgt) {
            seqLines.push(`    ${src}->>+${tgt}: calls`);
            seqLines.push(`    ${tgt}-->>-${src}: returns`);
          }
        }

        mermaid = seqLines.join("\n");
      } else {
        const flowLines: string[] = ["graph TD"];
        flowLines.push("    classDef entry fill:#4CAF50,stroke:#388E3C,color:#fff,stroke-width:2px");
        flowLines.push("    classDef seed fill:#2196F3,stroke:#1565C0,color:#fff,stroke-width:2px");
        flowLines.push("    classDef cls fill:#FF9800,stroke:#E65100,color:#fff");
        flowLines.push("    classDef func fill:#607D8B,stroke:#37474F,color:#fff");

        const mermaidIdMap = new Map<string, string>();
        let nCounter = 0;
        for (const node of traceNodes) {
          const mid = `f${nCounter++}`;
          mermaidIdMap.set(node.id, mid);
          const label = sanitizeLabel(node.label);
          const fileSuffix = node.filePath ? `<br/>${path.basename(node.filePath)}` : "";

          if (node.type === "class") {
            flowLines.push(`    ${mid}[["🏗️ ${label}${fileSuffix}"]]`);
          } else {
            flowLines.push(`    ${mid}("⚡ ${label}${fileSuffix}")`);
          }

          if (entryPoints.includes(node) && !hasIncoming.has(node.id)) {
            flowLines.push(`    class ${mid} entry`);
          } else if (seedNodes.has(node.id)) {
            flowLines.push(`    class ${mid} seed`);
          } else if (node.type === "class") {
            flowLines.push(`    class ${mid} cls`);
          } else {
            flowLines.push(`    class ${mid} func`);
          }
        }

        for (const link of dedupLinks) {
          const src = mermaidIdMap.get(link.source);
          const tgt = mermaidIdMap.get(link.target);
          if (src && tgt) {
            flowLines.push(`    ${src} -->|calls| ${tgt}`);
          }
        }

        flowLines.push("");
        flowLines.push(`    subgraph Legend`);
        flowLines.push(`        L1("🟢 Entry Point"):::entry`);
        flowLines.push(`        L2("🔵 Keyword Match"):::seed`);
        flowLines.push(`        L3("🟠 Class"):::cls`);
        flowLines.push(`        L4("⬜ Function"):::func`);
        flowLines.push(`    end`);

        mermaid = flowLines.join("\n");
      }

      const executionOrder: Array<{
        step: number;
        name: string;
        type: string;
        file: string | null;
        line: number | null;
        callsTo: string[];
        calledBy: string[];
      }> = [];

      const inDegree = new Map<string, number>();
      for (const node of traceNodes) {
        inDegree.set(node.id, 0);
      }
      for (const link of dedupLinks) {
        inDegree.set(link.target, (inDegree.get(link.target) || 0) + 1);
      }

      const queue: string[] = [];
      for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
      }

      let step = 1;
      const ordered = new Set<string>();
      while (queue.length > 0 && step <= maxN) {
        const current = queue.shift()!;
        if (ordered.has(current)) continue;
        ordered.add(current);

        const node = nodeMap.get(current);
        if (node) {
          const callsTo = dedupLinks
            .filter((l) => l.source === current)
            .map((l) => nodeNameMap.get(l.target) || l.target);
          const calledBy = dedupLinks
            .filter((l) => l.target === current)
            .map((l) => nodeNameMap.get(l.source) || l.source);

          executionOrder.push({
            step: step++,
            name: node.label,
            type: node.type,
            file: node.filePath ? (path.isAbsolute(node.filePath) ? path.relative(loaded.projectDir, node.filePath) : node.filePath) : null,
            line: node.line || null,
            callsTo,
            calledBy,
          });
        }

        for (const link of dedupLinks) {
          if (link.source === current) {
            const newDeg = (inDegree.get(link.target) || 1) - 1;
            inDegree.set(link.target, newDeg);
            if (newDeg <= 0 && !ordered.has(link.target)) {
              queue.push(link.target);
            }
          }
        }
      }

      for (const node of traceNodes) {
        if (!ordered.has(node.id)) {
          const callsTo = dedupLinks
            .filter((l) => l.source === node.id)
            .map((l) => nodeNameMap.get(l.target) || l.target);
          const calledBy = dedupLinks
            .filter((l) => l.target === node.id)
            .map((l) => nodeNameMap.get(l.source) || l.source);

          executionOrder.push({
            step: step++,
            name: node.label,
            type: node.type,
            file: node.filePath ? (path.isAbsolute(node.filePath) ? path.relative(loaded.projectDir, node.filePath) : node.filePath) : null,
            line: node.line || null,
            callsTo,
            calledBy,
          });
        }
      }

      const result = {
        keyword,
        project: loaded.projectName,
        diagramType: dType,
        seedMatches: seedNodes.size,
        nodesInDiagram: traceNodes.length,
        callRelationships: dedupLinks.length,
        entryPoints: entryPoints.map((n) => ({
          name: n.label,
          type: n.type,
          file: n.filePath ? (path.isAbsolute(n.filePath) ? path.relative(loaded.projectDir, n.filePath) : n.filePath) : null,
        })),
        mermaidDiagram: mermaid,
        executionOrder,
        readingOrder: executionOrder
          .filter((e) => e.file)
          .map((e) => e.file!)
          .filter((f, i, arr) => arr.indexOf(f) === i),
        message: `Generated ${dType} diagram for '${keyword}': ${traceNodes.length} nodes, ${dedupLinks.length} call relationships. Entry points: ${entryPoints.map((n) => n.label).join(", ")}`,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 11: Detect Architectural Smells
  server.tool(
    "detect_architectural_smells",
    "Knowledge Graph Reasoning: Use Oracle 26ai Graph features to automatically detect architectural weaknesses, circular dependencies, God objects, and dead code.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
    },
    async ({ project }: { project?: string }) => {
      const auth = await checkAuth();
      await logActivity(auth, "detect_architectural_smells", { project });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) {
        return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
      }

      try {
        const nodes = loaded.analysis.graph?.nodes || [];
        const links = loaded.analysis.graph?.links || [];

        // Find circular dependencies locally (from analyzer insights or simple check)
        const circularDependencies = (loaded.analysis.insights as any)?.circularDependencies || [];

        // God objects: classes with more than 15 outgoing/incoming connections
        const nodeConnections = new Map<string, number>();
        links.forEach((l: any) => {
          nodeConnections.set(l.source, (nodeConnections.get(l.source) || 0) + 1);
          nodeConnections.set(l.target, (nodeConnections.get(l.target) || 0) + 1);
        });

        const godObjects = nodes
          .filter((n: any) => n.type === 'class' && (nodeConnections.get(n.id) || 0) > 15)
          .map((n: any) => ({ name: n.label, filePath: n.filePath, connections: nodeConnections.get(n.id) }));

        // Dead code: non-external entities with 0 incoming connections
        const incomingCount = new Map<string, number>();
        links.forEach((l: any) => {
          incomingCount.set(l.target, (incomingCount.get(l.target) || 0) + 1);
        });

        const deadCode = nodes
          .filter((n: any) => n.type === 'function' && !n.id.startsWith('external:') && (incomingCount.get(n.id) || 0) === 0 && !n.label.includes('main') && !n.label.includes('index'))
          .slice(0, 10)
          .map((n: any) => ({ name: n.label, filePath: n.filePath, line: n.line }));

        const result = {
          project: loaded.projectName,
          timestamp: new Date().toISOString(),
          findings: {
            circularDependencies: {
              count: circularDependencies.length,
              details: circularDependencies,
              impact: "High - Causes tight coupling and build issues."
            },
            godObjects: {
              count: godObjects.length,
              details: godObjects,
              impact: "Medium - Violates Single Responsibility Principle, hard to maintain."
            },
            deadCode: {
              count: deadCode.length,
              details: deadCode,
              impact: "Low - Increases codebase size and cognitive load."
            }
          },
          recommendation: "Review high-impact findings (Circular Dependencies) first. Refactor God Objects into smaller services."
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Local Static Smells reasoning failed: ${(err instanceof Error ? err.message : String(err))}` }] };
      }
    }
  );

  // Tool 12: Scan Enterprise Vulnerabilities
  server.tool(
    "scan_enterprise_vulnerabilities",
    "Enterprise Scanner: Automatically scan all analyzed projects for bugs, security vulnerabilities (hardcoded secrets, unsafe functions), and architectural problems. Features Admin Insights and Security Scoring.",
    {
      maxProjects: z.number().optional().describe("Maximum number of projects to scan (default: all)"),
    },
    async ({ maxProjects }: { maxProjects?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "scan_enterprise_vulnerabilities", { maxProjects });
      const projects = await discoverProjectsAsync(auth.uid);

      if (projects.length === 0) {
        return { content: [{ type: "text" as const, text: "No analyzed projects found. Run 'analyze' tool first." }] };
      }

      const isEnterprise = auth.tier === 'enterprise';
      const scanResults: any[] = [];
      const limit = maxProjects || (isEnterprise ? projects.length : 3);
      const projectsToScan = projects.slice(0, limit);

      const scanPromises = projectsToScan.map(async (p) => {
        try {
          const loaded = await loadAnalysisAsync(p.name);
          if (!loaded) return null;

          const vulnerabilities = SecurityScanner.scan(loaded.analysis);

          // AI-powered deep scan (if configured — uses DeepSeek V4 Pro)
          const aiVulnerabilities = await SecurityScanner.aiScan(vulnerabilities, loaded.analysis);
          const allVulnerabilities = aiVulnerabilities.length > 0 ? aiVulnerabilities : vulnerabilities;

          const stats = getStats(loaded.analysis as any);
          const circularDeps = stats.circularDeps || 0;
          const deadCode = stats.deadCode || 0;

          const riskLevel = allVulnerabilities.length > 10 ? "CRITICAL" : (allVulnerabilities.length > 0 ? "HIGH" : "LOW");
          const securityScore = Math.max(0, 100 - (allVulnerabilities.length * 5) - (circularDeps * 2));

          return {
            project: p.name,
            riskLevel,
            securityScore: isEnterprise ? securityScore : "Upgrade to view",
            vulnerabilities: allVulnerabilities.length,
            circularDependencies: circularDeps,
            deadCode: deadCode,
            adminInsights: isEnterprise ? `Project health is ${securityScore > 80 ? 'EXCELLENT' : 'NEEDS ATTENTION'}. Priority: ${riskLevel}.` : null,
            details: { vulnerabilities }
          };
        } catch (err: unknown) {
          return {
            project: p.name,
            error: `Scan failed: ${(err instanceof Error ? err.message : String(err))}`
          };
        }
      });

      const resolvedResults = await Promise.all(scanPromises);
      for (const r of resolvedResults) {
        if (r) scanResults.push(r);
      }

      const finalReport = {
        timestamp: new Date().toISOString(),
        tier: auth.tier,
        projectsScanned: projectsToScan.length,
        totalProjectsDiscovered: projects.length,
        results: scanResults,
        enterpriseStatus: isEnterprise ? "ACTIVE (Admin Enabled)" : "INACTIVE"
      };

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(finalReport, null, 2)
        }]
      };
    }
  );

  // Tool 13: code_search — Full-text search across source files
  server.tool(
    "code_search",
    "Search source FILE CONTENTS across the entire project for any text string. Unlike 'search_entities' (which only searches entity names), this searches the actual code — comments, strings, variable names, function bodies, etc.",
    {
      project: z.string().max(255).optional().describe("Project name or path (auto-detects if omitted)"),
      query: z.string().max(255).describe("Text to search for in source file contents (case-insensitive)"),
      filePattern: z.string().max(255).optional().describe("Optional file glob pattern to narrow search (e.g. '*.ts', '*.py'). Default: all supported files"),
      maxResults: z.number().optional().describe("Maximum results to return (default: 30, max: 100)"),
      contextLines: z.number().optional().describe("Number of context lines around each match (default: 2)"),
    },
    async ({ project, query, filePattern, maxResults, contextLines }: { project?: string; query: string; filePattern?: string; maxResults?: number; contextLines?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "code_search", { project, query: query.substring(0, 100), filePattern, maxResults, contextLines });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) {
        return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
      }

      const maxRes = Math.min(maxResults || 30, 100);
      const ctx = contextLines || 2;
      // Fast path regex to pre-filter files without memory-intensive .toLowerCase() on entire file content
      const searchRegex = new RegExp(escapeRegExp(query), 'i');
      const allFiles: string[] = [];
      const extSet = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".php", ".json", ".yaml", ".yml", ".md", ".css", ".scss", ".html"]);

      try {
        const walkDir = (dir: string, depth: number) => {
          if (depth > 8) return;
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name === "venv" || entry.name === ".venv") continue;
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) walkDir(fullPath, depth + 1);
              else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (extSet.has(ext)) allFiles.push(fullPath);
              }
            }
          } catch { /* skip */ }
        };
        walkDir(loaded.projectDir, 0);
      } catch { /* fallback */ }

      const results: Array<{ file: string; line: number; content: string; contextBefore: string[]; contextAfter: string[] }> = [];
      for (const filePath of allFiles) {
        if (results.length >= maxRes) break;
        try {
          const content = fs.readFileSync(filePath, "utf-8");

          // Fast path to skip files that definitely don't contain the query
          // This avoids expensive .split('\n') and per-line iterations for most files
          // Using regex.test avoids creating a massive new string via .toLowerCase()
          if (!searchRegex.test(content)) continue;

          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxRes) break;
            if (searchRegex.test(lines[i])) {
              results.push({
                file: path.relative(loaded.projectDir, filePath),
                line: i + 1,
                content: lines[i].trim(),
                contextBefore: lines.slice(Math.max(0, i - ctx), i).map(l => l.trim()).filter(Boolean),
                contextAfter: lines.slice(i + 1, i + 1 + ctx).map(l => l.trim()).filter(Boolean),
              });
            }
          }
        } catch { /* skip */ }
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ query, project: loaded.projectName, matchCount: results.length, truncated: results.length >= maxRes, files: [...new Set(results.map(r => r.file))], results: results.slice(0, maxRes) }, null, 2) }],
      };
    }
  );

  // Tool 14: get_callers — Find all callers of a function/class
  server.tool(
    "get_callers",
    "Find ALL functions, methods, or classes that call or reference a specific symbol. The 'reverse dependency' view — given a function/class name, trace everything that depends on it. Use before refactoring or deleting code.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      symbol: z.string().max(255).describe("Function or class name to find callers (case-insensitive, partial match)"),
      maxResults: z.number().optional().describe("Maximum callers to return (default: 30)"),
      depth: z.number().optional().describe("How many levels deep (default: 1, max: 5)"),
    },
    async ({ project, symbol, maxResults, depth }: { project?: string; symbol: string; maxResults?: number; depth?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "get_callers", { project, symbol, maxResults, depth });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

      const searchRegex = new RegExp(escapeRegExp(symbol), 'i');
      const maxD = Math.min(depth || 1, 5);
      const nodes = loaded.analysis.graph.nodes;
      const links = loaded.analysis.graph.links;
      const targetIds = new Set<string>();
      const targetNames = new Map<string, string>();

      for (const node of nodes) {
        if (searchRegex.test(node.label) && !node.id.startsWith("external:")) {
          targetIds.add(node.id);
          targetNames.set(node.id, node.label);
        }
      }
      if (targetIds.size === 0) return { content: [{ type: "text" as const, text: JSON.stringify({ symbol, matchCount: 0, message: `No symbol '${symbol}' found.` }) }] };

      const callers = new Map<string, { name: string; type: string; filePath: string | null; line: number | null; depth: number; via: string[] }>();
      let frontier = new Set(targetIds);
      const visited = new Set(targetIds);
      const nodeMap = createNodeMap(nodes);

      for (let d = 1; d <= maxD; d++) {
        const next = new Set<string>();
        for (const link of links) {
          if ((link.type === "call" || link.type === "import") && frontier.has(link.target) && !visited.has(link.source)) {
            visited.add(link.source);
            next.add(link.source);
            const srcNode = nodeMap.get(link.source);
            const tgtName = targetNames.get(link.target) || nodeMap.get(link.target)?.label || link.target;
            if (srcNode) {
              if (!callers.has(link.source)) {
                callers.set(link.source, { name: srcNode.label, type: srcNode.type, filePath: srcNode.filePath || null, line: srcNode.line || null, depth: d, via: [tgtName] });
              } else {
                callers.get(link.source)!.via.push(tgtName);
              }
            }
          }
        }
        frontier = next;
      }

      const maxRes = maxResults || 30;
      const targetDetails = Array.from(targetIds).map(id => { const n = nodeMap.get(id); return n ? { name: n.label, type: n.type, filePath: n.filePath || null, line: n.line || null } : { name: id, type: "unknown", filePath: null, line: null }; });

      return { content: [{ type: "text" as const, text: JSON.stringify({ symbol, project: loaded.projectName, targets: targetDetails, totalCallers: callers.size, maxDepth: maxD, callers: Array.from(callers.values()).slice(0, maxRes) }, null, 2) }] };
    }
  );

  // Tool 15: get_callees — Find all functions called by a symbol
  server.tool(
    "get_callees",
    "Find everything a function, method, or class calls or depends on. The 'forward dependency' view — given a function name, trace what it imports and calls. Use to understand function dependencies before modifying.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      symbol: z.string().max(255).describe("Function or class name to find callees (case-insensitive, partial match)"),
      maxResults: z.number().optional().describe("Maximum callees (default: 30)"),
      depth: z.number().optional().describe("How many levels deep (default: 1, max: 5)"),
    },
    async ({ project, symbol, maxResults, depth }: { project?: string; symbol: string; maxResults?: number; depth?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "get_callees", { project, symbol, maxResults, depth });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

      const searchRegex = new RegExp(escapeRegExp(symbol), 'i');
      const maxD = Math.min(depth || 1, 5);
      const nodes = loaded.analysis.graph.nodes;
      const links = loaded.analysis.graph.links;
      const sourceIds = new Set<string>();

      for (const node of nodes) {
        if (searchRegex.test(node.label) && !node.id.startsWith("external:")) sourceIds.add(node.id);
      }
      if (sourceIds.size === 0) return { content: [{ type: "text" as const, text: JSON.stringify({ symbol, matchCount: 0, message: `No symbol '${symbol}' found.` }) }] };

      const callees = new Map<string, { name: string; type: string; filePath: string | null; line: number | null; depth: number }>();
      let frontier = new Set(sourceIds);
      const visited = new Set(sourceIds);
      const nodeMap = createNodeMap(nodes);

      for (let d = 1; d <= maxD; d++) {
        const next = new Set<string>();
        for (const link of links) {
          if ((link.type === "call" || link.type === "import") && frontier.has(link.source) && !visited.has(link.target)) {
            visited.add(link.target);
            next.add(link.target);
            const n = nodeMap.get(link.target);
            if (n && !n.id.startsWith("external:")) callees.set(link.target, { name: n.label, type: n.type, filePath: n.filePath || null, line: n.line || null, depth: d });
          }
        }
        frontier = next;
      }

      const maxRes = maxResults || 30;
      const nodeMap2 = createNodeMap(nodes);
      const sourceDetails = Array.from(sourceIds).map(id => { const n = nodeMap2.get(id); return n ? { name: n.label, type: n.type, filePath: n.filePath || null, line: n.line || null } : { name: id, type: "unknown", filePath: null, line: null }; });

      return { content: [{ type: "text" as const, text: JSON.stringify({ symbol, project: loaded.projectName, sources: sourceDetails, totalCallees: callees.size, maxDepth: maxD, callees: Array.from(callees.values()).slice(0, maxRes) }, null, 2) }] };
    }
  );

  // Tool 16: impact_analysis — Blast radius analysis
  server.tool(
    "impact_analysis",
    "Full BLAST RADIUS analysis for changing a symbol. Traces BOTH callers (what depends on this) AND callees (what this depends on) in one view. Also finds related test files. Use BEFORE any significant code change.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      symbol: z.string().max(255).describe("Function, class, or module name (case-insensitive, partial match)"),
      depth: z.number().optional().describe("How many levels deep (default: 2, max: 5)"),
    },
    async ({ project, symbol, depth }: { project?: string; symbol: string; depth?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "impact_analysis", { project, symbol, depth });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

      const searchRegex = new RegExp(escapeRegExp(symbol), 'i');
      const maxD = Math.min(depth || 2, 5);
      const nodes = loaded.analysis.graph.nodes;
      const links = loaded.analysis.graph.links;
      const nodeMap = createNodeMap(nodes);
      const symbolIds = new Set<string>();

      for (const node of nodes) {
        if (searchRegex.test(node.label) && !node.id.startsWith("external:")) symbolIds.add(node.id);
      }
      if (symbolIds.size === 0) return { content: [{ type: "text" as const, text: JSON.stringify({ symbol, matchCount: 0, message: `No symbol '${symbol}' found.` }) }] };

      const callers = new Map<string, { name: string; type: string; filePath: string | null; depth: number }>();
      const callees = new Map<string, { name: string; type: string; filePath: string | null; depth: number }>();

      // Build adjacency lists for fast traversal
      const fwdAdj = new Map<string, typeof links>();
      const revAdj = new Map<string, typeof links>();
      for (let i = 0; i < links.length; i++) {
        const l = links[i];
        if (l.type === "call" || l.type === "import") {
          let fList = fwdAdj.get(l.source);
          if (!fList) { fList = []; fwdAdj.set(l.source, fList); }
          fList.push(l);

          let rList = revAdj.get(l.target);
          if (!rList) { rList = []; revAdj.set(l.target, rList); }
          rList.push(l);
        }
      }

      // Forward (callees)
      let fF = new Set(symbolIds);
      const fV = new Set(symbolIds);
      for (let d = 1; d <= maxD; d++) {
        if (fF.size === 0) break;
        const n = new Set<string>();
        for (const sourceId of fF) {
          const targets = fwdAdj.get(sourceId);
          if (targets) {
            for (let i = 0; i < targets.length; i++) {
              const l = targets[i];
              if (!fV.has(l.target)) {
                fV.add(l.target);
                n.add(l.target);
                const nd = nodeMap.get(l.target);
                if (nd && !nd.id.startsWith("external:")) callees.set(l.target, { name: nd.label, type: nd.type, filePath: nd.filePath || null, depth: d });
              }
            }
          }
        }
        fF = n;
      }

      // Reverse (callers)
      let rF = new Set(symbolIds);
      const rV = new Set(symbolIds);
      for (let d = 1; d <= maxD; d++) {
        if (rF.size === 0) break;
        const n = new Set<string>();
        for (const targetId of rF) {
          const sources = revAdj.get(targetId);
          if (sources) {
            for (let i = 0; i < sources.length; i++) {
              const l = sources[i];
              if (!rV.has(l.source)) {
                rV.add(l.source);
                n.add(l.source);
                const nd = nodeMap.get(l.source);
                if (nd && !nd.id.startsWith("external:")) callers.set(l.source, { name: nd.label, type: nd.type, filePath: nd.filePath || null, depth: d });
              }
            }
          }
        }
        rF = n;
      }

      // Colocate tests by pattern (*.test.*, __tests__, spec) for impact analysis
      const testFiles = new Set<string>();
      for (const id of [...symbolIds]) {
        const n = nodeMap.get(id);
        if (n?.filePath) {
          const absPath = path.isAbsolute(n.filePath) ? n.filePath : path.resolve(loaded.projectDir, n.filePath);
          try {
            const entries = fs.readdirSync(path.dirname(absPath));
            const base = path.basename(absPath).replace(path.extname(absPath), "");
            // ⚡ Bolt Optimization: Use precompiled regex to avoid memory-intensive .toLowerCase() string allocations in tight loops
            const baseRegex = new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i");
            for (const e of entries) if ((e.includes(".test.") || e.includes(".spec.")) && baseRegex.test(e)) testFiles.add(path.join(path.dirname(absPath), e));
          } catch { /* skip */ }
        }
      }

      const affectedFiles = new Set<string>();
      for (const c of [...Array.from(callers.values()), ...Array.from(callees.values())]) if (c.filePath) affectedFiles.add(c.filePath);

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          symbol, project: loaded.projectName,
          impact: { incomingDependents: callers.size, outgoingDependencies: callees.size, totalAffectedFiles: affectedFiles.size, affectedFiles: Array.from(affectedFiles), testFiles: Array.from(testFiles) },
          callers: Array.from(callers.values()).slice(0, 20),
          callees: Array.from(callees.values()).slice(0, 20),
          recommendation: callers.size > 10 ? "HIGH IMPACT" : callers.size > 0 ? "MEDIUM IMPACT" : "LOW IMPACT",
        }, null, 2) }],
      };
    }
  );

  // Tool 17: project_context — One-shot comprehensive project overview
  server.tool(
    "project_context",
    "Get a comprehensive overview of a project in ONE call: package.json (name, version, scripts, deps, devDeps), config files detected, README summary, test framework, git branch. Saves 5-10 individual read_file calls when starting work.",
    {
      project: z.string().max(255).optional().describe("Project name or path (auto-detects if omitted)"),
    },
    async ({ project }: { project?: string }) => {
      const auth = await checkAuth();
      await logActivity(auth, "project_context", { project });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

      const projectDir = loaded.projectDir;

      // 🛡️ Sentinel Security Validation
      // Ensure the project directory is an authorized workspace to prevent path traversal
      const authorizedProjects = await discoverProjectsAsync(auth.uid);
      if (!isPathInAuthorizedProjects(projectDir, authorizedProjects)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Unauthorized project directory" }) }] };
      }

      const ctx: any = { name: loaded.projectName, path: projectDir };

      // package.json
      const pkgPath = path.join(projectDir, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          ctx.version = pkg.version; ctx.description = pkg.description;
          ctx.scripts = pkg.scripts || {}; ctx.scriptCount = Object.keys(ctx.scripts).length;
          ctx.dependencies = pkg.dependencies ? Object.keys(pkg.dependencies) : [];
          ctx.devDependencies = pkg.devDependencies ? Object.keys(pkg.devDependencies) : [];
          ctx.main = pkg.main; ctx.bin = pkg.bin;
        } catch { /* skip */ }
      }

      // Config files
      ctx.configFiles = {};
      await Promise.all(
        Object.entries({ tsconfig: "tsconfig.json", eslint: ".eslintrc.js", prettier: ".prettierrc", jest: "jest.config.js", vitest: "vitest.config.ts", playwright: "playwright.config.ts", docker: "Dockerfile" }).map(async ([key, f]) => {
          try {
            await fs.promises.access(path.join(projectDir, f));
            ctx.configFiles[key] = true;
          } catch {
            ctx.configFiles[key] = false;
          }
        })
      );

      // README
      for (const r of ["README.md", "README"]) {
        const rp = path.join(projectDir, r);
        if (fs.existsSync(rp)) { ctx.readme = { file: r, length: fs.statSync(rp).size }; break; }
      }

      // Git branch
      const gh = path.join(projectDir, ".git", "HEAD");
      if (fs.existsSync(gh)) {
        try {
          const h = fs.readFileSync(gh, "utf-8").trim();
          const m = h.match(/^ref:\s*refs\/heads\/(.+)$/);
          ctx.gitBranch = m ? m[1] : "(detached)";
        } catch { /* skip */ }
      }

      // Stats
      const st = getStats(loaded.analysis);
      ctx.stats = { files: st.files, functions: st.functions, classes: st.classes, deps: st.dependencies, circularDeps: st.circularDeps, deadCode: st.deadCode };

      // Top files
      const fc = new Map<string, number>();
      for (const n of loaded.analysis.graph.nodes) if (n.filePath && !n.id.startsWith("external:")) fc.set(n.filePath, (fc.get(n.filePath) || 0) + 1);
      ctx.topFiles = Array.from(fc.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f, c]) => ({ file: f, entities: c }));

      ctx.testFramework = ctx.configFiles.vitest ? "vitest" : ctx.configFiles.jest ? "jest" : ctx.configFiles.playwright ? "playwright" : "unknown";

      return { content: [{ type: "text" as const, text: JSON.stringify(ctx, null, 2) }] };
    }
  );

  // Tool 18: run_script — Run npm scripts
  server.tool(
    "run_script",
    "Run an npm/pnpm/yarn script from package.json. Returns exit code, stdout/stderr, and duration. Handles cd to project dir automatically.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      script: z.string().max(255).describe("Script name from package.json (e.g. 'build', 'test', 'lint')"),
      args: z.string().max(255).optional().describe("Optional args (e.g. '-- --watch')"),
      timeout: z.number().optional().describe("Timeout in seconds (default: 60, max: 300)"),
    },
    async ({ project, script, args, timeout }: { project?: string; script: string; args?: string; timeout?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "run_script", { project, script, args, timeout });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

      // 🛡️ Sentinel Security Validation
      // Use spawnSync without a shell to prevent command injection entirely
      const projectDir = loaded.projectDir;

      // Ensure the project directory is an authorized workspace to prevent path traversal
      const authorizedProjects = await discoverProjectsAsync(auth.uid);
      if (!isPathInAuthorizedProjects(projectDir, authorizedProjects)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Unauthorized project directory" }) }] };
      }

      const pkgPath = path.join(projectDir, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          if (!pkg.scripts?.[script]) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Script '${script}' not found`, available: pkg.scripts ? Object.keys(pkg.scripts) : [] }) }] };
        } catch { /* skip */ }
      }

      const maxTime = Math.min(timeout || 60, 300);
      const startTime = Date.now();

      try {
        const cp = require("child_process");
        let parsedArgs: string[] = [];
        if (args) {
          // Security: Block shell metacharacters to prevent indirect command injection in the target script
          if (SHELL_METACHAR_RE.test(args)) {
            const truncatedArgs = args.length > 50 ? args.substring(0, 50) + "..." : args;
            return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Security Error: Arguments contain forbidden shell metacharacters (& | ; < > $ \` \\). Received: ${truncatedArgs}` }, null, 2) }] };
          }
          const match = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
          if (match) {
            parsedArgs = match.map(m => {
              if ((m.startsWith('"') && m.endsWith('"')) || (m.startsWith("'") && m.endsWith("'"))) {
                return m.substring(1, m.length - 1);
              }
              return m;
            });
          }
        }

        // Security: Prevent npm argument injection (e.g. --prefix) by forcing all args to be passed to the script
        const finalArgs = ["run", script];
        if (parsedArgs.length > 0) {
          if (parsedArgs[0] !== "--") {
            finalArgs.push("--");
          }
          finalArgs.push(...parsedArgs);
        }

        const result = cp.spawnSync("npm", finalArgs, {
          timeout: maxTime * 1000,
          shell: false, // Security: explicit shell false
          maxBuffer: 1024 * 1024,
          cwd: projectDir
        });

        const dur = ((Date.now() - startTime) / 1000).toFixed(1);

        if (result.error) {
          throw result.error;
        }

        const stdoutStr = result.stdout ? result.stdout.toString().substring(0, 10000) : "";
        const stderrStr = result.stderr ? result.stderr.toString().substring(0, 5000) : "";

        if (result.status !== 0) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ script, project: loaded.projectName, exitCode: result.status || 1, duration: `${dur}s`, stdout: stdoutStr, stderr: stderrStr, error: `Process exited with code ${result.status}` }, null, 2) }] };
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({ script, project: loaded.projectName, exitCode: 0, duration: `${dur}s`, stdout: stdoutStr, stderr: stderrStr }, null, 2) }] };
      } catch (err: any) {
        const dur = ((Date.now() - startTime) / 1000).toFixed(1);
        return { content: [{ type: "text" as const, text: JSON.stringify({ script, project: loaded.projectName, exitCode: err.status || 1, duration: `${dur}s`, stdout: (err.stdout || "").toString().substring(0, 10000), stderr: (err.stderr || "").toString().substring(0, 5000), error: err.killed ? "TIMEOUT" : err.message?.substring(0, 300) }, null, 2) }] };
      }
    }
  );

  // Tool 19: git_changes — Recent git activity
  server.tool(
    "git_changes",
    "Get recent git changes: last N commits (hash, author, date, message, files changed), uncommitted changes (modified/added/deleted), branch status (ahead/behind). Saves multiple git commands.",
    {
      project: z.string().max(255).optional().describe("Project name or path"),
      commits: z.number().optional().describe("Number of recent commits (default: 5, max: 20)"),
    },
    async ({ project, commits }: { project?: string; commits?: number }) => {
      const auth = await checkAuth();
      await logActivity(auth, "git_changes", { project, commits });
      const loaded = await loadAnalysisAsync(project);
      if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

      const projectDir = loaded.projectDir;

      // 🛡️ Sentinel Security Validation
      // Ensure the project directory is an authorized workspace to prevent path traversal
      const authorizedProjects = await discoverProjectsAsync(auth.uid);
      if (!isPathInAuthorizedProjects(projectDir, authorizedProjects)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Unauthorized project directory" }) }] };
      }

      if (!fs.existsSync(path.join(projectDir, ".git"))) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Not a git repository" }) }] };

      const maxC = Math.min(commits || 5, 20);
      const result: any = { project: loaded.projectName };
      const cp = require("child_process");

      try {
        result.branch = cp.execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectDir, encoding: "utf-8" }).toString().trim();
        const st = cp.execFileSync("git", ["status", "--porcelain"], { cwd: projectDir, encoding: "utf-8" }).toString();
        const mod: string[] = [], add: string[] = [], del: string[] = [];
        for (const line of st.split("\n").map((x: string) => x.trim()).filter(Boolean)) { const s = line.substring(0, 2), f = line.substring(3); if (s.includes("M")) mod.push(f); if (s.includes("A")) add.push(f); if (s.includes("D")) del.push(f); }
        result.uncommitted = { modified: mod.slice(0, 20), added: add.slice(0, 10), deleted: del.slice(0, 10), hasChanges: st.trim().length > 0 };
        try {
          const [behind, ahead] = cp.execFileSync("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd: projectDir, encoding: "utf-8" }).toString().trim().split("\t").map(Number);
          result.ahead = ahead || 0; result.behind = behind || 0;
        } catch { result.ahead = null; result.behind = null; }
        const logRaw = cp.execFileSync("git", ["log", `-${maxC}`, "--format=COMMIT%n%H%n%an%n%ai%n%s%nFILES:", "--name-only"], { cwd: projectDir, encoding: "utf-8", maxBuffer: 1024 * 1024 }).toString();
        result.recentCommits = [];
        for (const block of logRaw.split("COMMIT\n").filter(Boolean)) {
          const ls = block.trim().split("\n"); if (ls.length < 4) continue;
          const ci: any = { hash: ls[0]?.substring(0, 12), author: ls[1], date: ls[2], message: ls[3] };
          const fi = ls.findIndex((x: string) => x === "FILES:");
          if (fi !== -1) ci.files = ls.slice(fi + 1).filter((x: string) => x.trim()).slice(0, 15);
          result.recentCommits.push(ci);
        }
      } catch (err: any) { result.error = err.message?.substring(0, 300); }

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── Tool 9a: Setup Second Brain ──────────────────────────────
  server.tool(
    "setup_second_brain",
    "Configure CodeAtlas Second Brain for any MCP client (Hermes, Claude Code, Gemini CLI). "
    + "Installs MCP config and auto-retrieval plugin so the AI automatically saves/retrieves knowledge.",
    {
      client: z.enum(["hermes", "claude", "gemini", "all"]).optional().default("all")
        .describe("Which client to configure. Choose one of: hermes, claude, gemini, all"),
      apiKey: z.string().max(255).optional().describe("CODEATLAS_API_KEY (will use env var if not provided)"),
      autoPlugin: z.boolean().optional().default(true)
        .describe("Also install Hermes auto Second Brain plugin (pre/post LLM hooks)"),
    },
    async ({ client = "all", apiKey, autoPlugin = true }) => {
      const auth = await checkAuth();
      await logActivity(auth, "setup_second_brain", { client, autoPlugin });

      const key = apiKey || process.env.CODEATLAS_API_KEY;
      if (!key) return { content: [{ type: "text" as const, text: JSON.stringify({
        success: false, error: "CODEATLAS_API_KEY not set. Provide apiKey parameter or set env var."
      }, null, 2) }] };

      const results: any[] = [];
      const mcpEntry = `  codeatlas:\n    command: npx\n    args: ["-y", "codeatlas-enterprise"]\n    env:\n      CODEATLAS_API_KEY: ${JSON.stringify(key)}\n    enabled: true\n`;

      // Hermes MCP config
      if (client === "hermes" || client === "all") {
        const hermesCfg = getHermesConfigPath();
        try {
          if (fs.existsSync(hermesCfg)) {
            let cfg = fs.readFileSync(hermesCfg, "utf-8");
            if (cfg.includes("codeatlas:")) {
              results.push({ client: "hermes", action: "mcp_config", status: "already_configured" });
            } else if (cfg.includes("mcp_servers:")) {
              cfg = cfg.replace("mcp_servers:", "mcp_servers:\n" + mcpEntry);
              fs.writeFileSync(hermesCfg, cfg);
              results.push({ client: "hermes", action: "mcp_config", status: "updated" });
            } else {
              fs.writeFileSync(hermesCfg, "\nmcp_servers:\n" + mcpEntry, { flag: "a" });
              results.push({ client: "hermes", action: "mcp_config", status: "appended" });
            }
          } else {
            fs.mkdirSync(path.dirname(hermesCfg), { recursive: true });
            fs.writeFileSync(hermesCfg, "mcp_servers:\n" + mcpEntry);
            results.push({ client: "hermes", action: "mcp_config", status: "created" });
          }
        } catch (err: any) {
          results.push({ client: "hermes", action: "mcp_config", status: "error", error: err.message });
        }

        // Hermes auto plugin
        if (autoPlugin) {
          try {
            const pluginDir = getHermesPluginDir();
            if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
            const pluginInit = `"""CodeAtlas Second Brain Plugin — Auto activation on every turn"""
import json, os, urllib.request, urllib.parse, logging
from typing import Any
log = logging.getLogger(__name__)
KEY = os.environ.get("CODEATLAS_API_KEY", "")
URL = os.environ.get("CODEATLAS_API_URL", "https://your-server.com/")
UA = "Hermes-SecondBrain-Plugin/1.0"
def _rq(m, p, b=None, q=None):
    import urllib.error
    u = URL.rstrip("/") + p
    if q: u += "?" + "&".join(f"{k}={urllib.parse.quote(str(v))}" for k,v in q.items() if v)
    h = urllib.request.Request(u, data=json.dumps(b).encode() if b else None, method=m)
    h.add_header("x-api-key", KEY); h.add_header("Content-Type", "application/json"); h.add_header("User-Agent", UA)
    try:
        r = urllib.request.urlopen(h, timeout=10)
        return json.loads(r.read().decode()), r.status
    except urllib.error.HTTPError as e:
        return {"err": e.read().decode("utf-8",errors="replace")[:200]}, e.code
def register(ctx):
    def on_pre_llm_call(**kw):
        user = kw.get("user_message","")
        if not user: return None
        parts = []
        try:
            r,s = _rq("GET","/api/dreams/query",q={"query":user,"project":"hermes-auto","limit":3})
            m = r.get("memories",[]) if 200<=s<300 else []
            if m:
                ctx=["## Auto-retrieved Dreams from CodeAtlas"]
                for x in m:
                    c = x.get("content","")[:120]
                    if c: ctx.append(f"- [{x.get('memory_type','?')}] {c}")
                parts.append("\\n".join(ctx))
        except: pass
        try:
            r,s = _rq("GET","/api/genome/search",q={"query":user,"project":"hermes-auto","limit":3})
            g = r.get("genes",[]) if 200<=s<300 else []
            if g:
                ctx=["## Auto-retrieved Genome DNA"]
                for x in g[:3]: ctx.append(f"- [{x.get('category','')}] {x.get('name','')} (conf:{x.get('confidence','')})")
                parts.append("\\n".join(ctx))
        except: pass
        try:
            r,s = _rq("GET","/api/genome/immune/context",q={"problem":user,"project":"hermes-auto"})
            c = r.get("context","") if 200<=s<300 else ""
            if c and len(c)>50: parts.append(f"## Auto-retrieved Immune Prevention\\n{c[:500]}")
        except: pass
        if parts: return {"context":"\\n\\n".join(parts)}
        return None
    def on_post_llm_call(**kw):
        resp = kw.get("assistant_response","")
        if not resp or len(resp)<100: return
        try: _rq("POST","/api/dreams/save",b={"memory_type":"KNOWLEDGE","content":"[Auto-Save] "+resp[:200].replace(chr(10)," "),"importance":5,"project":"hermes-auto","session_id":"auto-"+kw.get("turn_id","0")})
        except: pass
    ctx.register_hook("pre_llm_call",on_pre_llm_call)
    ctx.register_hook("post_llm_call",on_post_llm_call)
    log.info("Second Brain auto plugin active")
`;
            const pluginYaml = `name: codeatlas_second_brain\nversion: "1.0"\ndescription: Automatic Second Brain activation\nhooks:\n  - pre_llm_call\n  - post_llm_call\nenabled: true\n`;
            fs.writeFileSync(path.join(pluginDir, "__init__.py"), pluginInit);
            fs.writeFileSync(path.join(pluginDir, "plugin.yaml"), pluginYaml);
            results.push({ client: "hermes", action: "auto_plugin", status: "installed" });
          } catch (err: any) {
            results.push({ client: "hermes", action: "auto_plugin", status: "error", error: err.message });
          }
        }
      }

      // Claude MCP config
      if (client === "claude" || client === "all") {
        const claudeCfg = getClaudeConfigPath();
        try {
          const claudeEntry = { mcpServers: {
            codeatlas: { command: "npx", args: ["-y", "codeatlas-enterprise"], env: { CODEATLAS_API_KEY: key } },
            ["codeatlas-genome"]: { command: "npx", args: ["-y", "codeatlas-enterprise"], env: { CODEATLAS_API_KEY: key } },
          }};
          if (fs.existsSync(claudeCfg)) {
            const existing = JSON.parse(fs.readFileSync(claudeCfg, "utf-8"));
            existing.mcpServers = { ...existing.mcpServers, ...claudeEntry.mcpServers };
            fs.writeFileSync(claudeCfg, JSON.stringify(existing, null, 2));
            results.push({ client: "claude", action: "mcp_config", status: "updated" });
          } else {
            fs.mkdirSync(path.dirname(claudeCfg), { recursive: true });
            fs.writeFileSync(claudeCfg, JSON.stringify(claudeEntry, null, 2));
            results.push({ client: "claude", action: "mcp_config", status: "created" });
          }
        } catch (err: any) {
          results.push({ client: "claude", action: "mcp_config", status: "error", error: err.message });
        }
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({
        success: true, results,
        summary: `${results.filter(r => !r.error).length}/${results.length} operations succeeded`,
        restartRequired: true,
        message: "Restart your MCP client for changes to take effect",
      }, null, 2) }] };
    }
  );

  // ── Tool 9b: Check Second Brain Status ──────────────────────
  server.tool(
    "check_second_brain_status",
    "Check the current Second Brain configuration status for all MCP clients.",
    {},
    async () => {
      const auth = await checkAuth();
      const results: any = { hermes: {}, claude: {}, gemini: {} };

      // Hermes
      const hermesCfg = getHermesConfigPath();
      if (fs.existsSync(hermesCfg)) {
        const cfg = fs.readFileSync(hermesCfg, "utf-8");
        results.hermes.mcp = cfg.includes("codeatlas:") ? "configured" : "not_configured";
      } else {
        results.hermes.mcp = "no_config";
      }
      const pluginDir = getHermesPluginDir();
      results.hermes.plugin = fs.existsSync(path.join(pluginDir, "__init__.py")) ? "installed" : "not_installed";
      results.hermes.restartRequired = results.hermes.plugin === "installed" || results.hermes.mcp === "not_configured";
      // Claude
      const claudeCfg = getClaudeConfigPath();
      if (fs.existsSync(claudeCfg)) {
        const cl = JSON.parse(fs.readFileSync(claudeCfg, "utf-8"));
        results.claude.mcp = cl.mcpServers?.codeatlas ? "configured" : "not_configured";
      } else {
        results.claude.mcp = "no_config";
      }

      // API key
      results.apiKey = process.env.CODEATLAS_API_KEY ? "set" : "not_set";

      // Cloud connectivity
      try {
        const resp = await fetch(`${process.env.CODEATLAS_API_URL || "https://your-server.com"}/api/genome/search?limit=1`, {
          headers: { "x-api-key": process.env.CODEATLAS_API_KEY || "", "User-Agent": "codeatlas-enterprise/2.0" },
        });
        results.cloud = resp.ok ? "reachable" : `error_${resp.status}`;
      } catch {
        results.cloud = "unreachable";
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    }
  );
}

// MCP SDK requires a single server instance; tools are registered before transport.start().
export const server = new McpServer(
  {
    name: "CodeAtlas",
    version: "2.2.3",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      logging: {},
    },
  }
);

registerTools(server);

