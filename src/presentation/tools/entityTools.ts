import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as path from "path";
import { checkAuth, logActivity } from "../../services/authService.js";
import { loadAnalysisAsync } from "../../services/projectService.js";


export function registerEntityTools(server: McpServer) {
    // Tool 4: Search entities
    server.tool(
      "search_entities",
      "Search for functions, classes, modules, or variables by name. Supports fuzzy matching.",
      {
        project: z.string().optional().describe("Project name or path"),
        query: z.string().describe("Search query (case-insensitive, partial match)"),
        type: z.enum(["all", "module", "class", "function", "variable"]).optional().describe("Filter by entity type"),
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

        const q = query.toLowerCase();
        const matches = nodes.filter((n) => n.label.toLowerCase().includes(q));

        // For each match, find its relationships
        const links = loaded.analysis.graph.links;
        const nodeMap = new Map(loaded.analysis.graph.nodes.map((n) => [n.id, n.label]));

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
        project: z.string().optional().describe("Project name or path"),
        filePath: z.string().describe("File path (partial match, e.g. 'User.php' or 'src/models')"),
      },
      async ({ filePath, project }: { project?: string; filePath: string }) => {
        const auth = await checkAuth();
        await logActivity(auth, "get_file_entities", { filePath, project });
        const loaded = await loadAnalysisAsync(project);
        if (!loaded) {
          return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
        }

        const q = filePath.toLowerCase().replace(/\\/g, "/");
        const matches = loaded.analysis.graph.nodes.filter((n) => {
          const fp = (n.filePath || n.id).toLowerCase().replace(/\\/g, "/");
          return fp.includes(q);
        });

        const links = loaded.analysis.graph.links;
        const nodeMap = new Map(loaded.analysis.graph.nodes.map((n) => [n.id, n.label]));

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

    // Tool 14: get_callers — Find all callers of a function/class
    server.tool(
      "get_callers",
      "Find ALL functions, methods, or classes that call or reference a specific symbol. The 'reverse dependency' view — given a function/class name, trace everything that depends on it. Use before refactoring or deleting code.",
      {
        project: z.string().optional().describe("Project name or path"),
        symbol: z.string().describe("Function or class name to find callers (case-insensitive, partial match)"),
        maxResults: z.number().optional().describe("Maximum callers to return (default: 30)"),
        depth: z.number().optional().describe("How many levels deep (default: 1, max: 5)"),
      },
      async ({ project, symbol, maxResults, depth }: { project?: string; symbol: string; maxResults?: number; depth?: number }) => {
        const auth = await checkAuth();
        await logActivity(auth, "get_callers", { project, symbol, maxResults, depth });
        const loaded = await loadAnalysisAsync(project);
        if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

        const q = symbol.toLowerCase();
        const maxD = Math.min(depth || 1, 5);
        const nodes = loaded.analysis.graph.nodes;
        const links = loaded.analysis.graph.links;
        const targetIds = new Set<string>();
        const targetNames = new Map<string, string>();

        for (const node of nodes) {
          if (node.label.toLowerCase().includes(q) && !node.id.startsWith("external:")) {
            targetIds.add(node.id);
            targetNames.set(node.id, node.label);
          }
        }
        if (targetIds.size === 0) return { content: [{ type: "text" as const, text: JSON.stringify({ symbol, matchCount: 0, message: `No symbol '${symbol}' found.` }) }] };

        const callers = new Map<string, { name: string; type: string; filePath: string | null; line: number | null; depth: number; via: string[] }>();
        let frontier = new Set(targetIds);
        const visited = new Set(targetIds);
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));

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
        project: z.string().optional().describe("Project name or path"),
        symbol: z.string().describe("Function or class name to find callees (case-insensitive, partial match)"),
        maxResults: z.number().optional().describe("Maximum callees (default: 30)"),
        depth: z.number().optional().describe("How many levels deep (default: 1, max: 5)"),
      },
      async ({ project, symbol, maxResults, depth }: { project?: string; symbol: string; maxResults?: number; depth?: number }) => {
        const auth = await checkAuth();
        await logActivity(auth, "get_callees", { project, symbol, maxResults, depth });
        const loaded = await loadAnalysisAsync(project);
        if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

        const q = symbol.toLowerCase();
        const maxD = Math.min(depth || 1, 5);
        const nodes = loaded.analysis.graph.nodes;
        const links = loaded.analysis.graph.links;
        const sourceIds = new Set<string>();

        for (const node of nodes) {
          if (node.label.toLowerCase().includes(q) && !node.id.startsWith("external:")) sourceIds.add(node.id);
        }
        if (sourceIds.size === 0) return { content: [{ type: "text" as const, text: JSON.stringify({ symbol, matchCount: 0, message: `No symbol '${symbol}' found.` }) }] };

        const callees = new Map<string, { name: string; type: string; filePath: string | null; line: number | null; depth: number }>();
        let frontier = new Set(sourceIds);
        const visited = new Set(sourceIds);
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));

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
        const nodeMap2 = new Map(nodes.map((n) => [n.id, n]));
        const sourceDetails = Array.from(sourceIds).map(id => { const n = nodeMap2.get(id); return n ? { name: n.label, type: n.type, filePath: n.filePath || null, line: n.line || null } : { name: id, type: "unknown", filePath: null, line: null }; });

        return { content: [{ type: "text" as const, text: JSON.stringify({ symbol, project: loaded.projectName, sources: sourceDetails, totalCallees: callees.size, maxDepth: maxD, callees: Array.from(callees.values()).slice(0, maxRes) }, null, 2) }] };
      }
    );

}
