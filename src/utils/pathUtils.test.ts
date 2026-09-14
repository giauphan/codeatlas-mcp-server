import { describe, it } from "node:test";
import * as assert from "node:assert";
import {
  getHomePath,
  getHermesConfigPath,
  getHermesPluginDir,
  getClaudeConfigPath,
  getClaudeSettingsPath,
  getClaudeJsonPath,
  getClaudeDesktopConfigPath,
  getGeminiSettingsPath,
  getGeminiConfigPath,
  getZedSettingsPath,
  getCursorMcpPath,
  getClaudeHooksDir
} from "./pathUtils.js";

describe("pathUtils", () => {
  it("resolves home path", () => {
    const home = getHomePath();
    assert.ok(typeof home === "string" && home.length > 0);
  });

  it("resolves Claude configuration paths", () => {
    assert.ok(getClaudeSettingsPath().endsWith(".claude/settings.json") || getClaudeSettingsPath().includes(".claude"));
    assert.ok(getClaudeJsonPath().endsWith(".claude.json"));
    assert.ok(getClaudeConfigPath().endsWith("claude.json"));
    assert.ok(getClaudeHooksDir().endsWith(".claude/hooks") || getClaudeHooksDir().includes("hooks"));
    assert.ok(getClaudeDesktopConfigPath().includes("claude_desktop_config.json"));
  });

  it("resolves Hermes and Zed and Gemini paths", () => {
    assert.ok(getHermesConfigPath().includes(".hermes"));
    assert.ok(getHermesPluginDir().includes("codeatlas_second_brain"));
    assert.ok(getZedSettingsPath().includes("settings.json"));
    assert.ok(getGeminiSettingsPath().includes(".gemini"));
    assert.ok(getGeminiConfigPath().includes(".gemini"));
    assert.ok(getCursorMcpPath().includes(".cursor"));
  });
});
