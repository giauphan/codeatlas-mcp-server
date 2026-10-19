import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { SecurityScanner } from "./securityScanner.js";
import type { AnalysisResult } from "./analyzer/types.js";

describe("AI scan endpoint validation", () => {
  for (const [url, allowed] of [
    ["http://[::1]:3381/scan", true],
    ["ftp://localhost/scan", false],
    ["http://untrusted.example/scan", false],
    ["https://provider.example/scan", true],
  ] as const) {
    it(`${allowed ? "allows" : "rejects"} ${url}`, async () => {
      const originalUrl = process.env.CODEATLAS_SCAN_AI_URL;
      const originalKey = process.env.CODEATLAS_SCAN_AI_KEY;
      const originalFetch = globalThis.fetch;
      const originalWarn = console.warn;
      process.env.CODEATLAS_SCAN_AI_URL = url;
      process.env.CODEATLAS_SCAN_AI_KEY = "test-ai-key";
      let sentKey: string | null = null;
      globalThis.fetch = async (_url, init) => {
        sentKey = new Headers(init?.headers).get("Authorization");
        return Response.json({ choices: [{ message: { content: "[]" } }] });
      };
      console.warn = () => {};
      try {
        assert.deepEqual(await SecurityScanner.aiScan([], {} as AnalysisResult), []);
        assert.equal(sentKey, allowed ? "Bearer test-ai-key" : null);
      } finally {
        if (originalUrl === undefined) delete process.env.CODEATLAS_SCAN_AI_URL;
        else process.env.CODEATLAS_SCAN_AI_URL = originalUrl;
        if (originalKey === undefined) delete process.env.CODEATLAS_SCAN_AI_KEY;
        else process.env.CODEATLAS_SCAN_AI_KEY = originalKey;
        globalThis.fetch = originalFetch;
        console.warn = originalWarn;
      }
    });
  }
});
