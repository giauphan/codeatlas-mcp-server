import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  checkClaudeMcp,
  checkClaudeHooks,
  checkProjectDir,
  checkFeaturesDiff,
  detectActiveAgent,
  checkCodeatlasSetup,
  listProjectDirs,
  getHooksDoctorJson,
  cmdDoctor
} from "./commands.js";

describe("Doctor & Health Check diagnostics", () => {
  it("checkClaudeMcp returns a valid diagnostic status", () => {
    const res = checkClaudeMcp();
    assert.ok(["ok", "warn", "fail"].includes(res.status));
    assert.ok(typeof res.detail === "string");
  });

  it("checkClaudeHooks checks hook registration", () => {
    const res = checkClaudeHooks();
    assert.ok(["ok", "warn", "fail"].includes(res.status));
    assert.ok(Array.isArray(res.connected));
    assert.ok(Array.isArray(res.missing));
  });

  it("doctor hooks JSON reports wiring and presence without exposing credentials or prompts", () => {
    const oldUrl = process.env.CODEATLAS_API_URL;
    const oldKey = process.env.CODEATLAS_API_KEY;
    process.env.CODEATLAS_API_URL = "https://example.invalid/private-path";
    process.env.CODEATLAS_API_KEY = "synthetic-doctor-secret";
    try {
      const output = JSON.stringify(getHooksDoctorJson());
      assert.ok(output.includes('"url_present":true'));
      assert.ok(output.includes('"key_present":true'));
      assert.ok(output.includes('"project_identity"'));
      assert.ok(output.includes('"last_outcomes"'));
      assert.ok(!output.includes("synthetic-doctor-secret"));
      assert.ok(!output.includes("private-path"));
    } finally {
      if (oldUrl === undefined) delete process.env.CODEATLAS_API_URL; else process.env.CODEATLAS_API_URL = oldUrl;
      if (oldKey === undefined) delete process.env.CODEATLAS_API_KEY; else process.env.CODEATLAS_API_KEY = oldKey;
    }
  });

  it("aggregates recent redacted capture and bootstrap metrics for doctor output", () => {
    const oldHome = process.env.HOME;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-doctor-metrics-"));
    process.env.HOME = root;
    const dir = path.join(root, ".codeatlas");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "memory-pipeline-events.jsonl"), [
      { kind: "save", status: "acknowledged", reason: "tool_capture", capture_received: true, duration_ms: 15 },
      { kind: "load", status: "injected", reason: "context_available", bootstrap_attempt: true, injected: true, readable: true, duration_ms: 30 },
      { kind: "load", status: "empty", reason: "no_matching_context", bootstrap_attempt: true, duration_ms: 8 },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n");
    try {
      const output = getHooksDoctorJson() as { pipeline_metrics?: Record<string, number> };
      assert.deepStrictEqual(output.pipeline_metrics, { capture_received: 1, bootstrap_attempt: 2, injected: 1, readable: 1, observations: 3 });
    } finally {
      if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads a temporary .env before doctor captures API_URL and performs cloud checks", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-doctor-env-"));
    const home = path.join(root, "home");
    const cwd = path.join(root, "workspace");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    const seen: string[] = [];
    const server = http.createServer((request, response) => {
      seen.push(request.url ?? "");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(request.url?.startsWith("/api/version") ? { version: "fixture" } : { memories: [], genes: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    fs.writeFileSync(path.join(cwd, ".env"), `CODEATLAS_API_URL=http://127.0.0.1:${address.port}\nCODEATLAS_API_KEY=synthetic-doctor-key\n`);
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
      delete env.CODEATLAS_API_URL;
      delete env.CODEATLAS_API_KEY;
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(process.cwd(), "dist", "index.js"), "doctor"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = ""; let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
        child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("exit", (code) => resolve({ code, stdout, stderr }));
      });
      assert.equal(result.code, 0, result.stderr);
      assert.ok(seen.includes("/api/version"), `API_URL from .env was not used; requests=${JSON.stringify(seen)}`);
      assert.match(result.stdout, /Cloud Connection: http:\/\/127\.0\.0\.1:/);
      assert.doesNotMatch(result.stdout, /synthetic-doctor-key/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("checkProjectDir correctly detects project workspace and git properties", () => {
    const res = checkProjectDir(process.cwd());
    assert.ok(["ok", "warn"].includes(res.status));
    assert.ok(typeof res.projectDir === "string");
    assert.ok(typeof res.projectName === "string");
    assert.ok(typeof res.isGit === "boolean");
    assert.ok(typeof res.hasClaudeMd === "boolean");
  });

  it("checkFeaturesDiff lists active analyzers, ADRs, and client integrations", () => {
    const diff = checkFeaturesDiff();
    assert.ok(Array.isArray(diff.astParsers));
    assert.ok(diff.astParsers.includes("TypeScript"));
    assert.ok(typeof diff.adrCount === "number");
    assert.ok(Array.isArray(diff.connectedClients));
  });

  it("detectActiveAgent detects which AI via rule file / env", () => {
  const cwd = process.cwd();
  const res = detectActiveAgent(cwd);
  assert.ok(typeof res.label === "string" && res.label.length > 0);
  assert.ok(["claude", "codex", "agents", "gemini", "generic"].includes(res.kind));
  assert.ok(typeof res.rulePresent === "boolean");
});

it("checkCodeatlasSetup reports skills, rules, agents, and rule file", () => {
  const cwd = process.cwd();
  const s = checkCodeatlasSetup(cwd);
  assert.ok(typeof s.skills.count === "number");
  assert.ok(typeof s.skills.hasCodeatlas === "boolean");
  assert.ok(typeof s.rules.count === "number");
  assert.ok(typeof s.agents.count === "number");
  assert.ok(typeof s.ruleFile.present === "boolean");
  assert.ok(typeof s.ruleFile.agent === "string");
});

it("listProjectDirs splits connected vs new dirs", () => {
  const { connected, newDirs } = listProjectDirs();
  assert.ok(Array.isArray(connected));
  assert.ok(Array.isArray(newDirs));
  // cwd should always be connected (it's a git repo / has package.json)
  assert.ok(connected.length >= 1);
  for (const e of connected) {
    assert.ok(typeof e.dir === "string" && e.dir.length > 0);
    assert.ok(e.codeatlasSetup !== undefined);
  }
});

it("cmdDoctor executes without throwing errors", async () => {
    // Capture console output during cmdDoctor execution
    let output = "";
    const origLog = console.log;
    console.log = (...args: any[]) => {
      output += args.join(" ") + "\n";
    };
    try {
      await cmdDoctor();
      assert.ok(output.includes("CodeAtlas Second Brain — Health Check & Diagnostics"));
      assert.ok(output.includes("1. Project & Workspace"));
      assert.ok(output.includes("2. MCP Client Integrations"));
      assert.ok(output.includes("3. Hooks & Automation Status"));
      assert.ok(output.includes("Memory pipeline runtime: git="));
      assert.ok(output.includes("Built CLI:"));
      assert.ok(output.includes("PATH codeatlas:"));
      assert.ok(output.includes("4. Environment & Cloud Services"));
      assert.ok(output.includes("5. System Features & Difference Summary"));
    } finally {
      console.log = origLog;
    }
  });
});
