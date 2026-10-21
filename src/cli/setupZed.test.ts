import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { after, before, test, mock } from "node:test";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-zed-setup-"));
const originalEnv = { ...process.env };
const homeMock = mock.method(os, "homedir", () => tempRoot);
syncBuiltinESMExports();
const { cmdSetupZed } = await import("./setupClaude.js");

before(() => {
  process.env.CODEATLAS_API_URL = "https://api.codeatlas.ai";
  process.env.CODEATLAS_API_KEY = "fixture-key";
});

after(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  homeMock.mock.restore();
  syncBuiltinESMExports();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("Zed setup writes an explicit package binary and both configured cloud values", async () => {
  await cmdSetupZed();
  const settings = JSON.parse(fs.readFileSync(path.join(tempRoot, ".config", "zed", "settings.json"), "utf8"));
  const server = settings.context_servers["codeatlas-mcp-server"];
  assert.deepEqual(server.args, ["--yes", "--package=codeatlas-mcp-server", "codeatlas-mcp"]);
  assert.deepEqual(server.env, { CODEATLAS_API_URL: "https://api.codeatlas.ai", CODEATLAS_API_KEY: "fixture-key" });
});
