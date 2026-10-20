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

  it("brain-context.sh launches a configured JavaScript CLI with Node", () => {
    const file = path.join(HOOKS_DIR, "brain-context.sh");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-context-cli-"));
    const cli = path.join(home, "native-cli.js");
    const output = path.join(home, "received.json");
    fs.writeFileSync(cli, `require("node:fs").writeFileSync(process.env.CAPTURE_OUTPUT, JSON.stringify({ args: process.argv.slice(2) }));`);

    try {
      const result = spawnSync("bash", [file], {
        encoding: "utf8",
        input: "",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          CAPTURE_OUTPUT: output,
          CODEATLAS_CLI_PATH: cli,
          CODEATLAS_INJECT_BRAIN_CONTEXT: "1",
        },
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(output, "utf8")), { args: ["brain-context"] });
    } finally {
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

  it("brain-save.sh forwards hook input to the configured native CLI", () => {
    const file = path.join(HOOKS_DIR, "brain-save.sh");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-brain-save-"));
    const cli = path.join(home, "native-cli.js");
    const output = path.join(home, "received.json");
    fs.writeFileSync(cli, `process.stdin.setEncoding("utf8");let input="";process.stdin.on("data",x=>input+=x);process.stdin.on("end",()=>require("fs").writeFileSync(process.env.CAPTURE_OUTPUT,JSON.stringify({args:process.argv.slice(2),input})));`);

    try {
      const hookInput = JSON.stringify({ hook_event_name: "PostToolUse", session_id: "session-bridge", tool_name: "Bash", tool_response: { stdout: "OK" } });
      const result = spawnSync("bash", [file], {
        encoding: "utf8",
        input: hookInput,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          CODEATLAS_CLI_PATH: cli,
          CAPTURE_OUTPUT: output,
        },
      });
      
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout.trim(), "");
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(output, "utf8")), { args: ["hook", "brain-save"], input: hookInput });
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
