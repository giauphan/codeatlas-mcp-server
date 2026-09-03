import { describe, it } from "node:test";
import * as assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOOKS_DIR = path.join(__dirname, "..", "src", "cli", "hooks");

describe("bash hook scripts", () => {
  const scripts = ["brain-context.sh", "brain-save.sh", "task-router.sh"];

  for (const script of scripts) {
    it(`passes bash -n syntax check: ${script}`, () => {
      const file = path.join(HOOKS_DIR, script);
      const output = execFileSync("bash", ["-n", file], { encoding: "utf8" });
      assert.strictEqual(output, "");
    });
  }

  it("brain-context.sh emits nothing unless CODEATLAS_INJECT_BRAIN_CONTEXT=1", () => {
    const file = path.join(HOOKS_DIR, "brain-context.sh");
    const result = spawnSync("bash", [file], {
      encoding: "utf8",
      input: "",
      env: {
        PATH: process.env.PATH ?? "",
        CODEATLAS_INJECT_BRAIN_CONTEXT: "",
      },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout.trim(), "");
  });

  it("brain-context.sh outputs parser memory when enabled", () => {
    const file = path.join(HOOKS_DIR, "brain-context.sh");
    const result = spawnSync("bash", [file], {
      encoding: "utf8",
      input: "",
      env: {
        PATH: process.env.PATH ?? "",
        CODEATLAS_INJECT_BRAIN_CONTEXT: "1",
        CODEATLAS_TEST_MODE: "1",
      },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("Parser uses ESTree"));
  });

  it("brain-save.sh skips read-only tools without contacting API", async () => {
    const file = path.join(HOOKS_DIR, "brain-save.sh");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-brain-save-"));
    let calls = 0;
    const server = http.createServer((_request, response) => {
      calls++;
      response.end(JSON.stringify({ dreamsExtracted: 1 }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;
    try {
      const result = spawnSync("bash", [file], {
        encoding: "utf8",
        input: JSON.stringify({ cwd: "/workspace/demo-project", session_id: "readonly-test", tool_name: "Read" }),
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          CODEATLAS_API_URL: `http://127.0.0.1:${port}`,
          CODEATLAS_API_KEY: "integration-test-key",
        },
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(calls, 0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("brain-save.sh exits silently without CODEATLAS_API_URL", () => {
    const file = path.join(HOOKS_DIR, "brain-save.sh");
    const result = spawnSync("bash", [file], {
      encoding: "utf8",
      input: JSON.stringify({ prompt: "noop", cwd: "/tmp/codeatlas" }),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        CODEATLAS_API_KEY: "test-key",
      },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout.trim(), "");
  });

  it("brain-save.sh processes input in test mode", () => {
    const file = path.join(HOOKS_DIR, "brain-save.sh");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-brain-save-"));
    const project = "/workspace/demo-project";
    const projectFolder = path.join(home, ".claude", "projects", "-workspace-demo-project");
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sessionFile = path.join(projectFolder, `${sessionId}.jsonl`);
    fs.mkdirSync(projectFolder, { recursive: true });
    fs.writeFileSync(sessionFile, [
      JSON.stringify({ type: "user", sessionId, message: { role: "user", content: "Please remember this important project decision for future work." } }),
      JSON.stringify({ type: "assistant", sessionId, model: "test-model", message: { role: "assistant", content: "I will record this project decision in CodeAtlas memory." } }),
    ].join("\n") + "\n");

    try {
      // Test that brain-save.sh can process input in test mode without errors
      const result = spawnSync("bash", [file], {
        encoding: "utf8",
        input: JSON.stringify({ cwd: project, session_id: sessionId, tool_name: "Edit" }),
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          CODEATLAS_API_URL: "http://127.0.0.1:9999", // Fake URL for test mode
          CODEATLAS_API_KEY: "test-key",
          CODEATLAS_TEST_MODE: "1",
        },
      });
      
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout.trim(), "");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("task-router.sh - routes task with tool and description", () => {
    const file = path.join(HOOKS_DIR, "task-router.sh");
    const result = spawnSync("bash", [file], {
      encoding: "utf8",
      input: JSON.stringify({
        tool: "read_file",
        path: "/workspace/demo-project/src/main.ts",
        description: "Need to review the main entry point",
      }),
      env: {
        PATH: process.env.PATH ?? "",
        CODEATLAS_BASE_DIR: "/workspace",
      },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.tool_name, "read_file");
    assert.deepStrictEqual(output.arguments, { path: "/workspace/demo-project/src/main.ts" });
    assert.strictEqual(output.description, "Need to review the main entry point");
  });

  it("task-router.sh - routes task without description", () => {
    const file = path.join(HOOKS_DIR, "task-router.sh");
    const result = spawnSync("bash", [file], {
      encoding: "utf8",
      input: JSON.stringify({
        tool: "grep",
        pattern: "TODO",
      }),
      env: {
        PATH: process.env.PATH ?? "",
        CODEATLAS_BASE_DIR: "/workspace",
      },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.tool_name, "grep");
    assert.deepStrictEqual(output.arguments, { pattern: "TODO" });
    assert.strictEqual(output.description, undefined);
  });
});
