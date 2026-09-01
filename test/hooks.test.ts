import { describe, it } from "node:test";
import * as assert from "node:assert";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOOKS_DIR = path.join(__dirname, "..", "src", "cli", "hooks");

function runHook(file: string, input: string, env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [file], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`hook exited ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

describe("bash hook scripts", () => {
  const scripts = ["brain-context.sh", "brain-save.sh", "task-router.sh"];

  for (const script of scripts) {
    it(`passes bash -n syntax check: ${script}`, () => {
      const file = path.join(HOOKS_DIR, script);
      const output = execFileSync("bash", ["-n", file], { encoding: "utf8" });
      assert.strictEqual(output, "");
    });
  }

  it("brain-context.sh emits nothing unless CODEATLAS_INJECT_BRAIN_CONTEXT=1", async () => {
    const file = path.join(HOOKS_DIR, "brain-context.sh");
    const output = await runHook(file, "", {
      PATH: process.env.PATH ?? "",
      CODEATLAS_INJECT_BRAIN_CONTEXT: "",
    });
    assert.strictEqual(output.stdout.trim(), "");
  });

  it("brain-context.sh outputs parser memory when enabled", async () => {
    const file = path.join(HOOKS_DIR, "brain-context.sh");
    const output = await runHook(file, JSON.stringify({ cwd: "/workspace/demo-project", project_name: "demo-project" }), {
      PATH: process.env.PATH ?? "",
      CODEATLAS_INJECT_BRAIN_CONTEXT: "1",
    });
    assert.ok(output.stdout.includes("Parser uses ESTree"));
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
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    try {
      const result = await runHook(file, JSON.stringify({ cwd: "/workspace/demo-project", session_id: "readonly-test", tool_name: "Read" }), {
        PATH: process.env.PATH ?? "",
        HOME: home,
        CODEATLAS_API_URL: `http://127.0.0.1:${address.port}`,
        CODEATLAS_API_KEY: "integration-test-key",
      });
      assert.strictEqual(calls, 0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("brain-save.sh exits silently without CODEATLAS_API_URL", async () => {
    const file = path.join(HOOKS_DIR, "brain-save.sh");
    const result = await runHook(file, JSON.stringify({ prompt: "noop", cwd: "/tmp/codeatlas" }), {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      CODEATLAS_API_KEY: "test-key",
    });
    assert.strictEqual(result.stdout.trim(), "");
  });

  it("brain-save.sh ingests current project session through HTTP", async () => {
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
    let requestBody: any = null;
    const server = http.createServer((request, response) => {
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        requestBody = JSON.parse(body);
        response.writeHead(200);
        response.end(JSON.stringify({ success: true, dreamsExtracted: 1 }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    try {
      const result = await runHook(file, JSON.stringify({ cwd: project, session_id: sessionId, tool_name: "Edit" }), {
        PATH: process.env.PATH ?? "",
        HOME: home,
        CODEATLAS_API_URL: `http://127.0.0.1:${address.port}`,
        CODEATLAS_API_KEY: "integration-test-key",
      });
      assert.strictEqual(result.stdout.trim(), "");
      assert.ok(requestBody !== null);
      assert.strictEqual(requestBody.dream.prompt, "Please remember this important project decision for future work.");
      assert.strictEqual(requestBody.dream.response, "I will record this project decision in CodeAtlas memory.");
      assert.strictEqual(requestBody.model, "test-model");
      assert.ok(requestBody.meta?.cwd?.endsWith("-workspace-demo-project"));
      assert.strictEqual(requestBody.meta?.sessionId, sessionId);
      assert.strictEqual(requestBody.meta?.toolName, "Edit");
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("task-router.sh - routes task with tool and description", async () => {
    const file = path.join(HOOKS_DIR, "task-router.sh");
    const output = await runHook(file, JSON.stringify({
      tool: "read_file",
      path: "/workspace/demo-project/src/main.ts",
      description: "Need to review the main entry point",
    }), {
      PATH: process.env.PATH ?? "",
      CODEATLAS_BASE_DIR: "/workspace",
    });
    const result = JSON.parse(output.stdout);
    assert.strictEqual(result.tool_name, "read_file");
    assert.deepStrictEqual(result.arguments, { path: "/workspace/demo-project/src/main.ts" });
    assert.strictEqual(result.description, "Need to review the main entry point");
  });

  it("task-router.sh - routes task without description", async () => {
    const file = path.join(HOOKS_DIR, "task-router.sh");
    const output = await runHook(file, JSON.stringify({
      tool: "grep",
      pattern: "TODO",
    }), {
      PATH: process.env.PATH ?? "",
      CODEATLAS_BASE_DIR: "/workspace",
    });
    const result = JSON.parse(output.stdout);
    assert.strictEqual(result.tool_name, "grep");
    assert.deepStrictEqual(result.arguments, { pattern: "TODO" });
    assert.strictEqual(result.description, undefined);
  });
});

    let requestBody: any = null;
    const server = http.createServer((request, response) => {
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        requestBody = JSON.parse(body);
        response.writeHead(200);
        response.end(JSON.stringify({ success: true, dreamsExtracted: 1 }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    try {
      const result = await runHook(file, JSON.stringify({ cwd: project, session_id: sessionId, tool_name: "Edit" }), {
        PATH: process.env.PATH ?? "",
        HOME: home,
        CODEATLAS_API_URL: `http://127.0.0.1:${address.port}`,
        CODEATLAS_API_KEY: "integration-test-key",
      });
      assert.strictEqual(result.stdout.trim(), "");
      assert.ok(requestBody !== null);
      assert.strictEqual(requestBody.dream.prompt, "Please remember this important project decision for future work.");
      assert.strictEqual(requestBody.dream.response, "I will record this project decision in CodeAtlas memory.");
      assert.strictEqual(requestBody.model, "test-model");
      assert.ok(requestBody.meta?.cwd?.endsWith("-workspace-demo-project"));
      assert.strictEqual(requestBody.meta?.sessionId, sessionId);
      assert.strictEqual(requestBody.meta?.toolName, "Edit");
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("task-router.sh - routes task with tool and description", async () => {
    const file = path.join(HOOKS_DIR, "task-router.sh");
    const output = await runHook(file, JSON.stringify({
      tool: "read_file",
      path: "/workspace/demo-project/src/main.ts",
      description: "Need to review the main entry point",
    }), {
      PATH: process.env.PATH ?? "",
      CODEATLAS_BASE_DIR: "/workspace",
    });
    const result = JSON.parse(output.stdout);
    assert.strictEqual(result.tool_name, "read_file");
    assert.deepStrictEqual(result.arguments, { path: "/workspace/demo-project/src/main.ts" });
    assert.strictEqual(result.description, "Need to review the main entry point");
  });

  it("task-router.sh - routes task without description", async () => {
    const file = path.join(HOOKS_DIR, "task-router.sh");
    const output = await runHook(file, JSON.stringify({
      tool: "grep",
      pattern: "TODO",
    }), {
      PATH: process.env.PATH ?? "",
      CODEATLAS_BASE_DIR: "/workspace",
    });
    const result = JSON.parse(output.stdout);
    assert.strictEqual(result.tool_name, "grep");
    assert.deepStrictEqual(result.arguments, { pattern: "TODO" });
    assert.strictEqual(result.description, undefined);
  });
});
