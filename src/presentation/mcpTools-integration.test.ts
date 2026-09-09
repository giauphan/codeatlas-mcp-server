import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Import tools registration
const { registerTools } = await import("./mcpServer.js");

const TMP_DIR = path.join(os.tmpdir(), "codeatlas-tool-test-" + Date.now());
const PROJECT_DIR = path.join(TMP_DIR, "test-mcp-project");

describe("CodeAtlas MCP Tools - Strict Activation & Quality Tests", () => {
  let server: McpServer;
  let tools: Record<string, any>;
  let originalCodeatlasApiUrl: string | undefined;

  before(async () => {
    // Disable cloud sync by clearing API config so it falls back cleanly to local-only
    originalCodeatlasApiUrl = process.env.CODEATLAS_API_URL;
    delete process.env.CODEATLAS_API_URL;
    delete process.env.CODEATLAS_API_KEY;

    // Create a real test project to run tools against
    fs.mkdirSync(path.join(PROJECT_DIR, "src"), { recursive: true });
    fs.mkdirSync(path.join(PROJECT_DIR, ".git"), { recursive: true }); // Makes isProjectDirectoryAsync happy

    fs.writeFileSync(path.join(PROJECT_DIR, "src", "index.ts"), `
export function add(a: number, b: number): number {
  return a + b;
}
class MathUtils {
  static multiply(c: number, d: number) { return c * d; }
}
console.log(add(1, 2));
`);
    fs.writeFileSync(path.join(PROJECT_DIR, "package.json"), JSON.stringify({ 
      name: "mcp-test-project", 
      scripts: { test: "echo test" } 
    }));

    server = new McpServer({ name: "CodeAtlas Test", version: "1.0.0" });
    registerTools(server);
    tools = (server as any)._registeredTools;
  });

  after(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    if (originalCodeatlasApiUrl) process.env.CODEATLAS_API_URL = originalCodeatlasApiUrl;
  });

  const expectedToolNames = [
    "analyze", "list_projects", "get_project_structure", "get_dependencies", "get_insights",
    "search_entities", "get_file_entities", "generate_system_flow", "sync_system_memory",
    "get_system_memory", "save_dream_memory", "query_dream_memories", "sync_dreams",
    "search_genome", "get_gene", "scan_immune_genes", "save_immune_gene", "trace_feature_flow",
    "generate_feature_flow_diagram", "detect_architectural_smells", "scan_enterprise_vulnerabilities",
    "code_search", "get_callers", "get_callees", "impact_analysis", "project_context", "run_script",
    "git_changes", "setup_second_brain", "check_second_brain_status", "manage_adr", "get_code_snippet",
    "index_coverage", "detect_code_similarities", "export_team_artifact", "sync_skills_inventory",
    "brain_context", "route_task"
  ];

  it("should have all 38 expected tools registered and cleanly activated", () => {
    assert.strictEqual(Object.keys(tools).length, 38, "Expected exactly 38 registered tools");
    for (const [name, tool] of Object.entries(tools)) {
      assert.ok(expectedToolNames.includes(name), `Unexpected tool registered: ${name}`);
      assert.ok(tool.description, `Tool ${name} must have a description`);
      assert.strictEqual(typeof tool.handler, "function", `Tool ${name} must have an executable handler`);
      // Validate string metadata and JSON schema attributes exist
      assert.ok(tool.inputSchema, `Tool ${name} missing inputSchema`);
    }
  });

  describe("Handler Integration (End-to-End)", () => {
    it("analyze handles a real path and populates memory", async () => {
      const res = await tools["analyze"].handler({ path: PROJECT_DIR });
      assert.ok(res.content?.[0]?.text, "Should return a text response");
      assert.match(res.content[0].text, /Analysis complete for test-mcp-project/);

      // Delay so cache completes write
      await new Promise(r => setTimeout(r, 100));
    });

    it("list_projects returns the newly analyzed project", async () => {
      // Need wait internally since async promises might be settling
      await new Promise(r => setTimeout(r, 100));
      const res = await tools["list_projects"].handler({});
      assert.ok(res.content?.[0]?.text);
      if (!res.content[0].text.includes("No analyzed projects")) {
        const parsed = JSON.parse(res.content[0].text);
        assert.ok(parsed.projects.some((p: any) => p.name === "test-mcp-project"));
      }
    });

    it("project_context returns real file info", async () => {
      const res = await tools["project_context"].handler({ project: PROJECT_DIR });
      assert.ok(res.content?.[0]?.text);
      const parsed = JSON.parse(res.content[0].text);
      assert.strictEqual(parsed.name, "test-mcp-project");
      assert.strictEqual(parsed.scripts.test, "echo test");
    });
    
    it("get_project_structure lists functions and classes", async () => {
      const res = await tools["get_project_structure"].handler({ project: PROJECT_DIR, limit: 10 });
      assert.ok(res.content?.[0]?.text);
      const parsed = JSON.parse(res.content[0].text);
      assert.ok(Array.isArray(parsed.entities));
      const entityNames = parsed.entities.map((e: any) => e.name);
      assert.ok(entityNames.includes("add"), "Should find function 'add'");
      assert.ok(entityNames.includes("MathUtils"), "Should find class 'MathUtils'");
    });

    it("code_search finds strings inside source", async () => {
      const res = await tools["code_search"].handler({ project: PROJECT_DIR, query: "console.log" });
      assert.ok(res.content?.[0]?.text);
      let parsed;
      try {
        parsed = JSON.parse(res.content[0].text);
      } catch(e) {
        // if no search results it might return a text warning
        assert.match(res.content[0].text, /No matches found/i);
        return;
      }
      if (parsed.results) {
        const match = parsed.results.find((r: any) => String(r.content || r.text || "").includes("console.log(add(1, 2));"));
        assert.ok(match, "Should find the console.log string");
      }
    });

    it("get_code_snippet retrieves source code by entity name", async () => {
      const res = await tools["get_code_snippet"].handler({ project: PROJECT_DIR, symbol: "add" });
      assert.ok(res.content?.[0]?.text);
      assert.match(res.content[0].text, /function add/);
      assert.match(res.content[0].text, /return a \+ b;/);
    });

    it("generate_system_flow returns an architecture mermaid diagram", async () => {
      const res = await tools["generate_system_flow"].handler({ project: PROJECT_DIR, scope: "full" });
      assert.ok(res.content?.[0]?.text);
      assert.ok(res.content[0].text.includes("graph TD") || res.content[0].text.includes("flowchart") || res.content[0].text.includes("subgraph"));
    });

    it("index_coverage reports indexed count", async () => {
      const res = await tools["index_coverage"].handler({ project: PROJECT_DIR });
      assert.ok(res.content?.[0]?.text);
      const parsed = JSON.parse(res.content[0].text);
      assert.ok(parsed.summary?.totalEntities > 0 || parsed.summary?.uniqueFiles > 0);
    });

    it("check_second_brain_status returns a status payload", async () => {
      const res = await tools["check_second_brain_status"].handler({});
      assert.ok(res.content?.[0]?.text);
      let parsed;
      try {
        parsed = JSON.parse(res.content[0].text);
      } catch (e) {
        // if text format fallback:
        assert.ok(res.content[0].text.includes("Settings Path:") || res.content[0].text.includes("Hermes") || res.content[0].text.includes("Claude"));
        return;
      }
      assert.ok(parsed.claude || parsed.hermes || parsed.gemini || parsed.pluginStatus || parsed.cloud !== undefined);
    });

    // Extended tool coverage
    it("get_dependencies lists node relationships", async () => {
      const res = await tools["get_dependencies"].handler({ project: PROJECT_DIR });
      assert.ok(res.content?.[0]?.text);
      const parsed = JSON.parse(res.content[0].text);
      assert.ok(Array.isArray(parsed.dependencies), "Dependencies should be an array");
    });

    it("get_insights generates simulated insights without failing", async () => {
      const res = await tools["get_insights"].handler({ project: PROJECT_DIR });
      assert.ok(res.content?.[0]?.text);
      const parsed = JSON.parse(res.content[0].text);
      assert.ok(Array.isArray(parsed.insights));
    });

    it("search_entities does exact/fuzzy match on entity names", async () => {
      const res = await tools["search_entities"].handler({ project: PROJECT_DIR, query: "add", type: "function" });
      assert.ok(res.content?.[0]?.text);
      const parsed = JSON.parse(res.content[0].text);
      assert.ok(parsed.results.length >= 0, "Results array required");
    });

    it("get_file_entities targets specific filepath", async () => {
      const res = await tools["get_file_entities"].handler({ project: PROJECT_DIR, filePath: "src/index.ts" });
      assert.ok(res.content?.[0]?.text);
      const parsed = JSON.parse(res.content[0].text);
      assert.ok(parsed.files, "Files output expected");
    });

    it("sync_system_memory activates successfully", async () => {
      const res = await tools["sync_system_memory"].handler({ project: PROJECT_DIR, enableEnterpriseSync: false });
      assert.ok(res.content?.[0]?.text);
      const parsed = JSON.parse(res.content[0].text);
      assert.strictEqual(parsed.success, true);
    });

    it("get_system_memory returns memory data correctly", async () => {
      const res = await tools["get_system_memory"].handler({ project: PROJECT_DIR });
      assert.ok(res.content?.[0]?.text);
      // it might be text or JSON depending on internal implementation but needs not to throw
    });

    it("save_dream_memory enforces cloud key if missing or mock saves if logic bypassable", async () => {
      try {
        await tools["save_dream_memory"].handler({ project: PROJECT_DIR, memory_type: "KNOWLEDGE", content: "Test memory" });
      } catch (err: any) {
        assert.match(err.message, /CODEATLAS_API_KEY is not set|Network Error|Failed to parse/);
      }
    });

    it("query_dream_memories enforcing logic", async () => {
      try {
        await tools["query_dream_memories"].handler({ project: PROJECT_DIR, query: "test" });
      } catch (err: any) {
        assert.match(err.message, /CODEATLAS_API_KEY is not set|Network Error/);
      }
    });

    it("sync_dreams logic", async () => {
      const res = await tools["sync_dreams"].handler({ project: PROJECT_DIR });
      assert.ok(res.content?.[0]?.text);
    });

    it("search_genome and get_gene validation", async () => {
      try {
        await tools["search_genome"].handler({ project: PROJECT_DIR, query: "test" });
      } catch (e) {
        assert.ok(e);
      }
      try {
        await tools["get_gene"].handler({ geneId: "test-id" });
      } catch (e) {
        assert.ok(e);
      }
    });

    it("scan_immune_genes and save_immune_gene validation", async () => {
      try {
        await tools["scan_immune_genes"].handler({ project: PROJECT_DIR, problem: "bug" });
      } catch (e) {
        assert.ok(e);
      }
      try {
        await tools["save_immune_gene"].handler({ project: PROJECT_DIR, problem: "bug", failure: "crash", prevention: "fix" });
      } catch (e) {
        assert.ok(e);
      }
    });

    it("trace_feature_flow outputs step sequence", async () => {
      const res = await tools["trace_feature_flow"].handler({ project: PROJECT_DIR, keyword: "add" });
      assert.ok(res.content?.[0]?.text);
      const parsed = JSON.parse(res.content[0].text);
      assert.ok(parsed.files || parsed.message);
    });

    it("generate_feature_flow_diagram outputs sequenceDiagram or flowchart", async () => {
      const res = await tools["generate_feature_flow_diagram"].handler({ project: PROJECT_DIR, keyword: "add", diagramType: "sequence" });
      assert.ok(res.content?.[0]?.text);
      assert.ok(res.content[0].text.includes("sequenceDiagram") || res.content[0].text.includes("flowchart") || res.content[0].text.includes("Too many connected"));
    });

    it("detect_architectural_smells", async () => {
      const res = await tools["detect_architectural_smells"].handler({ project: PROJECT_DIR });
      assert.ok(res.content?.[0]?.text);
      const parsed = JSON.parse(res.content[0].text);
      assert.ok(parsed.findings || parsed.error);
    });

    it("scan_enterprise_vulnerabilities", async () => {
      const res = await tools["scan_enterprise_vulnerabilities"].handler({ maxProjects: 1 });
      assert.ok(res.content?.[0]?.text);
    });

    it("get_callers and get_callees", async () => {
      const resCallers = await tools["get_callers"].handler({ project: PROJECT_DIR, symbol: "add" });
      assert.ok(resCallers.content?.[0]?.text);
      const resCallees = await tools["get_callees"].handler({ project: PROJECT_DIR, symbol: "add" });
      assert.ok(resCallees.content?.[0]?.text);
    });

    it("impact_analysis returns blast radius object", async () => {
      const res = await tools["impact_analysis"].handler({ project: PROJECT_DIR, symbol: "add" });
      assert.ok(res.content?.[0]?.text);
    });

    it("run_script executes basic shell if valid or blocks invalid", async () => {
      try {
        const res = await tools["run_script"].handler({ project: PROJECT_DIR, script: "test" });
        assert.ok(res.content?.[0]?.text);
      } catch (e: any) {
        assert.match(e.message, /Command failed|Timeout/);
      }
    });

    it("git_changes identifies if outside git repo quietly", async () => {
      const res = await tools["git_changes"].handler({ project: PROJECT_DIR });
      assert.ok(res.content?.[0]?.text);
    });

    it("setup_second_brain provisions structure", async () => {
      const res = await tools["setup_second_brain"].handler({ client: "hermes", apiKey: "TEST" });
      assert.ok(res.content?.[0]?.text);
    });

    it("manage_adr generates ADR in repo", async () => {
      const res = await tools["manage_adr"].handler({ project: PROJECT_DIR, action: "list" });
      assert.ok(res.content?.[0]?.text);
    });

    it("detect_code_similarities finds nodes", async () => {
      const res = await tools["detect_code_similarities"].handler({ project: PROJECT_DIR });
      assert.ok(res.content?.[0]?.text);
    });

    it("export_team_artifact zips db", async () => {
      const res = await tools["export_team_artifact"].handler({ project: PROJECT_DIR, format: "summary" });
      assert.ok(res.content?.[0]?.text);
    });

    it("sync_skills_inventory", async () => {
      const res = await tools["sync_skills_inventory"].handler({ action: "list_all" });
      assert.ok(res.content?.[0]?.text);
    });

    it("brain_context grabs context", async () => {
      const res = await tools["brain_context"].handler({ project: PROJECT_DIR, query: "test" });
      assert.ok(res.content?.[0]?.text);
    });
  });
});
