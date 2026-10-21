import { describe, it, before, after, mock, beforeEach } from "node:test";
import * as assert from "node:assert";

let httpCalls: any[] = [];
let httpsCalls: any[] = [];

mock.module("http", {
  namedExports: {
    request(options: any, callback: (res: any) => void) {
      httpCalls.push(options);
      const mockRes: any = { 
        statusCode: 200, 
        on(event: string, handler: any) { 
          if (event === "data") handler(JSON.stringify({ memories: [] })); 
          if (event === "end") handler(); 
        } 
      };
      const mockReq: any = { 
        on() { return mockReq; }, 
        write() {}, 
        end() { callback(mockRes); } 
      };
      return mockReq;
    }
  }
});

mock.module("https", {
  namedExports: {
    request(options: any, callback: (res: any) => void) {
      httpsCalls.push(options);
      const mockRes: any = { 
        statusCode: 200, 
        on(event: string, handler: any) { 
          if (event === "data") handler(JSON.stringify({ memories: [] })); 
          if (event === "end") handler(); 
        } 
      };
      const mockReq: any = { 
        on() { return mockReq; }, 
        write() {}, 
        end() { callback(mockRes); } 
      };
      return mockReq;
    }
  }
});

// Import dynamically after mock.module is registered
const { syncAnalysisToServer, getEpisodicMemoriesFromServer } = await import("./projectService.js");
const { saveDreamMemory, queryDreamMemories } = await import("./dreamingService.js");
const { isIndexingEnabledForProject } = await import("./watcherService.js");

describe("projectService network protocol selection", () => {
  let originalApiKey: string | undefined;
  let originalApiUrl: string | undefined;

  before(() => {
    originalApiKey = process.env.CODEATLAS_API_KEY;
    originalApiUrl = process.env.CODEATLAS_API_URL;
  });

  after(() => {
    process.env.CODEATLAS_API_KEY = originalApiKey;
    process.env.CODEATLAS_API_URL = originalApiUrl;
  });

  beforeEach(() => {
    process.env.CODEATLAS_API_KEY = "test-key";
    httpCalls = [];
    httpsCalls = [];
  });

  it("syncAnalysisToServer calls https.request for https://", async () => {
    process.env.CODEATLAS_API_URL = "https://api.codeatlas.ai";

    await syncAnalysisToServer("test-project", { data: 123 });
    
    assert.strictEqual(httpsCalls.length, 1, "Should have used https.request");
    assert.strictEqual(httpCalls.length, 0, "Should not have used http.request");
    assert.strictEqual(httpsCalls[0].port, 443);
  });

  it("syncAnalysisToServer calls http.request for http://", async () => {
    process.env.CODEATLAS_API_URL = "http://localhost:3381";

    await syncAnalysisToServer("test-project", { data: 123 });
    
    assert.strictEqual(httpCalls.length, 1, "Should have used http.request");
    assert.strictEqual(httpsCalls.length, 0, "Should not have used https.request");
    assert.strictEqual(httpCalls[0].port, "3381");
  });

  it("getEpisodicMemoriesFromServer calls http.request for http://", async () => {
    process.env.CODEATLAS_API_URL = "http://localhost:3381";

    await getEpisodicMemoriesFromServer("test-project");

    assert.strictEqual(httpCalls.length, 1, "Should have used http.request");
    assert.strictEqual(httpsCalls.length, 0, "Should not have used https.request");
  });

  it("getEpisodicMemoriesFromServer calls https.request for https://", async () => {
    process.env.CODEATLAS_API_URL = "https://api.codeatlas.ai";

    await getEpisodicMemoriesFromServer("test-project");

    assert.strictEqual(httpsCalls.length, 1, "Should have used https.request");
    assert.strictEqual(httpCalls.length, 0, "Should not have used http.request");
  });

  for (const [name, call] of [
    ["analysis sync", () => syncAnalysisToServer("test", {})],
    ["episodic memory", () => getEpisodicMemoriesFromServer("test")],
    ["dream save", () => saveDreamMemory({ memory_type: "KNOWLEDGE", content: "test" })],
    ["dream query", () => queryDreamMemories({ query: "test" })],
  ] as const) {
    it(`${name} rejects untrusted destinations before opening a connection`, async () => {
      const originalAllowCustom = process.env.CODEATLAS_ALLOW_CUSTOM_URL;
      delete process.env.CODEATLAS_ALLOW_CUSTOM_URL;
      process.env.CODEATLAS_API_URL = "https://untrusted.example";
      try {
        await assert.rejects(call, /Security Notice/);
        assert.strictEqual(httpCalls.length + httpsCalls.length, 0);
      } finally {
        if (originalAllowCustom === undefined) delete process.env.CODEATLAS_ALLOW_CUSTOM_URL;
        else process.env.CODEATLAS_ALLOW_CUSTOM_URL = originalAllowCustom;
      }
    });
  }

  it("watcher defaults to local indexing without leaking credentials to untrusted destinations", async () => {
    const originalAllowCustom = process.env.CODEATLAS_ALLOW_CUSTOM_URL;
    delete process.env.CODEATLAS_ALLOW_CUSTOM_URL;
    process.env.CODEATLAS_API_URL = "https://untrusted.example";
    try {
      assert.strictEqual(await isIndexingEnabledForProject("test"), true);
      assert.strictEqual(httpCalls.length + httpsCalls.length, 0);
    } finally {
      if (originalAllowCustom === undefined) delete process.env.CODEATLAS_ALLOW_CUSTOM_URL;
      else process.env.CODEATLAS_ALLOW_CUSTOM_URL = originalAllowCustom;
    }
  });

  it("watcher preserves HTTPS on custom ports", async () => {
    process.env.CODEATLAS_API_URL = "https://api.codeatlas.ai:8443";
    await isIndexingEnabledForProject("test");
    assert.strictEqual(httpsCalls.length, 1);
    assert.strictEqual(httpCalls.length, 0);
  });
});
