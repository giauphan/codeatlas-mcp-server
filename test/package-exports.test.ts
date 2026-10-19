import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));

describe("package root exports", () => {
  it("resolves and executes the package root as ESM", () => {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", 'await import("codeatlas-mcp-server")', "--", "--version"],
      {
        cwd: packageRoot,
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout.trim(), packageJson.version);
    assert.ok(!result.stderr.includes("CodeAtlas MCP server running on stdio"));
  });
});
