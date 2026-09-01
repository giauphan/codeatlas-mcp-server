import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import { bold, ok, fail, warn } from "./commands.js";
import { getZedSettingsPath, getZedConfigDir } from "../utils/pathUtils.js";

function getSettingsPath(): string {
  const home = os.homedir();
  return path.join(home, ".claude", "settings.json");
}

function getHooksDir(): string {
  const home = os.homedir();
  return path.join(home, ".claude", "hooks");
}

/**
 * Strict safe deep merge of hooks into existing settings.json
 * Idempotent: won't duplicate exact commands
 */
function mergeSettings(existingSettings: any): any {
  const merged = JSON.parse(JSON.stringify(existingSettings || {}));
  if (!merged.hooks) merged.hooks = {};
  if (!merged.permissions) merged.permissions = {};
  if (!merged.permissions.allow) merged.permissions.allow = [];
  if (!merged.permissions.additionalDirectories) merged.permissions.additionalDirectories = [];

  // Use native codeatlas CLI commands instead of bash scripts
  const brainContextCmd = "codeatlas brain-context";
  const taskRouterCmd = "codeatlas task-router";
  const brainSaveCmd = "codeatlas brain-save";

  function mergeCommandHook(event: string, command: string, matcher?: string): void {
    if (!Array.isArray(merged.hooks[event])) merged.hooks[event] = [];

    const groups = merged.hooks[event];
    let group = matcher === undefined
      ? groups.find((candidate: any) => !candidate?.matcher)
      : groups.find((candidate: any) => candidate?.matcher === matcher);

    if (!group) {
      group = matcher === undefined ? { hooks: [] } : { matcher, hooks: [] };
      groups.push(group);
    }
    if (!Array.isArray(group.hooks)) group.hooks = [];

    if (!group.hooks.some((hook: any) => hook?.type === "command" && hook?.command === command)) {
      group.hooks.push({ type: "command", command });
    }
  }

  // UserPromptSubmit has no matcher support. Hook stdout becomes context.
  mergeCommandHook("UserPromptSubmit", brainContextCmd);
  // Task routing output is informational only; Claude Code does not change model
  // from arbitrary hook stdout, but retain existing router behavior for consumers.
  mergeCommandHook("UserPromptSubmit", taskRouterCmd);

  // Save outcomes after successful and failed tool calls.
  mergeCommandHook("PostToolUse", brainSaveCmd, "*");
  mergeCommandHook("PostToolUseFailure", brainSaveCmd, "*");

  // Permissions
  const allowCmds = ["Bash(codeatlas --help)"];
  for (const cmd of allowCmds) {
    if (!merged.permissions.allow.includes(cmd)) {
      merged.permissions.allow.push(cmd);
    }
  }

  return merged;
}

export async function cmdSetupClaude(projectDir: string = process.cwd()): Promise<void> {
  console.log(`\n${bold("CodeAtlas Claude Integration Setup")}`);
  console.log("=".repeat(50));

  // 1. Verify codeatlas CLI is available
  console.log(`\n${bold("1. Verifying CodeAtlas CLI")}`);
  try {
    const { execSync } = await import("child_process");
    const version = execSync("codeatlas-enterprise --version", { encoding: "utf-8", timeout: 5000 }).trim();
    console.log(`  ${ok()} CodeAtlas CLI version: ${version}`);
  } catch (e: any) {
    console.log(`  ${warn()} CodeAtlas CLI not found globally. Using npx/local path.`);
  }

  // 2. Update ~/.claude/settings.json
  console.log(`\n${bold("2. Updating ~/.claude/settings.json")}`);
  const settingsPath = getSettingsPath();

  let existingSettings: any = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, "utf-8");
      existingSettings = JSON.parse(content || "{}");
    } catch (e: any) {
      console.log(`  ${warn()} Could not parse existing settings.json: ${e.message}`);
      console.log(`  ${warn()} Creating backup and merging default settings.`);
      // Create backup
      fs.writeFileSync(`${settingsPath}.bak-${Date.now()}`, fs.readFileSync(settingsPath, "utf-8"));
      existingSettings = {};
    }
  } else {
    console.log(`  ${warn()} ${settingsPath} not found — will create it.`);
  }

  try {
    const merged = mergeSettings(existingSettings);
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), "utf-8");
    console.log(`  ${ok()} Updated hooks in ${settingsPath}`);
    console.log(`  • UserPromptSubmit: codeatlas brain-context + task-router`);
    console.log(`  • PostToolUse: codeatlas brain-save (all tools)`);
    console.log(`  • PostToolUseFailure: codeatlas brain-save (all tools)`);
  } catch (e: any) {
    console.log(`  ${fail()} Failed to update settings.json: ${e.message}`);
    process.exit(1);
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
    args: ["-y", "codeatlas-mcp-server"],
    env,
  };

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  console.log(`  ${ok()} Registered context server in ${settingsPath}`);

  console.log("=".repeat(50));
  console.log(`\n${bold("Zed integration setup complete!")}`);
  console.log(`  Restart Zed for the context server to load.`);
  console.log(`  Then ask the AI to use 'brain_context' to load Second Brain memory.\n`);
}
