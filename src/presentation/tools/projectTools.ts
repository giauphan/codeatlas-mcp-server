import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { checkAuth, logActivity } from "../../services/authService.js";
import { discoverProjectsAsync, loadAnalysisAsync, getStats, fileExists, syncAnalysisToServer, inMemoryAnalysisCache, AnalysisResultLocal } from "../../services/projectService.js";
import { CodeAnalyzer } from "../../analyzer/parser.js";


export function registerProjectTools(server: McpServer) {
    // Tool -1: Analyze a project
    server.tool(
      "analyze",
      "Perform deep code analysis on a local project directory. Generates AST analysis in memory and syncs to CodeAtlas Cloud.",
      {
        path: z.string().describe("Absolute path to the project directory to analyze"),
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
        const homeDir = os.homedir();
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
        project: z.string().optional().describe("Project name or path (auto-detects if omitted)"),
        type: z.enum(["all", "module", "class", "function", "variable"]).optional().describe("Filter by entity type"),
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
        project: z.string().optional().describe("Project name or path"),
        source: z.string().optional().describe("Filter by source entity name"),
        target: z.string().optional().describe("Filter by target entity name"),
        relationship: z.enum(["all", "import", "call", "contains", "implements"]).optional().describe("Filter by relationship type"),
        limit: z.number().optional().describe("Max results (default: 100)"),
      },
      async ({ project, source, target, relationship, limit }: { project?: string; source?: string; target?: string; relationship?: string; limit?: number }) => {
        const auth = await checkAuth();
        await logActivity(auth, "get_dependencies", { project, source, target, relationship, limit });
        const loaded = await loadAnalysisAsync(project);
        if (!loaded) {
          return { content: [{ type: "text" as const, text: "No analysis data found. Run 'analyze' tool first." }] };
        }

        const nodeMap = new Map(loaded.analysis.graph.nodes.map((n) => [n.id, n.label]));
        let links = loaded.analysis.graph.links;

        if (relationship && relationship !== "all") {
          links = links.filter((l) => l.type === relationship);
        }
        if (source) {
          links = links.filter((l) => {
            const label = nodeMap.get(l.source) || l.source;
            return label.toLowerCase().includes(source.toLowerCase());
          });
        }
        if (target) {
          links = links.filter((l) => {
            const label = nodeMap.get(l.target) || l.target;
            return label.toLowerCase().includes(target.toLowerCase());
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

    // Tool 17: project_context — One-shot comprehensive project overview
    server.tool(
      "project_context",
      "Get a comprehensive overview of a project in ONE call: package.json (name, version, scripts, deps, devDeps), config files detected, README summary, test framework, git branch. Saves 5-10 individual read_file calls when starting work.",
      {
        project: z.string().optional().describe("Project name or path (auto-detects if omitted)"),
      },
      async ({ project }: { project?: string }) => {
        const auth = await checkAuth();
        await logActivity(auth, "project_context", { project });
        const loaded = await loadAnalysisAsync(project);
        if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

        const projectDir = loaded.projectDir;
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
        for (const [key, f] of Object.entries({ tsconfig: "tsconfig.json", eslint: ".eslintrc.js", prettier: ".prettierrc", jest: "jest.config.js", vitest: "vitest.config.ts", playwright: "playwright.config.ts", docker: "Dockerfile" })) {
          ctx.configFiles[key] = fs.existsSync(path.join(projectDir, f));
        }

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

    // Tool 13: code_search — Full-text search across source files
    server.tool(
      "code_search",
      "Search source FILE CONTENTS across the entire project for any text string. Unlike 'search_entities' (which only searches entity names), this searches the actual code — comments, strings, variable names, function bodies, etc.",
      {
        project: z.string().optional().describe("Project name or path (auto-detects if omitted)"),
        query: z.string().describe("Text to search for in source file contents (case-insensitive)"),
        filePattern: z.string().optional().describe("Optional file glob pattern to narrow search (e.g. '*.ts', '*.py'). Default: all supported files"),
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
        const q = query.toLowerCase();
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
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxRes) break;
              if (lines[i].toLowerCase().includes(q)) {
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

}
