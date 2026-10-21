import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import { bold, ok, fail, warn } from "./commands.js";
import { getZedSettingsPath, getZedConfigDir } from "../utils/pathUtils.js";
import { checkSpawnResult } from "../utils/processUtils.js";

function getSettingsPath(): string {
  const home = os.homedir();
  return path.join(home, ".claude", "settings.json");
}

function getHooksDir(): string {
  const home = os.homedir();
  return path.join(home, ".claude", "hooks");
}

// Shared with npm scripts and both legacy installer entrypoints.
export { mergeSettings } from "../../scripts/claude-hook-settings.js";
import { installClaudeHooks } from "../../scripts/claude-hook-settings.js";

export async function cmdSetupClaude(projectDir: string = process.cwd()): Promise<void> {
  console.log(`\n${bold("CodeAtlas Claude Integration Setup")}`);
  console.log("=".repeat(50));

  // 1. Verify codeatlas CLI is available
  console.log(`\n${bold("1. Verifying CodeAtlas CLI")}`);
  try {
    const { spawnSync } = await import("child_process");
    // Use shell: process.platform === "win32" to allow spawning .cmd wrappers on Windows while avoiding shell injection on Unix
    const result = spawnSync("codeatlas-enterprise", ["--version"], { encoding: "utf-8", timeout: 5000, shell: process.platform === "win32" });
    checkSpawnResult(result);
    const version = (result.stdout?.trim() ?? "");
    console.log(`  ${ok()} CodeAtlas CLI version: ${version}`);
  } catch (e: any) {
    console.log(`  ${warn()} CodeAtlas CLI not found globally. Using npx/local path.`);
  }

  // 2. Update ~/.claude/settings.json
  console.log(`\n${bold("2. Updating ~/.claude/settings.json")}`);
  const settingsPath = getSettingsPath();

  try {
    installClaudeHooks(settingsPath);
    console.log(`  ${ok()} Updated hooks in ${settingsPath}`);
    console.log(`  • SessionStart / UserPromptSubmit: native brain-context (opt-in)`);
    console.log(`  • PostToolUse / PostToolUseFailure / Stop / PreCompact: native brain-save`);
  } catch {
    console.error(`  ${fail()} Refusing to replace unreadable or invalid Claude settings.`);
    process.exitCode = 1;
    return;
  }

  // 3. Generate CLAUDE.md with project rules
  console.log(`\n${bold("3. Ensuring CLAUDE.md project rules")}`);
  try {
    // Dynamic import to avoid circular dependencies
    const { generateMemory } = await import("../memoryGenerator.js");
    // generateMemory handles the 'only create if not exists' logic
    generateMemory(projectDir, {} as any);
    console.log(`  ${ok()} Project rules ensured in ${projectDir}/CLAUDE.md`);
  } catch (e: any) {
    console.log(`  ${warn()} Could not auto-generate CLAUDE.md: ${e.message}`);
  }

  console.log("=".repeat(50));
  console.log(`\n${bold("🎉 Claude integration setup complete!")}`);
  console.log(`  Restart Claude Code for hooks to take effect.\n`);
}

export async function cmdSetupZed(): Promise<void> {
  console.log(`\n${bold("CodeAtlas Zed Integration Setup")}`);
  console.log("=".repeat(50));

  const settingsPath = getZedSettingsPath();
  let settings: any = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch (e: any) {
      console.log(`  ${fail()} Could not parse existing ${settingsPath}: ${e.message}`);
      return;
    }
  } else {
    console.log(`  ${warn()} ${settingsPath} not found — will create it.`);
  }

  if (settings.context_servers && (typeof settings.context_servers !== "object" || Array.isArray(settings.context_servers))) {
    console.log(`  ${fail()} settings.context_servers exists but is not an object. Aborting to avoid clobbering.`);
    return;
  }

  const ctxServers = settings.context_servers = settings.context_servers || {};
  const env: Record<string, string> = {};
  if (process.env.CODEATLAS_API_KEY) env.CODEATLAS_API_KEY = process.env.CODEATLAS_API_KEY;
  if (process.env.CODEATLAS_API_URL) env.CODEATLAS_API_URL = process.env.CODEATLAS_API_URL;
  ctxServers["codeatlas-mcp-server"] = {
    command: "npx",
    args: ["--yes", "--package=codeatlas-mcp-server", "codeatlas-mcp"],
    env,
  };

  fs.mkdirSync(getZedConfigDir(), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  console.log(`  ${ok()} Registered context server in ${settingsPath}`);

  console.log("=".repeat(50));
  console.log(`\n${bold("Zed integration setup complete!")}`);
  console.log(`  Restart Zed for the context server to load.`);
  console.log(`  Then ask the AI to use 'brain_context' to load Second Brain memory.\n`);
}
