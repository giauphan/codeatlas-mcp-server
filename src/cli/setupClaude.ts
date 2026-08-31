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
 * Deep merge hooks into existing settings.json
 * Idempotent: won't duplicate exact commands
 */
function mergeSettings(existingSettings: any): any {
  const merged = { ...existingSettings };
  if (!merged.hooks) merged.hooks = {};
  if (!merged.permissions) merged.permissions = {};
  if (!merged.permissions.allow) merged.permissions.allow = [];
  if (!merged.permissions.additionalDirectories) merged.permissions.additionalDirectories = [];

  const home = os.homedir();
  const brainContextCmd = `${home}/.claude/hooks/brain-context.sh`;
  const taskRouterCmd = `${home}/.claude/hooks/task-router.sh`;
  const brainSaveCmd = `${home}/.claude/hooks/brain-save.sh`;

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

  // Migrate older installs that registered RTK without a Bash matcher.
  if (Array.isArray(merged.hooks.PreToolUse)) {
    for (const group of merged.hooks.PreToolUse) {
      if (Array.isArray(group?.hooks)) {
        group.hooks = group.hooks.filter((hook: any) =>
          !(hook?.type === "command" && hook?.command === "rtk hook claude"),
        );
      }
    }
  }
  // Let RTK rewrite Bash commands before execution.
  mergeCommandHook("PreToolUse", "rtk hook claude", "Bash");

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

  // 1. Copy hooks
  console.log(`\n${bold("1. Installing Claude Hooks")}`);
  const hooksDir = getHooksDir();
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // Try to find the hooks package dir (works in dev and prod/dist)
  let packageHooksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "hooks");
  if (!fs.existsSync(packageHooksDir)) {
    // Fallback for some TS-node environments where __dirname points differently
    packageHooksDir = path.join(process.cwd(), 'src', 'cli', 'hooks');
  }

  const hooks = ['brain-context.sh', 'brain-save.sh', 'task-router.sh'];
  let hooksCopied = 0;

  for (const hook of hooks) {
    const src = path.join(packageHooksDir, hook);
    const dst = path.join(hooksDir, hook);
    try {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        fs.chmodSync(dst, 0o755); // make executable
        hooksCopied++;
      } else {
        console.log(`  ${warn()} Hook source not found: ${src}`);
      }
    } catch (e: any) {
      console.log(`  ${fail()} Failed to install ${hook}: ${e.message}`);
    }
  }

  if (hooksCopied === hooks.length) {
    console.log(`  ${ok()} Installed ${hooksCopied} hooks in ${hooksDir}`);
  } else if (hooksCopied > 0) {
    console.log(`  ${warn()} Installed ${hooksCopied}/${hooks.length} hooks`);
  }

  // 2. Update ~/.claude/settings.json
  console.log(`\n${bold("2. Updating ~/.claude/settings.json")}`);
  const settingsPath = getSettingsPath();
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(raw);
      const merged = mergeSettings(settings);
      fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
      console.log(`  ${ok()} Hooks registered in settings.json`);
    } catch (e: any) {
      console.log(`  ${fail()} Failed to update settings.json: ${e.message}`);
    }
  } else {
    console.log(`  ${warn()} ${settingsPath} not found. Start Claude Code first.`);
  }

  // 3. Generate CLAUDE.md
  console.log(`\n${bold("3. Generating CLAUDE.md")}`);
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
  ctxServers.codeatlas = {
    command: "npx",
    args: ["-y", "codeatlas-mcp-server"],
    env,
  };

  fs.mkdirSync(getZedConfigDir(), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`  ${ok()} Registered 'codeatlas' context server in ${settingsPath}`);

  console.log("=".repeat(50));
  console.log(`\n${bold("Zed integration setup complete!")}`);
  console.log(`  Restart Zed for the context server to load.`);
  console.log(`  Then ask the AI to use 'brain_context' to load Second Brain memory.\n`);
}