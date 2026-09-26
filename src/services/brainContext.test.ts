import { describe, it } from "node:test";
import * as assert from "node:assert";
import {
  DEFAULT_MIN_QUERY_WORD_LENGTH,
  DEFAULT_MIN_RELEVANCE_SCORE,
  filterAllowedDreams,
  getDefaultMinQueryWordLength,
  getDefaultMinRelevanceScore,
  formatBrainContext,
  filterGenesByRelevance,
} from "./brainContext.js";
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

  it("matches and ranks genes by query relevance", () => {
    const kept = filterGenesByRelevance(
      [
        { name: "Database indexes", description: "Use indexes for query performance." },
        { name: "Timeout retries", description: "Retry requests after a timeout." },
      ],
      "retry timeout",
    );

    assert.deepStrictEqual(kept, [
      { name: "Timeout retries", description: "Retry requests after a timeout." },
    ]);
  });

  it("returns all genes for empty or very short queries", () => {
    const genes = [
      { name: "First", description: "First result." },
      { name: "Second", description: "Second result." },
    ];

    assert.deepStrictEqual(filterGenesByRelevance(genes, ""), genes);
    assert.deepStrictEqual(filterGenesByRelevance(genes, "to a"), genes);
  });

  it("normalizes special characters before matching", () => {
    const parserGene = { name: "AST parser", description: "Parses TypeScript." };
    const databaseGene = { name: "Database indexes", description: "Optimizes queries." };

    assert.deepStrictEqual(
      filterGenesByRelevance([databaseGene, parserGene], "AST/parser?!"),
      [parserGene],
    );
  });

  it("returns no genes when nothing meets the relevance threshold", () => {
    const genes = [{ name: "Database indexes", description: "Optimizes queries." }];

    assert.deepStrictEqual(filterGenesByRelevance(genes, "AST parser"), []);
  });

  it("drops unrelated genome results for an AST parser query", () => {
    const kept = filterGenesByRelevance(
      [
        { name: "ESTree Parser", description: "Use @typescript-eslint/typescript-estree for JS and TS AST analysis." },
        { name: "Codebase Inspection", description: "Use pygount to report LOC and comment ratios." },
      ],
      "I need to parse JavaScript files into an AST graph. What parser library and conventions does CodeAtlas use?",
    );

    assert.deepStrictEqual(kept, [
      { name: "ESTree Parser", description: "Use @typescript-eslint/typescript-estree for JS and TS AST analysis." },
    ]);
  });

  it("does not treat AST and parser substrings as parser terms", () => {
    const gene = {
      name: "JavaScript CodeAtlas inspection",
      description: "Use pygount to report lines of code.",
    };

    assert.deepStrictEqual(
      filterGenesByRelevance([gene], "fast sparse JavaScript CodeAtlas analysis", 1),
      [gene],
    );
  });

  it("requires more than one description-only term by default", () => {
    assert.strictEqual(DEFAULT_MIN_RELEVANCE_SCORE, 2);

    const titleMatch = { name: "Retry policy", description: "Request handling." };
    const weakMatch = { name: "Networking", description: "Retry requests." };

    assert.deepStrictEqual(filterGenesByRelevance([weakMatch, titleMatch], "retry"), [titleMatch]);
  });

  it("reads a valid relevance threshold from the environment", () => {
    const original = process.env.CODEATLAS_MIN_RELEVANCE_SCORE;
    process.env.CODEATLAS_MIN_RELEVANCE_SCORE = "4";
    try {
      assert.strictEqual(getDefaultMinRelevanceScore(), 4);
    } finally {
      if (original === undefined) delete process.env.CODEATLAS_MIN_RELEVANCE_SCORE;
      else process.env.CODEATLAS_MIN_RELEVANCE_SCORE = original;
    }
  });

  it("falls back for an invalid relevance threshold", () => {
    const original = process.env.CODEATLAS_MIN_RELEVANCE_SCORE;
    process.env.CODEATLAS_MIN_RELEVANCE_SCORE = "invalid";
    try {
      assert.strictEqual(getDefaultMinRelevanceScore(), DEFAULT_MIN_RELEVANCE_SCORE);
    } finally {
      if (original === undefined) delete process.env.CODEATLAS_MIN_RELEVANCE_SCORE;
      else process.env.CODEATLAS_MIN_RELEVANCE_SCORE = original;
    }
  });

  it("reads a valid query word length from the environment", () => {
    const original = process.env.CODEATLAS_MIN_QUERY_WORD_LENGTH;
    process.env.CODEATLAS_MIN_QUERY_WORD_LENGTH = "5";
    try {
      assert.strictEqual(getDefaultMinQueryWordLength(), 5);
    } finally {
      if (original === undefined) delete process.env.CODEATLAS_MIN_QUERY_WORD_LENGTH;
      else process.env.CODEATLAS_MIN_QUERY_WORD_LENGTH = original;
    }
  });

  it("falls back for an invalid query word length", () => {
    const original = process.env.CODEATLAS_MIN_QUERY_WORD_LENGTH;
    process.env.CODEATLAS_MIN_QUERY_WORD_LENGTH = "invalid";
    try {
      assert.strictEqual(getDefaultMinQueryWordLength(), DEFAULT_MIN_QUERY_WORD_LENGTH);
    } finally {
      if (original === undefined) delete process.env.CODEATLAS_MIN_QUERY_WORD_LENGTH;
      else process.env.CODEATLAS_MIN_QUERY_WORD_LENGTH = original;
    }
  });

  it("supports a minimum relevance threshold", () => {
    const genes = [
      { name: "Parser", description: "Parser guidance." },
      { name: "AST parser", description: "AST parser guidance." },
    ];

    assert.deepStrictEqual(filterGenesByRelevance(genes, "AST parser", 3), [genes[1]]);
  });

  it("configures the relevance threshold when formatting context", () => {
    const text = formatBrainContext(
      {
        dreams: [],
        genes: [
          { name: "Parser", description: "Parser guidance." },
          { name: "AST parser", description: "AST parser guidance." },
        ],
        immune: "",
      },
      { query: "AST parser", minRelevanceScore: 3 },
    );

    assert.match(text, /AST parser: AST parser guidance/);
    assert.doesNotMatch(text, /- Parser: Parser guidance/);
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
