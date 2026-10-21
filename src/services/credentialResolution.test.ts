import { before, after, beforeEach, describe, it, mock } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import os from "node:os";
import * as path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-credentials-"));
const originalEnv = { ...process.env };
delete process.env.CODEATLAS_API_URL;
const homeMock = mock.method(os, "homedir", () => fixtureDir);
syncBuiltinESMExports();
const { registerTools } = await import("../presentation/mcpServer.js");
const { cloudFetch, checkFeaturesDiff } = await import("../cli/commands.js");
const { loadBrainContext } = await import("./brainContext.js");

describe("configuration credential fallback", () => {
  const received: Array<{ url: string; key: string | string[] | undefined }> = [];
  const server = http.createServer((req, res) => {
    received.push({ url: req.url!, key: req.headers["x-api-key"] });
    if (req.url?.endsWith("/redirect")) {
      res.writeHead(302, { Location: "/redirect-target" });
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ genes: [{ name: "Parser", description: "ESTree" }], context: "Use parameterized queries", memories: [] }));
  });
  const mcp = new McpServer({ name: "credential-test", version: "1.0.0" });
  registerTools(mcp);
  const tools = (mcp as any)._registeredTools;
  let baseUrl: string;

  before(async () => {
    fs.mkdirSync(path.join(fixtureDir, ".cursor"));
    fs.writeFileSync(path.join(fixtureDir, ".cursor", "mcp.json"), JSON.stringify({
      mcpServers: { codeatlas: { env: { CODEATLAS_API_KEY: "ca_config_fallback" } } },
    }));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  beforeEach(() => {
    delete process.env.CODEATLAS_API_KEY;
    delete process.env.CODEATLAS_ALLOW_CUSTOM_URL;
    delete process.env.CODEATLAS_MULTI_TENANT;
    process.env.CODEATLAS_API_URL = baseUrl;
    received.length = 0;
  });

  after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    homeMock.mock.restore();
    syncBuiltinESMExports();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  for (const [name, input] of [
    ["search_genome", { query: "parser" }],
    ["get_gene", { geneId: "parser" }],
    ["scan_immune_genes", { problem: "injection" }],
    ["save_immune_gene", { problem: "injection", failure: "query", prevention: "parameters" }],
  ] as const) {
    it(`${name} authenticates with the configured fallback key`, async () => {
      const result = await tools[name].handler(input);
      assert.equal(result.isError, undefined, result.content[0].text);
      assert.equal(received.length, 1);
      assert.equal(received[0].key, "ca_config_fallback");
    });
  }

  it("brain context retrieves genome and immune results with the fallback key", async () => {
    const result = await loadBrainContext({ query: "parser" });
    assert.deepEqual(result.genes, [{ name: "Parser", description: "ESTree" }]);
    assert.equal(result.immune, "Use parameterized queries");
    assert.equal(received.length, 3);
    assert.ok(received.every(request => request.key === "ca_config_fallback"));
  });

  it("CLI cloud requests authenticate with the fallback key", async () => {
    const result = await cloudFetch("GET", "/health");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(received[0].key, "ca_config_fallback");
    assert.equal(checkFeaturesDiff().cloudSync, true);
  });

  it("explicit environment keys take precedence and rotate without a prefix requirement", async () => {
    for (const key of ["api_key_123", "rotated-key-456"]) {
      process.env.CODEATLAS_API_KEY = key;
      assert.equal((await cloudFetch("GET", "/health")).ok, true);
      assert.equal(received.at(-1)!.key, key);
    }
  });

  it("status reports the fallback key and uses it for the connectivity check", async () => {
    const result = await tools.check_second_brain_status.handler({});
    const status = JSON.parse(result.content[0].text);
    assert.equal(status.apiKey, "set");
    assert.equal(status.cloud, "reachable");
    assert.equal(received[0].key, "ca_config_fallback");
  });

  it("setup accepts a fallback key without persisting it in generated config", async () => {
    const result = await tools.setup_second_brain.handler({ client: "claude", autoPlugin: false });
    assert.equal(JSON.parse(result.content[0].text).success, true);
    const config = fs.readFileSync(path.join(fixtureDir, ".claude", "claude.json"), "utf8");
    assert.ok(!config.includes("ca_config_fallback"));
  });

  it("CLI rejects untrusted destinations before sending credentials", async () => {
    process.env.CODEATLAS_API_URL = "https://untrusted.example";
    const result = await cloudFetch("GET", "/health");
    assert.equal(result.ok, false);
    assert.match(result.data.error, /Security Notice/);
    assert.equal(received.length, 0);
  });

  it("status rejects an untrusted destination before attempting a fetch", async () => {
    process.env.CODEATLAS_API_URL = "https://untrusted.example";
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("{}", { status: 200 }); };
    try {
      const result = await tools.check_second_brain_status.handler({});
      assert.equal(JSON.parse(result.content[0].text).cloud, "unreachable");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("CLI does not forward credentials through endpoint redirects", async () => {
    const result = await cloudFetch("GET", "/redirect");
    assert.equal(result.ok, false);
    assert.equal(received.length, 1);
    assert.equal(received[0].url, "/redirect");
  });

  it("MCP requests do not forward credentials through endpoint redirects", async () => {
    const result = await tools.get_gene.handler({ geneId: "redirect" });
    assert.equal(result.isError, true);
    assert.equal(received.length, 1);
    assert.equal(received[0].url, "/api/genome/gene/redirect");
  });
});
