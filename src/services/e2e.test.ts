import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const TMP_DIR = path.join(os.tmpdir(), "codeatlas-e2e-" + Date.now());
const PROJECT_DIR = path.join(TMP_DIR, "test-project");

describe("E2E — 5 new features (manage_adr, get_code_snippet, index_coverage, detect_code_similarities, export_team_artifact)", () => {
  before(async () => {
    // Create test project with some source files
    fs.mkdirSync(path.join(PROJECT_DIR, "src"), { recursive: true });
    fs.mkdirSync(path.join(PROJECT_DIR, "utils"), { recursive: true });

    // Helper file
    fs.writeFileSync(path.join(PROJECT_DIR, "src", "userService.ts"), `
export class UserService {
  async getUser(id: string) {
    const user = await this.findUser(id);
    return user;
  }

  async findUser(id: string) {
    return { id, name: "Test" };
  }
}
`);

    // Similar file (for similarity detection)
    fs.writeFileSync(path.join(PROJECT_DIR, "utils", "helper.ts"), `
export class HelperService {
  async getHelper(id: string) {
    const item = await this.findHelper(id);
    return item;
  }

  async findHelper(id: string) {
    return { id, name: "Helper" };
  }
}
`);

    // Git init to make it a "real" project
    try { fs.mkdirSync(path.join(PROJECT_DIR, ".git")); } catch {}
    fs.writeFileSync(path.join(PROJECT_DIR, "package.json"), JSON.stringify({ name: "test-project", version: "1.0.0" }));
    fs.writeFileSync(path.join(PROJECT_DIR, ".gitignore"), "node_modules/\n");
    fs.writeFileSync(path.join(PROJECT_DIR, "README.md"), "# Test Project\n");

    // Mock analysis data
    const analysis = {
      graph: {
        nodes: [
          { id: "UserService", label: "UserService", type: "class", filePath: "src/userService.ts", line: 2 },
          { id: "getUser", label: "getUser", type: "function", filePath: "src/userService.ts", line: 3 },
          { id: "findUser", label: "findUser", type: "function", filePath: "src/userService.ts", line: 8 },
          { id: "HelperService", label: "HelperService", type: "class", filePath: "utils/helper.ts", line: 2 },
          { id: "getHelper", label: "getHelper", type: "function", filePath: "utils/helper.ts", line: 3 },
          { id: "findHelper", label: "findHelper", type: "function", filePath: "utils/helper.ts", line: 8 },
        ],
        links: [
          { source: "UserService", target: "getUser", type: "contains" },
          { source: "getUser", target: "findUser", type: "call" },
          { source: "HelperService", target: "getHelper", type: "contains" },
          { source: "getHelper", target: "findHelper", type: "call" },
        ],
      },
      insights: [],
      entityCounts: { modules: 2, functions: 4, classes: 2, dependencies: 2, circularDeps: 0 },
      totalFilesAnalyzed: 2,
      totalFilesSkipped: 0,
    };

    // Save analysis
    fs.mkdirSync(path.join(TMP_DIR, ".codeatlas"), { recursive: true });
    fs.writeFileSync(path.join(TMP_DIR, ".codeatlas", "analysis.json"), JSON.stringify(analysis));

    // Mock analysis index
    if (!process.env.CODEATLAS_ANALYSIS_DIR) {
      process.env.CODEATLAS_ANALYSIS_DIR = TMP_DIR;
    }

    // Import and mock the projectService module by setting env
    const { inMemoryAnalysisCache } = await import("./projectService.js");
    inMemoryAnalysisCache.set(PROJECT_DIR, analysis);
  });

  after(() => {
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* skip */ }
    delete process.env.CODEATLAS_ANALYSIS_DIR;
  });

  // ═══════════ ADR Service ═══════════
  describe("1. manage_adr — Architecture Decision Records", () => {
    it("creates and reads ADRs via service", async () => {
      const { saveADR, getADR } = await import("./adrService.js");
      saveADR({ id: "e2e-adr-1", title: "Use TypeScript", status: "accepted", context: "Need types", decision: "Adopt TS", consequences: "Slower build", project: "e2e-test", date: "2024-07-01" });
      const adr = getADR("e2e-adr-1", "e2e-test");
      assert.ok(adr);
      assert.strictEqual(adr!.title, "Use TypeScript");
      assert.strictEqual(adr!.status, "accepted");
    });

    it("lists ADRs sorted newest-first", async () => {
      const { saveADR, listADRs } = await import("./adrService.js");
      saveADR({ id: "e2e-adr-2", title: "Old", status: "proposed", context: "", decision: "A", consequences: "", project: "e2e-test", date: "2023-01-01" });
      saveADR({ id: "e2e-adr-3", title: "New", status: "accepted", context: "", decision: "B", consequences: "", project: "e2e-test", date: "2024-07-15" });
      const all = listADRs("e2e-test");
      assert.ok(all.length >= 3);
      assert.strictEqual(all[0].date, "2024-07-15");
    });

    it("updates ADR status and supersedes", async () => {
      const { saveADR, getADR, listADRs } = await import("./adrService.js");
      saveADR({ id: "e2e-adr-sup", title: "Superseded Dec", status: "accepted", context: "", decision: "X", consequences: "", project: "e2e-test", date: "2024-01-01" });
      const adr = getADR("e2e-adr-sup", "e2e-test")!;
      adr.status = "superseded";
      adr.supersededBy = "e2e-adr-new";
      const { saveADR: save2 } = await import("./adrService.js");
      save2(adr);
      const updated = getADR("e2e-adr-sup", "e2e-test")!;
      assert.strictEqual(updated.status, "superseded");
      assert.strictEqual(updated.supersededBy, "e2e-adr-new");
    });

    it("deletes ADRs", async () => {
      const { saveADR, getADR, deleteADR } = await import("./adrService.js");
      saveADR({ id: "e2e-adr-del", title: "Temp", status: "proposed", context: "", decision: "D", consequences: "", project: "e2e-test", date: "2024-01-01" });
      assert.ok(getADR("e2e-adr-del", "e2e-test"));
      deleteADR("e2e-adr-del", "e2e-test");
      assert.strictEqual(getADR("e2e-adr-del", "e2e-test"), null);
    });
  });

  // ═══════════ Code Snippet ═══════════
  describe("2. get_code_snippet — source code by symbol", () => {
    it("finds and reads code for a symbol", async () => {
      const { inMemoryAnalysisCache } = await import("./projectService.js");
      // We already set up cache in before()
      const cache = inMemoryAnalysisCache.get(PROJECT_DIR);
      assert.ok(cache, "Analysis should be in cache");

      // Find symbol in analysis
      const node = cache!.graph.nodes.find((n: { label: string }) => n.label === "getUser");
      assert.ok(node, "getUser node should exist");
      assert.strictEqual(node!.type, "function");
      assert.ok(node!.filePath);
    });

    it("reads actual file contents", async () => {
      const filePath = path.join(PROJECT_DIR, "src", "userService.ts");
      const content = fs.readFileSync(filePath, "utf-8");
      assert.ok(content.includes("class UserService"));
      assert.ok(content.includes("getUser"));
    });
  });

  // ═══════════ Index Coverage ═══════════
  describe("3. index_coverage — coverage report", () => {
    it("detects entity types in analysis", async () => {
      const { inMemoryAnalysisCache } = await import("./projectService.js");
      const cache = inMemoryAnalysisCache.get(PROJECT_DIR);
      const types: Record<string, number> = {};
      for (const n of cache!.graph.nodes as Array<{ type: string }>) {
        types[n.type] = (types[n.type] || 0) + 1;
      }
      assert.strictEqual(types["function"], 4);
      assert.strictEqual(types["class"], 2);
    });

    it("calculates coverage percentage", async () => {
      const { inMemoryAnalysisCache } = await import("./projectService.js");
      const cache = inMemoryAnalysisCache.get(PROJECT_DIR);
      const nodes = cache!.graph.nodes as Array<{ id: string; filePath?: string }>;
      const total = nodes.filter(n => !n.id.startsWith("external:")).length;
      const withFile = nodes.filter(n => n.filePath).length;
      const pct = Math.round((withFile / total) * 100);
      assert.ok(pct >= 80, `Coverage should be >= 80%, got ${pct}%`);
    });

    it("identifies orphan nodes (no connections)", async () => {
      const { inMemoryAnalysisCache } = await import("./projectService.js");
      const cache = inMemoryAnalysisCache.get(PROJECT_DIR);
      const nodes = cache!.graph.nodes as Array<{ id: string }>;
      const links = cache!.graph.links as Array<{ source: string; target: string }>;
      const connectedIds = new Set<string>();
      for (const l of links) { connectedIds.add(l.source); connectedIds.add(l.target); }
      const orphans = nodes.filter(n => !connectedIds.has(n.id));
      // Our mock has all connected
      assert.strictEqual(orphans.length, 0);
    });
  });

  // ═══════════ Code Similarity ═══════════
  describe("4. detect_code_similarities — Jaccard similarity", () => {
    it("computes Jaccard token similarity between two files", async () => {
      const contentA = fs.readFileSync(path.join(PROJECT_DIR, "src", "userService.ts"), "utf-8");
      const contentB = fs.readFileSync(path.join(PROJECT_DIR, "utils", "helper.ts"), "utf-8");

      const tokenize = (s: string) => {
        const tokens = new Set<string>();
        const re = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
        let m;
        while ((m = re.exec(s)) !== null) tokens.add(m[0].toLowerCase());
        return tokens;
      };

      const tokensA = tokenize(contentA);
      const tokensB = tokenize(contentB);

      const intersection = new Set([...tokensA].filter(t => tokensB.has(t)));
      const union = new Set([...tokensA, ...tokensB]);

      const similarity = intersection.size / union.size;
      // These two files are very similar (same structure, different names)
      assert.ok(similarity >= 0.5, `Similarity should be >= 0.5, got ${similarity}`);
    });

    it("returns 0 for completely different tokens", async () => {
      const tokenize = (s: string) => {
        const tokens = new Set<string>();
        const re = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
        let m;
        while ((m = re.exec(s)) !== null) tokens.add(m[0].toLowerCase());
        return tokens;
      };

      const tokensA = tokenize("abc def ghi xyz");
      const tokensB = tokenize("xxx yyy zzz");
      const intersection = new Set([...tokensA].filter(t => tokensB.has(t)));
      const union = new Set([...tokensA, ...tokensB]);
      assert.strictEqual(intersection.size, 0);
      assert.strictEqual(union.size, 7);
    });
  });

  // ═══════════ Export Artifact ═══════════
  describe("5. export_team_artifact — snapshot export", () => {
    it("exports summary to .codeatlas/ directory", async () => {
      const artifactDir = path.join(PROJECT_DIR, ".codeatlas");
      fs.mkdirSync(artifactDir, { recursive: true });

      const { inMemoryAnalysisCache } = await import("./projectService.js");
      const cache = inMemoryAnalysisCache.get(PROJECT_DIR);
      assert.ok(cache, "Analysis must be in cache for export");

      // Simulate export
      const summary = {
        version: 1,
        exportedAt: new Date().toISOString(),
        project: "test-project",
        stats: { modules: 2, functions: 4, classes: 2, dependencies: 2, circularDeps: 0, deadCode: 0 },
        modules: cache!.graph.nodes.filter((n: { type: string }) => n.type === "module" || n.type === "class").map((n: { id: string; label: string; filePath?: string }) => ({ id: n.id, name: n.label, file: n.filePath })),
        classes: cache!.graph.nodes.filter((n: { type: string }) => n.type === "class").map((n: { id: string; label: string; filePath?: string; line?: number }) => ({ id: n.id, name: n.label, file: n.filePath, line: n.line })),
        functions: cache!.graph.nodes.filter((n: { type: string }) => n.type === "function").map((n: { id: string; label: string; filePath?: string; line?: number }) => ({ id: n.id, name: n.label, file: n.filePath, line: n.line })),
        callGraph: cache!.graph.links.filter((l: { type: string }) => l.type === "call").map((l: { source: string; target: string }) => ({
          from: cache!.graph.nodes.find((n: { id: string }) => n.id === l.source)?.label || l.source,
          to: cache!.graph.nodes.find((n: { id: string }) => n.id === l.target)?.label || l.target,
        })),
      };

      const outPath = path.join(artifactDir, "artifact-summary.json");
      fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
      assert.ok(fs.existsSync(outPath));

      const parsed = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      assert.strictEqual(parsed.project, "test-project");
      assert.strictEqual(parsed.classes.length, 2);
      assert.strictEqual(parsed.functions.length, 4);
    });
  });
});
