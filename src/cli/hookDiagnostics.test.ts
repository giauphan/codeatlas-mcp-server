import { describe, it } from "node:test";
import * as assert from "node:assert";
import { summarizeClaudeHookRoutes } from "./commands.js";

describe("Claude hook diagnostics", () => {
  it("summarizes native and shell routes without reading command environment values", () => {
    const routes = summarizeClaudeHookRoutes({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "codeatlas", args: ["brain-context"] }] }],
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "/home/user/.claude/hooks/brain-save.sh", env: { TOKEN: "must-not-appear" } }] }],
        PostToolUseFailure: [{ hooks: [{ type: "command", command: "codeatlas", args: ["hook", "brain-save"] }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "third-party-hook" }] }],
      },
    });

    assert.deepStrictEqual(routes.SessionStart, ["native_cli:brain-context"]);
    assert.deepStrictEqual(routes.PostToolUse, ["shell_script:brain-save"]);
    assert.deepStrictEqual(routes.PostToolUseFailure, ["native_cli:brain-save"]);
    assert.deepStrictEqual(routes.UserPromptSubmit, []);
    assert.doesNotMatch(JSON.stringify(routes), /must-not-appear|TOKEN/);
  });

  it("handles absent or malformed hook settings", () => {
    const routes = summarizeClaudeHookRoutes(null);
    assert.deepStrictEqual(routes, {
      SessionStart: [],
      UserPromptSubmit: [],
      PostToolUse: [],
      PostToolUseFailure: [],
      Stop: [],
      PreCompact: [],
    });
  });

  it("recognizes a packaged native command outside a codeatlas-named directory", () => {
    const routes = summarizeClaudeHookRoutes({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "'/usr/bin/node' '/opt/tools/memory/dist/index.js' hook brain-context" }] }] } });
    assert.deepStrictEqual(routes.SessionStart, ["native_cli:brain-context"]);
  });
});
