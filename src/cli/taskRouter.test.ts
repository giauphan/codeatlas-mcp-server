const { routeTask } = require("./taskRouter.js");

describe("routeTask", () => {
  test("routes architecture/debug tasks to opus max", () => {
    const r = routeTask("design the architecture");
    expect(r.model).toBe("ag/claude-opus-4-6-thinking");
    expect(r.effort).toBe("max");
  });

  test("routes code_generation / implement to sonnet medium", () => {
    const r = routeTask("implement login", "code_generation");
    expect(r.model).toBe("ag/claude-sonnet-4-6");
    expect(r.effort).toBe("medium");
  });

  test("routes simple/docs tasks to sonnet low", () => {
    const r = routeTask("what is AST", "explain");
    expect(r.model).toBe("ag/claude-sonnet-4-6");
    expect(r.effort).toBe("low");
  });

  test("falls back to sonnet medium", () => {
    const r = routeTask("hello");
    expect(r.model).toBe("ag/claude-sonnet-4-6");
    expect(r.effort).toBe("medium");
  });
});
