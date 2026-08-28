import * as assert from "node:assert";
import { describe, it } from "node:test";
import { routeTask } from "./taskRouter.js";

describe("routeTask", () => {
  it("routes architecture/debug tasks to opus max", () => {
    const result = routeTask("design the architecture");
    assert.strictEqual(result.model, "ag/claude-opus-4-6-thinking");
    assert.strictEqual(result.effort, "max");
  });

  it("routes code_generation / implement to sonnet medium", () => {
    const result = routeTask("implement login", "code_generation");
    assert.strictEqual(result.model, "ag/claude-sonnet-4-6");
    assert.strictEqual(result.effort, "medium");
  });

  it("routes simple/docs tasks to sonnet low", () => {
    const result = routeTask("what is AST", "explain");
    assert.strictEqual(result.model, "ag/claude-sonnet-4-6");
    assert.strictEqual(result.effort, "low");
  });

  it("falls back to sonnet medium", () => {
    const result = routeTask("hello");
    assert.strictEqual(result.model, "ag/claude-sonnet-4-6");
    assert.strictEqual(result.effort, "medium");
  });
});
