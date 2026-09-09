import { describe, it } from "node:test";
import * as assert from "node:assert";
import {
  checkClaudeMcp,
  checkClaudeHooks,
  checkProjectDir,
  checkFeaturesDiff,
  detectActiveAgent,
  checkCodeatlasSetup,
  listProjectDirs,
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
      assert.ok(output.includes("4. Environment & Cloud Services"));
      assert.ok(output.includes("5. System Features & Difference Summary"));
    } finally {
      console.log = origLog;
    }
  });
});
