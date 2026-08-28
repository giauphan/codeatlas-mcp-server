import test, { describe } from "node:test";
import assert from "node:assert";
import { routeTask } from "./taskRouter.js";

describe("routeTask", () => {
  test("routes architecture/debug tasks to opus max", () => {
    const r = routeTask("design the architecture");
    assert.strictEqual(r.model, "ag/claude-opus-4-6-thinking");
    assert.strictEqual(r.effort, "max");
  });

  test("routes code_generation / implement to sonnet medium", () => {
    const r = routeTask("implement login", "code_generation");
    assert.strictEqual(r.model, "ag/claude-sonnet-4-6");
    assert.strictEqual(r.effort, "medium");
  });

  test("routes simple/docs tasks to sonnet low", () => {
    const r = routeTask("what is AST", "explain");
    assert.strictEqual(r.model, "ag/claude-sonnet-4-6");
    assert.strictEqual(r.effort, "low");
  });

  test("falls back to sonnet medium", () => {
    const r = routeTask("hello");
    assert.strictEqual(r.model, "ag/claude-sonnet-4-6");
    assert.strictEqual(r.effort, "medium");
  });
});
