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
      HOME: process.env.HOME ?? "",
      CODEATLAS_API_KEY: "test-key"
    });
    assert.strictEqual(output.stdout.trim(), "");
  });

  it("brain-context.sh emits nothing unless CODEATLAS_API_URL is set", async () => {
    const file = path.join(HOOKS_DIR, "brain-context.sh");
    const output = await runHook(file, "", {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      CODEATLAS_API_KEY: "test-key",
      CODEATLAS_INJECT_BRAIN_CONTEXT: "1"
    });
    assert.strictEqual(output.stdout.trim(), "");
  });

  it("brain-context.sh drops unrecognized memory types when enabled", async () => {
    const file = path.join(HOOKS_DIR, "brain-context.sh");
    const curlDir = path.resolve(__dirname, "fixtures", "hook-bin");
    const response = JSON.stringify({
      memories: [
        { memory_type: "KNOWLEDGE", content: "Parser uses ESTree." },
        { memory_type: "SHOPPING", content: "Buy milk." },
        { memory_type: "WEATHER", content: "Sunny tomorrow." },
      ],
    });
    const result = await runHook(file, JSON.stringify({ prompt: "fix parser", cwd: "/tmp/codeatlas" }), {
      PATH: `${curlDir}:${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? "",
      CODEATLAS_API_URL: "http://127.0.0.1:9",
      CODEATLAS_API_KEY: "test-key",
      CODEATLAS_INJECT_BRAIN_CONTEXT: "1",
      CODEATLAS_TEST_CURL_RESPONSE: response,
    });
    assert.match(result.stdout, /Parser uses ESTree/);
    assert.doesNotMatch(result.stdout, /Buy milk|Sunny tomorrow/);
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

    const requests: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];
    const server = http.createServer((request, response) => {
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        requests.push({ headers: request.headers, body: JSON.parse(body) });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ dreamsExtracted: 1 }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    try {
      const hookInput = JSON.stringify({ cwd: project, session_id: sessionId, tool_name: "Bash" });
      const env = {
        PATH: process.env.PATH ?? "",
        HOME: home,
        CODEATLAS_API_URL: `http://127.0.0.1:${address.port}`,
        CODEATLAS_API_KEY: "integration-test-key",
      };
      const result = await runHook(file, hookInput, env);
      assert.strictEqual(result.stdout.trim(), "");
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].headers["x-api-key"], "integration-test-key");
      assert.strictEqual(requests[0].body.session_id, sessionId);
      assert.strictEqual(requests[0].body.project, "demo_project");
      assert.match(requests[0].body.content, /important project decision/);
      assert.match(requests[0].body.content, /CodeAtlas memory/);

      const duplicate = await runHook(file, hookInput, env);
      assert.strictEqual(duplicate.stdout.trim(), "");
      assert.strictEqual(requests.length, 1);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(home, { recursive: true, force: true });
    }
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
      const result = spawnSync("bash", [file], {
        encoding: "utf8",
        input: JSON.stringify({ cwd: "/workspace/demo-project", session_id: "readonly-test", tool_name: "Read" }),
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          CODEATLAS_API_URL: `http://127.0.0.1:${address.port}`,
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
    assert.strictEqual(result.stdout, "");
  });
});
