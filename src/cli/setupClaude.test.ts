import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSettings } from "./setupClaude.js";

test("Claude setup preserves security settings and third-party hook matcher groups while adding lifecycle routes", () => {
  const thirdPartyStartup = { matcher: "startup", hooks: [{ type: "command", command: "vendor-start" }] };
  const thirdPartyBash = { matcher: "Bash", hooks: [{ type: "command", command: "vendor-bash" }] };
  const input = {
    permissions: { deny: ["Bash(rm -rf *)"], allow: ["Bash(npm test)"], additionalDirectories: ["/safe/project"] },
    hooks: {
      SessionStart: [thirdPartyStartup],
      PostToolUse: [thirdPartyBash],
    },
  };
  const output = mergeSettings(input);
  assert.deepEqual(output.permissions, input.permissions);
  assert.deepEqual(output.hooks.SessionStart[0], thirdPartyStartup);
  assert.deepEqual(output.hooks.PostToolUse[0], thirdPartyBash);
  for (const [event, route] of [["SessionStart", "brain-context"], ["UserPromptSubmit", "brain-context"], ["PostToolUse", "brain-save"], ["PostToolUseFailure", "brain-save"], ["Stop", "brain-save"], ["PreCompact", "brain-save"]]) {
    assert.ok(output.hooks[event].some((group: any) => group.hooks?.some((hook: any) => hook.command?.endsWith(`hook ${route}`) && !hook.args)), `${event} should register ${route}`);
  }
});
