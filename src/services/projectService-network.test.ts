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
    process.env.CODEATLAS_API_URL = "https://api.codeatlas.dev";

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
    process.env.CODEATLAS_API_URL = "https://api.codeatlas.dev";

    await getEpisodicMemoriesFromServer("test-project");

    assert.strictEqual(httpsCalls.length, 1, "Should have used https.request");
    assert.strictEqual(httpCalls.length, 0, "Should not have used http.request");
  });
});
