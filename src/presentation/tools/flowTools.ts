import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { checkAuth, logActivity } from "../../services/authService.js";
import { loadAnalysisAsync } from "../../services/projectService.js";


export function registerFlowTools(server: McpServer) {
    // Tool 6: Generate System Flow
    server.tool(
      "generate_system_flow",
      "Auto-generate a Mermaid flowchart diagram showing how modules, classes, and functions connect in the system. Returns a Mermaid diagram string that AI can read to understand the full system flow without reading every file.",
      {
        project: z.string().optional().describe("Project name or path"),
        scope: z.enum(["full", "modules-only", "feature"]).optional().describe("Scope of the diagram: 'full' shows all entities, 'modules-only' shows only module relationships (recommended for large projects), 'feature' requires the 'feature' param. Choose one of: full, modules-only, feature"),
        feature: z.string().optional().describe("Feature keyword to focus the diagram on (e.g. 'auth', 'crawl', 'payment'). Only used when scope='feature'"),
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
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));

        // Filter by scope
        if (diagramScope === "modules-only") {
          nodes = nodes.filter((n) => n.type === "module" && (n.filePath || n.id.startsWith("external:")));
          const nodeIds = new Set(nodes.map((n) => n.id));
          links = links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target) && l.type === "import");
        } else if (diagramScope === "feature" && feature) {
          const q = feature.toLowerCase();
          const matchingNodes = new Set<string>();
          nodes.forEach((n) => {
            if (n.label.toLowerCase().includes(q) || (n.filePath && n.filePath.toLowerCase().includes(q))) {
              matchingNodes.add(n.id);
            }
          });
          links.forEach((l) => {
            if (matchingNodes.has(l.source)) matchingNodes.add(l.target);
            if (matchingNodes.has(l.target)) matchingNodes.add(l.source);
          });
          nodes = nodes.filter((n) => matchingNodes.has(n.id));
          const nodeIds = new Set(nodes.map((n) => n.id));
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

        const truncatedNodeIds = new Set(nodes.map((n) => n.id));
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

    // Tool 8c: Trace Feature Flow
    server.tool(
      "trace_feature_flow",
      "Trace the complete flow of a feature through the codebase. Given a keyword (e.g. 'login', 'payment', 'crawl'), finds all related files, classes, and functions, then orders them by dependency chain to show the execution flow. This helps AI understand which files to read when working on a feature.",
      {
        project: z.string().optional().describe("Project name or path"),
        keyword: z.string().describe("Feature keyword to trace (e.g. 'auth', 'crawl', 'payment', 'upload')"),
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
        const q = keyword.toLowerCase();
        const nodes = loaded.analysis.graph.nodes;
        const links = loaded.analysis.graph.links;
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));

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
            node.label.toLowerCase().includes(q) ||
            (node.filePath && node.filePath.toLowerCase().includes(q)) ||
            node.id.toLowerCase().includes(q)
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
        project: z.string().optional().describe("Project name or path"),
        keyword: z.string().describe("Feature keyword to trace (e.g. 'login', 'payment', 'upload', 'auth')"),
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

        const q = keyword.toLowerCase();
        const maxDepth = depth || 3;
        const maxN = maxNodes || 40;
        const dType = diagramType || "flowchart";
        const nodes = loaded.analysis.graph.nodes;
        const links = loaded.analysis.graph.links;
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        const nodeNameMap = new Map(nodes.map((n) => [n.id, n.label]));

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
            node.label.toLowerCase().includes(q) ||
            (node.filePath && node.filePath.toLowerCase().includes(q)) ||
            node.id.toLowerCase().includes(q)
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

        const traceNodeIds = new Set(traceNodes.map((n) => n.id));
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

    // Tool 16: impact_analysis — Blast radius analysis
    server.tool(
      "impact_analysis",
      "Full BLAST RADIUS analysis for changing a symbol. Traces BOTH callers (what depends on this) AND callees (what this depends on) in one view. Also finds related test files. Use BEFORE any significant code change.",
      {
        project: z.string().optional().describe("Project name or path"),
        symbol: z.string().describe("Function, class, or module name (case-insensitive, partial match)"),
        depth: z.number().optional().describe("How many levels deep (default: 2, max: 5)"),
      },
      async ({ project, symbol, depth }: { project?: string; symbol: string; depth?: number }) => {
        const auth = await checkAuth();
        await logActivity(auth, "impact_analysis", { project, symbol, depth });
        const loaded = await loadAnalysisAsync(project);
        if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

        const q = symbol.toLowerCase();
        const maxD = Math.min(depth || 2, 5);
        const nodes = loaded.analysis.graph.nodes;
        const links = loaded.analysis.graph.links;
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        const symbolIds = new Set<string>();

        for (const node of nodes) {
          if (node.label.toLowerCase().includes(q) && !node.id.startsWith("external:")) symbolIds.add(node.id);
        }
        if (symbolIds.size === 0) return { content: [{ type: "text" as const, text: JSON.stringify({ symbol, matchCount: 0, message: `No symbol '${symbol}' found.` }) }] };

        const callers = new Map<string, { name: string; type: string; filePath: string | null; depth: number }>();
        const callees = new Map<string, { name: string; type: string; filePath: string | null; depth: number }>();

        // Forward (callees)
        let fF = new Set(symbolIds);
        const fV = new Set(symbolIds);
        for (let d = 1; d <= maxD; d++) {
          const n = new Set<string>();
          for (const l of links) if ((l.type === "call" || l.type === "import") && fF.has(l.source) && !fV.has(l.target)) { fV.add(l.target); n.add(l.target); const nd = nodeMap.get(l.target); if (nd && !nd.id.startsWith("external:")) callees.set(l.target, { name: nd.label, type: nd.type, filePath: nd.filePath || null, depth: d }); }
          fF = n;
        }

        // Reverse (callers)
        let rF = new Set(symbolIds);
        const rV = new Set(symbolIds);
        for (let d = 1; d <= maxD; d++) {
          const n = new Set<string>();
          for (const l of links) if ((l.type === "call" || l.type === "import") && rF.has(l.target) && !rV.has(l.source)) { rV.add(l.source); n.add(l.source); const nd = nodeMap.get(l.source); if (nd && !nd.id.startsWith("external:")) callers.set(l.source, { name: nd.label, type: nd.type, filePath: nd.filePath || null, depth: d }); }
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
              for (const e of entries) if ((e.includes(".test.") || e.includes(".spec.")) && e.toLowerCase().includes(base.toLowerCase())) testFiles.add(path.join(path.dirname(absPath), e));
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

}
