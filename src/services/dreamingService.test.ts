import { describe, it, mock, before, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";

let requestMock: ((options: any, callback: (res: any) => void) => any) | null;
let apiKeyMock: string | undefined;

function mockSuccessResponse(statusCode: number, body: unknown, capture?: { options?: any; written?: string }) {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return (options: any, callback: (res: any) => void) => {
    if (capture) capture.options = options;
    const mockRes: any = { statusCode, on(event: string, handler: (...args: any[]) => void) { if (event === "data") handler(bodyStr); if (event === "end") handler(); } };
    const mockReq: any = { _errorHandler: null as ((err: Error) => void) | null, on(event: string, handler: (...args: any[]) => void) { if (event === "error") mockReq._errorHandler = handler; return mockReq; }, write(data: any) { if (capture) capture.written = String(data); }, end() { callback(mockRes); } };
    return mockReq;
  };
}

function mockNetworkError(message: string) {
  return (_options: any, _callback: any) => {
    const mockReq: any = { _errorHandler: null as ((err: Error) => void) | null, on(event: string, handler: (...args: any[]) => void) { if (event === "error") mockReq._errorHandler = handler; return mockReq; }, write() {}, end() { setImmediate(() => { if (mockReq._errorHandler) mockReq._errorHandler(new Error(message)); }); } };
    return mockReq;
  };
}

describe("Dreaming Service - HTTPS Client", () => {
  let dreamingService: typeof import("./dreamingService.js");

  before(async () => {
    mock.module("https", {
      namedExports: {
        request(options: any, callback: (res: any) => void) {
          if (!requestMock) throw new Error("requestMock is not set - did you forget to assign it in a test?");
          return requestMock(options, callback);
        },
      },
    });

    mock.module("./projectService.js", {
      namedExports: { getResolvedApiKey() { return apiKeyMock; } },
    });

    dreamingService = await import("./dreamingService.js");
  });

  beforeEach(() => {
    apiKeyMock = "test-mock-key";
    requestMock = null;
    delete process.env.CODEATLAS_API_KEY;
  });

  afterEach(() => {
    apiKeyMock = undefined;
    requestMock = null;
  });

  // ----- saveDreamMemory -----
  describe("saveDreamMemory()", () => {
    it("returns success when API responds 200 with id", async () => {
      requestMock = mockSuccessResponse(200, { id: "dream-42" });
      const result = await dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" });
      assert.deepStrictEqual(result, { success: true, id: "dream-42" });
    });

    it("uses dreamId when id is absent", async () => {
      requestMock = mockSuccessResponse(200, { dreamId: "alt-99" });
      const result = await dreamingService.saveDreamMemory({ memory_type: "KNOWLEDGE", content: "test" });
      assert.deepStrictEqual(result, { success: true, id: "alt-99" });
    });

    it("falls back to unknown when no id in response", async () => {
      requestMock = mockSuccessResponse(200, { ok: true });
      const result = await dreamingService.saveDreamMemory({ memory_type: "PATTERN", content: "test" });
      assert.deepStrictEqual(result, { success: true, id: "unknown" });
    });

    it("throws on 4xx", async () => {
      requestMock = mockSuccessResponse(401, "Unauthorized");
      await assert.rejects(() => dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" }), { message: /Failed to save dream memory: status 401/ });
    });

    it("throws on 5xx", async () => {
      requestMock = mockSuccessResponse(500, "Error");
      await assert.rejects(() => dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" }), { message: /Failed to save dream memory: status 500/ });
    });

    it("throws on network error", async () => {
      requestMock = mockNetworkError("ECONNREFUSED");
      await assert.rejects(() => dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" }), { message: /Network Error: ECONNREFUSED/ });
    });

    it("throws when CODEATLAS_API_KEY is not set", async () => {
      apiKeyMock = undefined;
      await assert.rejects(() => dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" }), { message: /CODEATLAS_API_KEY is not set/ });
    });

    it("sends body fields", async () => {
      const capture: { options?: any; written?: string } = {};
      requestMock = mockSuccessResponse(200, { id: "x" }, capture);
      await dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test body", importance: 9, session_id: "s-1", project: "p" });
      const parsed = JSON.parse(capture.written!);
      assert.strictEqual(parsed.memory_type, "MISTAKE");
      assert.strictEqual(parsed.content, "test body");
      assert.strictEqual(parsed.importance, 9);
      assert.strictEqual(parsed.session_id, "s-1");
      assert.strictEqual(parsed.project, "p");
    });

    it("sends apiKey in x-api-key header only", async () => {
      process.env.CODEATLAS_API_KEY = "key-sentinel";
      const capture: { options?: any; written?: string } = {};
      requestMock = mockSuccessResponse(200, { id: "x" }, capture);
      await dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" });
      const opts = capture.options!;
      // API key is sent via x-api-key header, not query param
      assert.strictEqual(opts.headers["x-api-key"], "key-sentinel");
    });

    it("sends Chrome User-Agent", async () => {
      const capture: { options?: any } = {};
      requestMock = mockSuccessResponse(200, { id: "x" }, capture);
      await dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" });
      assert.ok(String(capture.options!.headers["User-Agent"]).includes("Chrome/125.0.0.0"));
    });
  });

  // ----- queryDreamMemories -----
  describe("queryDreamMemories()", () => {
    it("returns memories array from API", async () => {
      requestMock = mockSuccessResponse(200, { memories: [{ id: "m1", content: "a", memory_type: "MISTAKE", importance: 0.8, session_id: null, project: null, created_at: "2024-01-01T00:00:00Z", score: 0.95 }] });
      const memories = await dreamingService.queryDreamMemories({ query: "test" });
      assert.strictEqual(memories.length, 1);
      assert.strictEqual(memories[0].id, "m1");
      assert.strictEqual(memories[0].score, 0.95);
    });

    it("uses results when memories absent", async () => {
      requestMock = mockSuccessResponse(200, { results: [{ id: "r1", content: "x", memory_type: "PATTERN", importance: 0.5, session_id: null, project: null, created_at: "", score: 0.7 }] });
      const memories = await dreamingService.queryDreamMemories({ query: "x" });
      assert.strictEqual(memories.length, 1);
      assert.strictEqual(memories[0].id, "r1");
    });

    it("returns empty array for empty memories", async () => {
      requestMock = mockSuccessResponse(200, { memories: [] });
      const memories = await dreamingService.queryDreamMemories({ query: "x" });
      assert.deepStrictEqual(memories, []);
    });

    it("throws on invalid JSON", async () => {
      requestMock = mockSuccessResponse(200, "not-json");
      await assert.rejects(() => dreamingService.queryDreamMemories({ query: "x" }), { message: /Failed to parse/ });
    });

    it("throws on non-2xx", async () => {
      requestMock = mockSuccessResponse(403, "Forbidden");
      await assert.rejects(() => dreamingService.queryDreamMemories({ query: "x" }), { message: /Failed to query dream memories: status 403/ });
    });

    it("throws on network error", async () => {
      requestMock = mockNetworkError("ETIMEDOUT");
      await assert.rejects(() => dreamingService.queryDreamMemories({ query: "x" }), { message: /Network Error: ETIMEDOUT/ });
    });

    it("throws when CODEATLAS_API_KEY is not set", async () => {
      apiKeyMock = undefined;
      await assert.rejects(() => dreamingService.queryDreamMemories({ query: "x" }), { message: /CODEATLAS_API_KEY is not set/ });
    });

    it("sends query params", async () => {
      const capture: { options?: any } = {};
      requestMock = mockSuccessResponse(200, { memories: [] }, capture);
      await dreamingService.queryDreamMemories({ query: "search", limit: 5, project: "my-app" });
      const path = String(capture.options!.path);
      assert.ok(path.includes("query=search") && path.includes("limit=5") && path.includes("project=my-app"));
    });

    it("does NOT send limit when omitted", async () => {
      const capture: { options?: any } = {};
      requestMock = mockSuccessResponse(200, { memories: [] }, capture);
      await dreamingService.queryDreamMemories({ query: "search" });
      assert.ok(!String(capture.options!.path).includes("limit="));
    });

    it("includes apiKey in x-api-key header for GET", async () => {
      process.env.CODEATLAS_API_KEY = "test-key-query";
      const capture: { options?: any } = {};
      requestMock = mockSuccessResponse(200, { memories: [] }, capture);
      await dreamingService.queryDreamMemories({ query: "test" });
      const path = String(capture.options!.path);
      // API key is sent via x-api-key header, not query param
      assert.strictEqual(capture.options!.headers["x-api-key"], "test-key-query");
    });

    it("sends Chrome User-Agent for GET", async () => {
      const capture: { options?: any } = {};
      requestMock = mockSuccessResponse(200, { memories: [] }, capture);
      await dreamingService.queryDreamMemories({ query: "test" });
      assert.ok(String(capture.options!.headers["User-Agent"]).includes("Chrome/125.0.0.0"));
    });
  });
});
