import { describe, it } from "node:test";
import * as assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOOKS_DIR = path.join(__dirname, "hooks");

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
    const output = execFileSync("bash", [file], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", CODEATLAS_API_KEY: "test-key" },
    });
    assert.strictEqual(output, "");
  });

  it("brain-context.sh emits nothing unless CODEATLAS_API_URL is set", () => {
    const file = path.join(HOOKS_DIR, "brain-context.sh");
    const output = execFileSync("bash", [file], {
      encoding: "utf8",
      input: JSON.stringify({ prompt: "fix parser", cwd: "/tmp/codeatlas" }),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        CODEATLAS_API_KEY: "test-key",
        CODEATLAS_INJECT_BRAIN_CONTEXT: "1",
      },
    });
    assert.strictEqual(output, "");
  });

  it("brain-context.sh drops unrecognized memory types when enabled", () => {
    const file = path.join(HOOKS_DIR, "brain-context.sh");
    const curlDir = path.resolve(__dirname, "fixtures/hook-bin");
    const response = JSON.stringify({
      memories: [
        { memory_type: "KNOWLEDGE", content: "Parser uses ESTree." },
        { memory_type: "SHOPPING", content: "Buy milk." },
        { memory_type: "WEATHER", content: "Sunny tomorrow." },
      ],
    });
    const result = spawnSync("bash", [file], {
      encoding: "utf8",
      input: JSON.stringify({ prompt: "fix parser", cwd: "/tmp/codeatlas" }),
      env: {
        PATH: `${curlDir}:${process.env.PATH ?? ""}`,
        HOME: process.env.HOME ?? "",
        CODEATLAS_API_URL: "http://127.0.0.1:9",
        CODEATLAS_API_KEY: "test-key",
        CODEATLAS_INJECT_BRAIN_CONTEXT: "1",
        CODEATLAS_TEST_CURL_RESPONSE: response,
      },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Parser uses ESTree/);
    assert.doesNotMatch(result.stdout, /Buy milk|Sunny tomorrow/);
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
