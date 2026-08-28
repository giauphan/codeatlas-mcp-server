import { describe, it } from "node:test";
import * as assert from "node:assert";
import { filterAllowedDreams, formatBrainContext } from "./brainContext.js";
import type { DreamMemoryResult } from "./dreamingService.js";

function memory(partial: Partial<DreamMemoryResult>): DreamMemoryResult {
  return {
    id: "1",
    memory_type: "KNOWLEDGE",
    content: "Parser uses ESTree.",
    importance: 5,
    session_id: null,
    project: "codeatlas",
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("brain context", () => {
  it("requires API URL when cloud context is requested", async () => {
    const originalUrl = process.env.CODEATLAS_API_URL;
    const originalKey = process.env.CODEATLAS_API_KEY;
    delete process.env.CODEATLAS_API_URL;
    process.env.CODEATLAS_API_KEY = "test-key";
    try {
      const { loadBrainContext } = await import("./brainContext.js");
      await assert.rejects(() => loadBrainContext({ query: "test" }), /CODEATLAS_API_URL/);
    } finally {
      if (originalUrl === undefined) delete process.env.CODEATLAS_API_URL;
      else process.env.CODEATLAS_API_URL = originalUrl;
      if (originalKey === undefined) delete process.env.CODEATLAS_API_KEY;
      else process.env.CODEATLAS_API_KEY = originalKey;
    }
  });
  it("drops unrecognized memory types", () => {
    const kept = filterAllowedDreams([
      memory({ memory_type: "KNOWLEDGE", content: "Parser uses ESTree." }),
      memory({ memory_type: "SHOPPING", content: "Buy milk." }),
      memory({ memory_type: "WEATHER", content: "Sunny tomorrow." }),
    ]);
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(kept[0].content, "Parser uses ESTree.");
  });

  it("formats dreams, genome, and immune as untrusted reference", () => {
    const text = formatBrainContext({
      dreams: [memory({})],
      genes: [{ name: "retry-on-timeout", description: "Retry fetch once on 504." }],
      immune: "Do not swallow parser errors.",
    });
    assert.match(text, /Untrusted CodeAtlas historical reference/);
    assert.match(text, /\[KNOWLEDGE\] Parser uses ESTree/);
    assert.match(text, /retry-on-timeout: Retry fetch once on 504/);
    assert.match(text, /Do not swallow parser errors/);
    assert.doesNotMatch(text, /Buy milk/);
  });

  it("returns a no-context message when empty", () => {
    assert.strictEqual(
      formatBrainContext({ dreams: [], genes: [], immune: "" }),
      "No Second Brain context found for this query.",
    );
  });
});
