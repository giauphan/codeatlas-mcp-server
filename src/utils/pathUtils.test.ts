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

  it("appendFileSyncNoFollow correctly appends securely", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const { appendFileSyncNoFollow } = await import("./pathUtils.js");
    const testFile = path.join(process.cwd(), "test-append.txt");
    try {
      fs.writeFileSync(testFile, "hello\\n");
      appendFileSyncNoFollow(testFile, "world\\n");
      const content = fs.readFileSync(testFile, "utf-8");
      assert.strictEqual(content, "hello\\nworld\\n");
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });
