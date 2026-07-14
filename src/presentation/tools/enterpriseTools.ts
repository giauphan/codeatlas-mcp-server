import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as path from "path";
import { checkAuth, logActivity } from "../../services/authService.js";
import { discoverProjectsAsync, loadAnalysisAsync, getStats } from "../../services/projectService.js";
import { SecurityScanner } from "../../securityScanner.js";


export function registerEnterpriseTools(server: McpServer) {
    // ── Tool 8d: Search Genome ─────────────────────────────────────
    server.tool(
      "search_genome",
      "Search CodeAtlas Genome for relevant genes. Uses semantic search to find the most relevant genes.",
      {
        query: z.string().describe("Natural language search query"),
        project: z.string().optional().describe("Filter by project"),
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
        geneId: z.string().describe("The gene ID to retrieve"),
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
        problem: z.string().describe("Describe the problem or error to scan for"),
        project: z.string().optional().describe("Filter by project"),
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
        problem: z.string().describe("The problem or task context"),
        failure: z.string().describe("What went wrong — the failure description"),
        prevention: z.string().describe("How to prevent or fix this failure"),
        project: z.string().optional().describe("Project to associate with this immune gene"),
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

    // Tool 11: Detect Architectural Smells
    server.tool(
      "detect_architectural_smells",
      "Knowledge Graph Reasoning: Use Oracle 26ai Graph features to automatically detect architectural weaknesses, circular dependencies, God objects, and dead code.",
      {
        project: z.string().optional().describe("Project name or path"),
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

        for (const p of projectsToScan) {
          try {
            const loaded = await loadAnalysisAsync(p.name);
            if (!loaded) continue;

            const vulnerabilities = SecurityScanner.scan(loaded.analysis);

            // AI-powered deep scan (if configured — uses DeepSeek V4 Pro)
            const aiVulnerabilities = await SecurityScanner.aiScan(vulnerabilities, loaded.analysis);
            const allVulnerabilities = aiVulnerabilities.length > 0 ? aiVulnerabilities : vulnerabilities;

            const stats = getStats(loaded.analysis as any);
            const circularDeps = stats.circularDeps || 0;
            const deadCode = stats.deadCode || 0;

            const riskLevel = allVulnerabilities.length > 10 ? "CRITICAL" : (allVulnerabilities.length > 0 ? "HIGH" : "LOW");
            const securityScore = Math.max(0, 100 - (allVulnerabilities.length * 5) - (circularDeps * 2));

            scanResults.push({
              project: p.name,
              riskLevel,
              securityScore: isEnterprise ? securityScore : "Upgrade to view",
              vulnerabilities: allVulnerabilities.length,
              circularDependencies: circularDeps,
              deadCode: deadCode,
              adminInsights: isEnterprise ? `Project health is ${securityScore > 80 ? 'EXCELLENT' : 'NEEDS ATTENTION'}. Priority: ${riskLevel}.` : null,
              details: { vulnerabilities }
            });
          } catch (err: unknown) {
            scanResults.push({
              project: p.name,
              error: `Scan failed: ${(err instanceof Error ? err.message : String(err))}`
            });
          }
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

}
