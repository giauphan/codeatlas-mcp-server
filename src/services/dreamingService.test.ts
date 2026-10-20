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
    process.env.CODEATLAS_API_URL = "https://127.0.0.1:9";
  });

  afterEach(() => {
    apiKeyMock = undefined;
    requestMock = null;
    delete process.env.CODEATLAS_API_URL;
  });

  // ----- saveDreamMemory -----
  describe("saveDreamMemory()", () => {
    it("returns success when API responds 200 with id", async () => {
      requestMock = mockSuccessResponse(200, { success: true, id: "dream-42" });
      const result = await dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" });
      assert.deepStrictEqual(result, { success: true, status: "stored", persisted: true, id: "dream-42", memory_id: "dream-42" });
    });

    it("uses dreamId when id is absent", async () => {
      requestMock = mockSuccessResponse(200, { success: true, dreamId: "alt-99" });
      const result = await dreamingService.saveDreamMemory({ memory_type: "KNOWLEDGE", content: "test" });
      assert.deepStrictEqual(result, { success: true, status: "stored", persisted: true, id: "alt-99", memory_id: "alt-99" });
    });

    it("rejects a successful HTTP response without an actual persisted ID", async () => {
      requestMock = mockSuccessResponse(200, { ok: true });
      await assert.rejects(() => dreamingService.saveDreamMemory({ memory_type: "PATTERN", content: "test" }), /invalid save acknowledgment/i);
    });

    it("rejects malformed JSON in a successful save-memory response", async () => {
      requestMock = mockSuccessResponse(200, "not-json");
      await assert.rejects(() => dreamingService.saveDreamMemory({ memory_type: "KNOWLEDGE", content: "test" }), /Invalid save acknowledgment: response was not valid JSON/);
    });

    it("returns filtered status without fabricating a persisted ID", async () => {
      requestMock = mockSuccessResponse(200, { status: "filtered", persisted: false });
      const result = await dreamingService.saveDreamMemory({ memory_type: "PATTERN", content: "noise" });
      assert.deepStrictEqual(result, { success: true, status: "filtered", persisted: false });
    });

    it("rejects backend success false even on HTTP 200", async () => {
      requestMock = mockSuccessResponse(200, { success: false, error: "rejected" });
      const result = await dreamingService.saveDreamMemory({ memory_type: "PATTERN", content: "test" });
      assert.deepStrictEqual(result, { success: false, status: "rejected", persisted: false });
    });

    it("rejects contradictory typed stored acknowledgments and sentinels", async () => {
      requestMock = mockSuccessResponse(200, { success: false, status: "stored", persisted: true, memory_id: "real-id" });
      await assert.rejects(() => dreamingService.saveDreamMemory({ memory_type: "PATTERN", content: "test" }), /Invalid save acknowledgment/);
      requestMock = mockSuccessResponse(200, { status: "stored", persisted: true, memory_id: "__noise_blocked__" });
      await assert.rejects(() => dreamingService.saveDreamMemory({ memory_type: "PATTERN", content: "test" }), /Invalid save acknowledgment/);
    });

    it("retries a transient response using a stable idempotency key", async () => {
      const calls: any[] = [];
      let attempts = 0;
      requestMock = (options, callback) => {
        calls.push(options);
        attempts++;
        return mockSuccessResponse(attempts === 1 ? 503 : 200, attempts === 1 ? { error: "retry" } : { status: "stored", persisted: true, memory_id: "dream-9" })(options, callback);
      };
      const result = await dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test", idempotency_key: "event-9" });
      assert.equal(result.memory_id, "dream-9");
      assert.equal(calls.length, 2);
      assert.equal(calls[0].headers["Idempotency-Key"], "event-9");
      assert.equal(calls[1].headers["Idempotency-Key"], "event-9");
    });

    it("retries an ambiguous network failure only with an idempotency key", async () => {
      let attempts = 0;
      requestMock = (options, callback) => {
        attempts++;
        if (attempts === 1) return mockNetworkError("ETIMEDOUT")(options, callback);
        return mockSuccessResponse(200, { status: "stored", persisted: true, memory_id: "dream-10" })(options, callback);
      };
      const result = await dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test", idempotency_key: "event-10" });
      assert.equal(result.memory_id, "dream-10");
      assert.equal(attempts, 2);
    });

    it("does not retry transient failures without an idempotency key", async () => {
      let attempts = 0;
      requestMock = (options, callback) => {
        attempts++;
        return mockSuccessResponse(503, { error: "retry" })(options, callback);
      };
      await assert.rejects(() => dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" }), /status 503/);
      assert.equal(attempts, 1);
    });

    it("applies a finite request timeout", async () => {
      const originalTimeout = process.env.CODEATLAS_API_TIMEOUT_MS;
      process.env.CODEATLAS_API_TIMEOUT_MS = "100";
      requestMock = (options, callback) => {
        const responseHandlers: Record<string, (...args: any[]) => void> = {};
        let dripTimer: NodeJS.Timeout | undefined;
        const mockRes: any = {
          statusCode: 200,
          on(event: string, handler: (...args: any[]) => void) { responseHandlers[event] = handler; return mockRes; },
        };
        const mockReq: any = {
          _errorHandler: null as ((error: Error) => void) | null,
          on(event: string, handler: (...args: any[]) => void) { if (event === "error") mockReq._errorHandler = handler as (error: Error) => void; return mockReq; },
          write() {},
          end() {
            callback(mockRes);
            dripTimer = setInterval(() => responseHandlers.data?.("slow"), 25);
          },
          destroy(error: Error) {
            if (dripTimer) clearInterval(dripTimer);
            mockReq._errorHandler?.(error);
          },
        };
        return mockReq;
      };
      try {
        await assert.rejects(() => dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" }), /timed out/);
      } finally {
        if (originalTimeout === undefined) delete process.env.CODEATLAS_API_TIMEOUT_MS;
        else process.env.CODEATLAS_API_TIMEOUT_MS = originalTimeout;
      }
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
      requestMock = mockSuccessResponse(200, { success: true, id: "x" }, capture);
      await dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test body", importance: 9, session_id: "s-1", project: "p", project_id: "project_abc", display_name: "P", workspace_path: "/trusted/workspace" });
      const parsed = JSON.parse(capture.written!);
      assert.strictEqual(parsed.memory_type, "MISTAKE");
      assert.strictEqual(parsed.content, "test body");
      assert.strictEqual(parsed.importance, 9);
      assert.strictEqual(parsed.session_id, "s-1");
      assert.strictEqual(parsed.project, "p");
      assert.strictEqual(parsed.project_id, "project_abc");
      assert.strictEqual(parsed.display_name, "P");
      assert.strictEqual(parsed.workspace_path, "/trusted/workspace");
    });

    it("sends x-api-key header without exposing apiKey in query param", async () => {
      process.env.CODEATLAS_API_KEY = "key-sentinel";
      const capture: { options?: any; written?: string } = {};
      requestMock = mockSuccessResponse(200, { success: true, id: "x" }, capture);
      await dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" });
      const opts = capture.options!;
      assert.ok(!String(opts.path).includes("apiKey="), `path should NOT contain apiKey, got: ${String(opts.path)}`);
      assert.strictEqual(opts.headers["x-api-key"], "key-sentinel");
    });

    it("sends Chrome User-Agent", async () => {
      const capture: { options?: any } = {};
      requestMock = mockSuccessResponse(200, { success: true, id: "x" }, capture);
      await dreamingService.saveDreamMemory({ memory_type: "MISTAKE", content: "test" });
      assert.ok(String(capture.options!.headers["User-Agent"]).includes("Chrome/125.0.0.0"));
    });
  });

  // ----- queryDreamMemories -----
  describe("ingestSessionEvent()", () => {
    it("sends one stable event with canonical project identity and accepts durable receipts", async () => {
      const capture: { options?: any; written?: string } = {};
      requestMock = mockSuccessResponse(200, { success: true, status: "duplicate", persisted: true, acknowledged: true, event_id: "e-1", memory_ids: [] }, capture);
      const result = await dreamingService.ingestSessionEvent({ event_id: "e-1", session_id: "s-1", project_id: "project_abc", project: "legacy-label", display_name: "Display Name", workspace_path: "/trusted/workspace", content: "line", source_spans: [{ start: 0, end: 5 }] });
      assert.equal(capture.options.path, "/api/dreams/ingest-session");
      assert.equal(capture.options.headers["Idempotency-Key"], "e-1");
      const payload = JSON.parse(capture.written!);
      assert.deepStrictEqual(payload.project_id, "project_abc");
      assert.deepStrictEqual(payload.project, "legacy-label");
      assert.deepStrictEqual(payload.display_name, "Display Name");
      assert.deepStrictEqual(payload.workspace_path, "/trusted/workspace");
      assert.deepStrictEqual(result, { success: true, status: "duplicate", persisted: true, acknowledged: true, event_id: "e-1", memory_ids: [] });
    });

    it("rejects a receipt that is not acknowledged, persisted, or consistent with the event", async () => {
      requestMock = mockSuccessResponse(200, { success: true, status: "stored", persisted: true, acknowledged: false, event_id: "e-1", memory_ids: [] });
      await assert.rejects(() => dreamingService.ingestSessionEvent({ event_id: "e-1", session_id: "s-1", project_id: "project_abc", content: "line" }), /Invalid ingest acknowledgment/);
      requestMock = mockSuccessResponse(200, { success: true, status: "stored", persisted: true, acknowledged: true, event_id: "other", memory_ids: [] });
      const mismatched = await dreamingService.ingestSessionEvent({ event_id: "e-1", session_id: "s-1", project_id: "project_abc", content: "line" });
      assert.equal(mismatched.event_id, "other");
    });

    it("rejects malformed JSON in a successful ingest response instead of acknowledging it", async () => {
      requestMock = mockSuccessResponse(200, "{not-json");
      await assert.rejects(
        () => dreamingService.ingestSessionEvent({ event_id: "e-malformed", session_id: "s-1", project_id: "project_abc", content: "line" }),
        /Invalid ingest acknowledgment: response was not valid JSON/,
      );
    });

    it("marks event validation conflicts permanent while retaining auth and transient HTTP failures", async () => {
      const { SessionIngestError } = dreamingService;
      for (const [statusCode, retryable] of [[400, false], [409, false], [401, true], [429, true], [503, true]] as const) {
        requestMock = mockSuccessResponse(statusCode, { error: "synthetic backend detail" });
        await assert.rejects(
          () => dreamingService.ingestSessionEvent({ event_id: "e-1", session_id: "s-1", project_id: "project_abc", content: "line" }),
          (error: unknown) => error instanceof SessionIngestError && error.retryable === retryable && error.failureCode === `http_${statusCode}`,
        );
      }
    });

    it("requires explicitly durable accounting for filtered events", async () => {
      requestMock = mockSuccessResponse(200, { success: true, status: "filtered", persisted: false, acknowledged: true, event_id: "e-1", memory_ids: [] });
      const result = await dreamingService.ingestSessionEvent({ event_id: "e-1", session_id: "s-1", project_id: "project_abc", content: "line" });
      assert.equal(result.status, "filtered");
      requestMock = mockSuccessResponse(200, { success: true, status: "filtered", persisted: false, acknowledged: false, event_id: "e-1", memory_ids: [] });
      await assert.rejects(() => dreamingService.ingestSessionEvent({ event_id: "e-1", session_id: "s-1", project_id: "project_abc", content: "line" }), /Invalid ingest acknowledgment/);
    });
  });

  // ----- queryDreamMemories -----
  describe("queryDreamMemories()", () => {
    it("preserves explicit retrieval statuses without turning authentication failures into empty memory", async () => {
      requestMock = mockSuccessResponse(401, { error: "synthetic-sensitive-backend-body" });
      const auth = await dreamingService.queryDreamMemoriesWithStatus({ query: "resolver.ts" });
      assert.equal(auth.retrieval_status, "auth_error");
      assert.deepStrictEqual(auth.memories, []);
      assert.ok(!JSON.stringify(auth).includes("synthetic-sensitive-backend-body"));
      requestMock = mockSuccessResponse(200, { success: true, memories: [], retrieval_status: "filtered", candidate_count: 3, returned_count: 0 });
      const filtered = await dreamingService.queryDreamMemoriesWithStatus({ query: "resolver.ts" });
      assert.equal(filtered.retrieval_status, "filtered");
      assert.equal(filtered.candidate_count, 3);
    });

    it("rejects malformed and false-success query bodies without leaking raw responses", async () => {
      for (const body of [{ success: false, memories: [] }, { memories: {} }, { unrelated: "synthetic-sensitive-backend-body" }]) {
        requestMock = mockSuccessResponse(200, body);
        const result = await dreamingService.queryDreamMemoriesWithStatus({ query: "x" });
        assert.equal(result.retrieval_status, "backend_error");
        assert.ok(!JSON.stringify(result).includes("synthetic-sensitive-backend-body"));
      }
    });

    it("distinguishes transport and backend failure from an empty project", async () => {
      requestMock = mockNetworkError("ECONNREFUSED");
      assert.equal((await dreamingService.queryDreamMemoriesWithStatus({ query: "x" })).retrieval_status, "transport_error");
      requestMock = mockSuccessResponse(503, "private response");
      assert.equal((await dreamingService.queryDreamMemoriesWithStatus({ query: "x" })).retrieval_status, "backend_error");
      requestMock = mockSuccessResponse(200, { memories: [], retrieval_status: "empty" });
      assert.equal((await dreamingService.queryDreamMemoriesWithStatus({ query: "" })).retrieval_status, "empty");
    });
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
      await dreamingService.queryDreamMemories({ query: "search", limit: 5, project: "my-app", project_id: "project_abc", display_name: "My App", workspace_path: "/trusted/workspace" });
      const path = String(capture.options!.path);
      assert.ok(path.includes("query=search") && path.includes("limit=5") && path.includes("project=my-app") && path.includes("project_id=project_abc") && path.includes("display_name=My+App") && path.includes("workspace_path=%2Ftrusted%2Fworkspace"));
    });

    it("does NOT send limit when omitted", async () => {
      const capture: { options?: any } = {};
      requestMock = mockSuccessResponse(200, { memories: [] }, capture);
      await dreamingService.queryDreamMemories({ query: "search" });
      assert.ok(!String(capture.options!.path).includes("limit="));
    });

    it("includes x-api-key header for GET without exposing apiKey in query param", async () => {
      process.env.CODEATLAS_API_KEY = "test-key-query";
      const capture: { options?: any } = {};
      requestMock = mockSuccessResponse(200, { memories: [] }, capture);
      await dreamingService.queryDreamMemories({ query: "test" });
      const path = String(capture.options!.path);
      assert.ok(!path.includes("apiKey="), `Expected apiKey to NOT be in query, got: ${path}`);
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
