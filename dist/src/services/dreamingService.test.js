import { describe, it, mock, before, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------
/**
 * We cannot use `mock.method` on ESM namespace objects (`import * as https`)
 * because they are frozen.  Instead we use `mock.module` to intercept the
 * `https` built-in and relative `./projectService.js` module, providing
 * configurable implementations via mutable variables so individual tests can
 * change behaviour.
 */
/** The current mock for `https.request`.  Set before each test. */
let requestMock;
/** The current value `getResolvedApiKey` returns.  Set before each test. */
let apiKeyMock;
// ---------------------------------------------------------------------------
// Helper factories (return functions usable as requestMock)
// ---------------------------------------------------------------------------
/**
 * Create a mock `https.request` that simulates a successful HTTP response.
 * The response events fire synchronously inside `end()`, matching the pattern
 * used in `watcherService.test.ts`.
 */
function mockSuccessResponse(statusCode, body, capture) {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    return (options, callback) => {
        if (capture)
            capture.options = options;
        const mockRes = {
            statusCode,
            on(event, handler) {
                if (event === "data")
                    handler(bodyStr);
                if (event === "end")
                    handler();
            },
        };
        const mockReq = {
            _errorHandler: null,
            on(event, handler) {
                if (event === "error")
                    mockReq._errorHandler = handler;
                return mockReq;
            },
            write(data) {
                if (capture)
                    capture.written = String(data);
            },
            end() {
                callback(mockRes);
            },
        };
        return mockReq;
    };
}
/**
 * Create a mock `https.request` that fires a network-level error when
 * `end()` is called (simulating ECONNREFUSED / ETIMEDOUT / DNS failures).
 */
function mockNetworkError(message) {
    return (_options, _callback) => {
        const mockReq = {
            _errorHandler: null,
            on(event, handler) {
                if (event === "error")
                    mockReq._errorHandler = handler;
                return mockReq;
            },
            write() { },
            end() {
                setImmediate(() => {
                    if (mockReq._errorHandler)
                        mockReq._errorHandler(new Error(message));
                });
            },
        };
        return mockReq;
    };
}
// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("Dreaming Service — HTTPS Client", () => {
    let dreamingService;
    // Register module mocks once for the whole suite.
    before(async () => {
        // --- mock https (built-in) ---
        mock.module("https", {
            namedExports: {
                request(options, callback) {
                    if (!requestMock)
                        throw new Error("requestMock is not set — did you forget to assign it in a test?");
                    return requestMock(options, callback);
                },
            },
        });
        // --- mock getResolvedApiKey from projectService ---
        mock.module("./projectService.js", {
            namedExports: {
                getResolvedApiKey() {
                    return apiKeyMock;
                },
            },
        });
        // Now import the module under test — it picks up the already-mocked deps.
        dreamingService = await import("./dreamingService.js");
    });
    // Set default mock values before each test.
    beforeEach(() => {
        apiKeyMock = "test-mock-key";
        requestMock = null; // each test must assign its own
    });
    afterEach(() => {
        // Reset mutable state so leaked mocks from one test never affect the next.
        apiKeyMock = undefined;
        requestMock = null;
    });
    // ──────────────────────────────────────────────────────────────────────
    // saveDreamMemory
    // ──────────────────────────────────────────────────────────────────────
    describe("saveDreamMemory()", () => {
        it("returns { success: true, id } when API responds 200 with an id", async () => {
            requestMock = mockSuccessResponse(200, { id: "dream-42" });
            const result = await dreamingService.saveDreamMemory({
                memory_type: "MISTAKE",
                content: "I should not use console.log in production",
            });
            assert.deepStrictEqual(result, { success: true, id: "dream-42" });
        });
        it("uses the `dreamId` field when `id` is absent", async () => {
            requestMock = mockSuccessResponse(200, { dreamId: "alt-99" });
            const result = await dreamingService.saveDreamMemory({
                memory_type: "KNOWLEDGE",
                content: "Something I learned",
            });
            assert.deepStrictEqual(result, { success: true, id: "alt-99" });
        });
        it("falls back to 'unknown' when neither id nor dreamId is present", async () => {
            requestMock = mockSuccessResponse(200, { ok: true });
            const result = await dreamingService.saveDreamMemory({
                memory_type: "PATTERN",
                content: "Pattern detected",
            });
            assert.deepStrictEqual(result, { success: true, id: "unknown" });
        });
        it("throws when API returns a 4xx status", async () => {
            requestMock = mockSuccessResponse(401, "Unauthorized");
            await assert.rejects(() => dreamingService.saveDreamMemory({
                memory_type: "MISTAKE",
                content: "test",
            }), { message: /Failed to save dream memory: status 401/ });
        });
        it("throws when API returns a 5xx status", async () => {
            requestMock = mockSuccessResponse(500, "Internal Server Error");
            await assert.rejects(() => dreamingService.saveDreamMemory({
                memory_type: "MISTAKE",
                content: "test",
            }), { message: /Failed to save dream memory: status 500/ });
        });
        it("throws on network error (e.g. ECONNREFUSED)", async () => {
            requestMock = mockNetworkError("ECONNREFUSED");
            await assert.rejects(() => dreamingService.saveDreamMemory({
                memory_type: "MISTAKE",
                content: "test",
            }), { message: /Network Error: ECONNREFUSED/ });
        });
        it("throws when CODEATLAS_API_KEY resolves to undefined", async () => {
            apiKeyMock = undefined;
            await assert.rejects(() => dreamingService.saveDreamMemory({
                memory_type: "MISTAKE",
                content: "test",
            }), { message: /CODEATLAS_API_KEY is not set/ });
        });
        it("forwards content (even empty string) in the HTTP body", async () => {
            const capture = {};
            requestMock = mockSuccessResponse(200, { id: "e1" }, capture);
            await dreamingService.saveDreamMemory({
                memory_type: "PREFERENCE",
                content: "",
            });
            assert.ok(capture.written, "req.write() should have been called");
            const parsed = JSON.parse(capture.written);
            assert.strictEqual(parsed.content, "");
        });
        it("does NOT send `importance` when omitted (API receives undefined)", async () => {
            const capture = {};
            requestMock = mockSuccessResponse(200, { id: "x" }, capture);
            await dreamingService.saveDreamMemory({
                memory_type: "KNOWLEDGE",
                content: "some content",
                // importance omitted on purpose
            });
            const parsed = JSON.parse(capture.written);
            assert.strictEqual(parsed.importance, undefined);
        });
        it("sends apiKey in both query param and x-api-key header", async () => {
            apiKeyMock = "test-key-sentinel";
            const capture = {};
            requestMock = mockSuccessResponse(200, { id: "x" }, capture);
            await dreamingService.saveDreamMemory({
                memory_type: "MISTAKE",
                content: "test",
            });
            const opts = capture.options;
            assert.ok(String(opts.path).includes("apiKey=test-key-sentinel"), `path should contain apiKey query param, got: ${opts.path}`);
            assert.strictEqual(opts.headers["x-api-key"], "test-key-sentinel");
        });
        it("sends session_id and project when provided", async () => {
            const capture = {};
            requestMock = mockSuccessResponse(200, { id: "x" }, capture);
            await dreamingService.saveDreamMemory({
                memory_type: "PATTERN",
                content: "test",
                session_id: "sess-1",
                project: "my-app",
            });
            const parsed = JSON.parse(capture.written);
            assert.strictEqual(parsed.session_id, "sess-1");
            assert.strictEqual(parsed.project, "my-app");
        });
        it("accepts any memory_type without validation (forwards as-is)", async () => {
            const capture = {};
            requestMock = mockSuccessResponse(200, { id: "x" }, capture);
            await dreamingService.saveDreamMemory({
                memory_type: "INVALID_TYPE",
                content: "whatever",
            });
            const parsed = JSON.parse(capture.written);
            assert.strictEqual(parsed.memory_type, "INVALID_TYPE");
        });
    });
    // ──────────────────────────────────────────────────────────────────────
    // queryDreamMemories
    // ──────────────────────────────────────────────────────────────────────
    describe("queryDreamMemories()", () => {
        it("returns memories array when API responds with `memories`", async () => {
            const fixture = {
                memories: [
                    {
                        id: "m1",
                        content: "alpha",
                        memory_type: "MISTAKE",
                        importance: 0.8,
                        session_id: null,
                        project: null,
                        created_at: "2024-01-01T00:00:00Z",
                        score: 0.95,
                    },
                    {
                        id: "m2",
                        content: "beta",
                        memory_type: "KNOWLEDGE",
                        importance: 0.6,
                        session_id: null,
                        project: null,
                        created_at: "2024-01-01T00:00:00Z",
                        score: 0.82,
                    },
                ],
            };
            requestMock = mockSuccessResponse(200, fixture);
            const memories = await dreamingService.queryDreamMemories({
                query: "test query",
            });
            assert.strictEqual(memories.length, 2);
            assert.strictEqual(memories[0].id, "m1");
            assert.strictEqual(memories[0].score, 0.95);
            assert.strictEqual(memories[1].id, "m2");
        });
        it("uses `results` as fallback when `memories` is absent", async () => {
            const fixture = {
                results: [
                    {
                        id: "r1",
                        content: "result-item",
                        memory_type: "PATTERN",
                        importance: 0.5,
                        session_id: null,
                        project: null,
                        created_at: "2024-01-01T00:00:00Z",
                        score: 0.7,
                    },
                ],
            };
            requestMock = mockSuccessResponse(200, fixture);
            const memories = await dreamingService.queryDreamMemories({
                query: "find patterns",
            });
            assert.strictEqual(memories.length, 1);
            assert.strictEqual(memories[0].id, "r1");
        });
        it("returns empty array when API responds with empty memories", async () => {
            requestMock = mockSuccessResponse(200, { memories: [] });
            const memories = await dreamingService.queryDreamMemories({
                query: "anything",
            });
            assert.deepStrictEqual(memories, []);
        });
        it("throws when API response is not valid JSON", async () => {
            requestMock = mockSuccessResponse(200, "not-json-at-all");
            await assert.rejects(() => dreamingService.queryDreamMemories({ query: "x" }), { message: /Failed to parse dream memory query response/ });
        });
        it("throws when API returns non-2xx status", async () => {
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
        it("sends `limit` as a query parameter when provided", async () => {
            const capture = {};
            requestMock = mockSuccessResponse(200, { memories: [] }, capture);
            await dreamingService.queryDreamMemories({ query: "search", limit: 5 });
            const path = String(capture.options.path);
            assert.ok(path.includes("limit=5"), `Expected limit=5 in path, got: ${path}`);
        });
        it("does NOT send `limit` when omitted", async () => {
            const capture = {};
            requestMock = mockSuccessResponse(200, { memories: [] }, capture);
            await dreamingService.queryDreamMemories({ query: "search" });
            const path = String(capture.options.path);
            assert.ok(!path.includes("limit="), `Expected no limit param, got: ${path}`);
        });
        it("sends the `project` filter when provided", async () => {
            const capture = {};
            requestMock = mockSuccessResponse(200, { memories: [] }, capture);
            await dreamingService.queryDreamMemories({
                query: "bug",
                project: "my-app",
            });
            const path = String(capture.options.path);
            assert.ok(path.includes("project=my-app"), `Expected project=my-app in path, got: ${path}`);
        });
        it("includes apiKey in query params and x-api-key header for GET", async () => {
            apiKeyMock = "test-key-query";
            const capture = {};
            requestMock = mockSuccessResponse(200, { memories: [] }, capture);
            await dreamingService.queryDreamMemories({ query: "test" });
            const path = String(capture.options.path);
            assert.ok(path.includes("apiKey=test-key-query"), `Expected apiKey in query, got: ${path}`);
            assert.strictEqual(capture.options.headers["x-api-key"], "test-key-query");
        });
    });
});
//# sourceMappingURL=dreamingService.test.js.map