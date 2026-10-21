import { before, after, beforeEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as http from "node:http";
import { syncAnalysisToServer, getEpisodicMemoriesFromServer } from "./projectService.js";
import { saveDreamMemory, queryDreamMemories } from "./dreamingService.js";
import { isIndexingEnabledForProject } from "./watcherService.js";

describe("IPv6 loopback service requests", () => {
  const originalEnv = { ...process.env };
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    assert.equal(req.headers["x-api-key"], "test-ipv6-key");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: "ipv6", memories: [], indexingEnabled: false }));
  });
  before(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "::1", resolve);
    });
    process.env.CODEATLAS_API_URL = `http://[::1]:${(server.address() as any).port}`;
    process.env.CODEATLAS_API_KEY = "test-ipv6-key";
  });
  beforeEach(() => { requests = 0; });
  after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  for (const [name, call] of [
    ["analysis sync", () => syncAnalysisToServer("test", {})],
    ["episodic memory", () => getEpisodicMemoriesFromServer("test")],
    ["dream save", () => saveDreamMemory({ memory_type: "KNOWLEDGE", content: "test" })],
    ["dream query", () => queryDreamMemories({ query: "test" })],
    ["watcher settings", () => isIndexingEnabledForProject("test")],
  ] as const) {
    it(`${name} reaches a real IPv6 loopback server`, async () => {
      await call();
      assert.equal(requests, 1);
    });
  }
});
