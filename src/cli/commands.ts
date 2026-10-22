/**
 * CodeAtlas CLI — Setup, Doctor, and Init commands
 * 
 * Usage:
 *   codeatlas-enterprise init     # Interactive setup wizard
 *   codeatlas-enterprise setup    # Same as init
 *   codeatlas-enterprise doctor   # Health check & diagnostics
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as readline from "readline";
import { getResolvedApiKey } from "../services/projectService.js";
import { getApiUrl } from "../utils/envUtils.js";
import { checkSpawnResult } from "../utils/processUtils.js";
import { resolveExecutable } from "../utils/commandPath.js";
import { resolveProjectIdentity } from "../services/projectIdentity.js";
import {
  getHomePath,
  getHermesConfigPath,
  getHermesPluginDir,
  getZedSettingsPath,
  getClaudeConfigPath,
  getClaudeSettingsPath,
  getClaudeJsonPath,
  getClaudeDesktopConfigPath,
  getGeminiSettingsPath,
  getGeminiConfigPath,
  getCursorMcpPath,
  getClaudeHooksDir
} from "../utils/pathUtils.js";

export const API_URL = process.env.CODEATLAS_API_URL ?? "";

const CLI_COMMANDS = new Set([
  "init",
  "setup",
  "setup-hook",
  "setup-hooks",
  "validate-hook",
  "validate-hooks",
  "doctor",
  "brain-context",
  "brain-save",
  "task-router",
  "hook",
  "hooks",
  "update",
  "--help",
  "-h"
]);

export type CommandRoute = "cli" | "mcp" | "unknown";

export function classifyCommand(argv: string[]): CommandRoute {
  const cmd = argv[2];
  if (!cmd) return "mcp";
  if (CLI_COMMANDS.has(cmd)) return "cli";
  return cmd.startsWith("--") ? "mcp" : "unknown";
}

export interface NpmUpdateCommand {
  command: "npm";
  args: string[];
}

interface UpdateCommandResult {
  error?: Error;
  status: number | null;
  signal?: NodeJS.Signals | null;
  stderr?: string | Buffer | null;
}

type UpdateCommandRunner = (command: string, args: string[]) => UpdateCommandResult;

function parseSemver(version: string): [number, number, number] | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(left: string, right: string): -1 | 0 | 1 | null {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft || !parsedRight) return null;
  for (let index = 0; index < parsedLeft.length; index++) {
    if (parsedLeft[index] > parsedRight[index]) return 1;
    if (parsedLeft[index] < parsedRight[index]) return -1;
  }
  return 0;
}

function getInstalledPackageVersion(): string {
  const packagePaths = [
    fileURLToPath(new URL("../../../package.json", import.meta.url)),
    fileURLToPath(new URL("../../package.json", import.meta.url))
  ];
  for (const packagePath of packagePaths) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") {
        return parsed.version;
      }
    } catch {
      // Try the source-tree location when running in development.
    }
  }
  throw new Error("Unable to determine the installed CodeAtlas version.");
}

function getLatestPackageVersion(): string {
  const result = spawnSync("npm", ["view", "codeatlas-mcp-server@latest", "version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || typeof result.stdout !== "string") {
    throw new Error("Unable to look up the CodeAtlas npm latest version.");
  }
  return result.stdout.trim();
}

export function getNpmUpdateCommand(): NpmUpdateCommand {
  return { command: "npm", args: ["install", "--global", "codeatlas-mcp-server@latest"] };
}

export function runNpmUpdate(
  run: UpdateCommandRunner = (command, args) => spawnSync(command, args, { stdio: "inherit" }),
  getLatestVersion: () => string = getLatestPackageVersion,
  getInstalledVersion: () => string = getInstalledPackageVersion
): void {
  const installedVersion = getInstalledVersion();
  const latestVersion = getLatestVersion();
  const comparison = compareSemver(latestVersion, installedVersion);
  if (comparison === null) {
    throw new Error(`Refusing npm update because the version check is invalid (installed=${installedVersion}, latest=${latestVersion}).`);
  }
  if (comparison <= 0) {
    throw new Error(`The npm latest version (${latestVersion}) is not newer than installed CodeAtlas (${installedVersion}); refusing to downgrade.`);
  }
  const update = getNpmUpdateCommand();
  const result = run(update.command, update.args);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr ? `: ${result.stderr.toString().trim()}` : "";
    const reason = result.status === null
      ? `terminated by ${result.signal ?? "an unknown signal"}`
      : `exited with status ${result.status}`;
    throw new Error(`npm global update ${reason}${detail}`);
  }
}

/* ── Helpers ───────────────────────────────────────────────────── */

export function bold(s: string): string {
  return `\x1b[1m${s}\x1b[0m`;
}
export function green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`;
}
export function red(s: string): string {
  return `\x1b[31m${s}\x1b[0m`;
}
export function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[0m`;
}
export function ok(): string {
  return green("✓");
}
export function fail(): string {
  return red("✗");
}
export function warn(): string {
  return yellow("⚠");
}

export function ask(query: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (a) => { rl.close(); resolve(a.trim()); }));
}

export async function cloudFetch(method: string, path_: string, body?: any): Promise<{ ok: boolean; status: number; data: any }> {
  if (!process.env.CODEATLAS_API_URL) {
    return { ok: false, status: 0, data: { error: "CODEATLAS_API_URL not set" } };
  }
  const headers: Record<string, string> = {
    "User-Agent": "codeatlas-enterprise-cli/2.0",
    "Content-Type": "application/json",
  };
  const apiKey = getResolvedApiKey();
  if (apiKey) headers["x-api-key"] = apiKey;
  try {
    const url = `${getApiUrl()}${path_}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      redirect: "error",
    });
    clearTimeout(timeoutId);
    let data: any;
    try { data = await resp.json(); } catch { data = await resp.text(); }
    return { ok: resp.ok, status: resp.status, data };
  } catch (err: any) {
    if (err.name === "AbortError") return { ok: false, status: 0, data: { error: "Timeout" } };
    return { ok: false, status: 0, data: { error: err.message || "Network error" } };
  }
}

/* ── Diagnostic Helpers ─────────────────────────────────────────── */

export interface DiagnosticResult {
  status: "ok" | "warn" | "fail";
  detail?: string;
}

function hasCodeatlasServer(servers: any): boolean {
  if (!servers || typeof servers !== "object") return false;
  return Object.keys(servers).some(k => k.toLowerCase().includes("codeatlas"));
}

export function checkClaudeMcp(): DiagnosticResult {
  // Check ~/.claude/settings.json
  const settingsPath = getClaudeSettingsPath();
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (hasCodeatlasServer(settings?.mcpServers)) {
        return { status: "ok", detail: "configured in ~/.claude/settings.json" };
      }
    } catch {}
  }

  // Check ~/.claude.json
  const claudeJson = getClaudeJsonPath();
  if (fs.existsSync(claudeJson)) {
    try {
      const cl = JSON.parse(fs.readFileSync(claudeJson, "utf-8"));
      if (hasCodeatlasServer(cl?.mcpServers)) {
        return { status: "ok", detail: "configured in ~/.claude.json" };
      }
    } catch {}
  }

  // Check legacy ~/.claude/claude.json
  const legacyCfg = getClaudeConfigPath();
  if (fs.existsSync(legacyCfg)) {
    try {
      const cl = JSON.parse(fs.readFileSync(legacyCfg, "utf-8"));
      if (hasCodeatlasServer(cl?.mcpServers)) {
        return { status: "ok", detail: "configured in ~/.claude/claude.json" };
      }
    } catch {}
  }

  // Check Claude Desktop config
  const desktopCfg = getClaudeDesktopConfigPath();
  if (fs.existsSync(desktopCfg)) {
    try {
      const cl = JSON.parse(fs.readFileSync(desktopCfg, "utf-8"));
      if (hasCodeatlasServer(cl?.mcpServers)) {
        return { status: "ok", detail: "configured in Claude Desktop" };
      }
    } catch {}
  }

  return { status: "warn", detail: "not configured (run 'codeatlas setup claude')" };
}

export function checkClaudeHooks(): DiagnosticResult & { connected: string[]; missing: string[] } {
  const settingsPath = getClaudeSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return { status: "warn", detail: "settings.json not found", connected: [], missing: ["brain-context", "task-router", "brain-save"] };
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const hooks = settings?.hooks || {};

    const hasHook = (event: string, name: string) => {
      const eventHooks = hooks[event];
      if (!Array.isArray(eventHooks)) return false;
      return eventHooks.some((group: any) => {
        const list = Array.isArray(group?.hooks) ? group.hooks : [];
        return list.some((h: any) => {
          const cmd = typeof h?.command === "string" ? h.command : "";
          const args = Array.isArray(h?.args) ? h.args.join(" ") : "";
          const full = `${cmd} ${args}`.toLowerCase();
          return full.includes(name.toLowerCase());
        });
      });
    };

    const hasContext = hasHook("SessionStart", "brain-context") || hasHook("UserPromptSubmit", "brain-context");
    const hasRouter = hasHook("PreToolUse", "task-router") || hasHook("UserPromptSubmit", "task-router");
    const hasSave = hasHook("PostToolUse", "brain-save") || hasHook("PostToolUseFailure", "brain-save");

    const connected: string[] = [];
    const missing: string[] = [];

    if (hasContext) connected.push("brain-context"); else missing.push("brain-context");
    if (hasRouter) connected.push("task-router"); else missing.push("task-router");
    if (hasSave) connected.push("brain-save"); else missing.push("brain-save");

    if (missing.length === 0) {
      return { status: "ok", detail: `connected (${connected.join(", ")})`, connected, missing };
    }
    if (connected.length > 0) {
      return { status: "warn", detail: `partially connected (active: ${connected.join(", ")}; missing: ${missing.join(", ")})`, connected, missing };
    }
    return { status: "warn", detail: "not installed (run 'codeatlas setup claude')", connected, missing };
  } catch (err: any) {
    return { status: "fail", detail: `error reading settings: ${err.message}`, connected: [], missing: ["brain-context", "task-router", "brain-save"] };
  }
}

const CLAUDE_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PostToolUseFailure", "Stop", "PreCompact"] as const;
type ClaudeHookEventKey = typeof CLAUDE_HOOK_EVENTS[number];

export function summarizeClaudeHookRoutes(settings: unknown): Record<ClaudeHookEventKey, string[]> {
  const root = settings && typeof settings === "object" ? settings as Record<string, any> : {};
  const hooks = root.hooks && typeof root.hooks === "object" ? root.hooks as Record<string, unknown> : {};
  const summary = {} as Record<ClaudeHookEventKey, string[]>;

  for (const eventName of CLAUDE_HOOK_EVENTS) {
    const groups = Array.isArray(hooks[eventName]) ? hooks[eventName] as unknown[] : [];
    const routes = new Set<string>();
    for (const group of groups) {
      const hooksList = Array.isArray((group as any)?.hooks) ? (group as any).hooks : [group];
      for (const hook of hooksList) {
        const command = typeof (hook as any)?.command === "string" ? (hook as any).command : typeof hook === "string" ? hook : "";
        const args = Array.isArray((hook as any)?.args) ? (hook as any).args.filter((arg: unknown) => typeof arg === "string") as string[] : [];
        const routeText = [command, ...args].join(" ");
        const hookName = ["brain-context", "brain-save", "task-router"].find((name) => routeText.includes(name));
        const packagedNative = /[\\/]index\.js["']?\s+hook\s+(?:brain-context|brain-save|task-router)\s*$/.test(routeText);
        if (!hookName || (!packagedNative && !/codeatlas|brain-(?:context|save)\.sh|task-router\.sh/i.test(routeText))) continue;
        const implementation = packagedNative || /^codeatlas(?:-enterprise|-mcp)?(?:\s|$)/i.test(command) ? "native_cli" : command.endsWith(".sh") ? "shell_script" : "external";
        routes.add(`${implementation}:${hookName}`);
      }
    }
    summary[eventName] = [...routes].sort((left, right) => left.localeCompare(right));
  }
  return summary;
}

export interface MemoryPipelineRuntimeDiagnostics {
  gitCommit: string;
  nodeVersion: string;
  packageVersion: string;
  cliEntryPath: string;
  cliEntrySha256: string;
  builtCliPath: string;
  builtCliSha256: string;
  pathCommand: string;
  pathCommandRealpath: string;
  pathCommandSha256: string;
}

function sha256File(filePath: string): string {
  try {
    return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return "unavailable";
  }
}

export function getMemoryPipelineRuntimeDiagnostics(): MemoryPipelineRuntimeDiagnostics {
  const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "unavailable";
  let packagePath = "";
  let searchDir = entryPath === "unavailable" ? process.cwd() : path.dirname(entryPath);
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(searchDir, "package.json");
    if (fs.existsSync(candidate)) {
      try {
        if (JSON.parse(fs.readFileSync(candidate, "utf8")).name === "codeatlas-mcp-server") {
          packagePath = candidate;
          break;
        }
      } catch { /* continue searching parent directories */ }
    }
    const parent = path.dirname(searchDir);
    if (parent === searchDir) break;
    searchDir = parent;
  }
  let packageVersion = "unknown";
  if (packagePath) {
    try { packageVersion = JSON.parse(fs.readFileSync(packagePath, "utf8")).version ?? "unknown"; } catch { /* keep unknown */ }
  }

  let pathCommand = "unavailable";
  try { pathCommand = resolveExecutable("codeatlas"); } catch { /* CLI is not installed on PATH. */ }
  let pathCommandRealpath = "unavailable";
  if (pathCommand !== "unavailable") {
    try { pathCommandRealpath = fs.realpathSync(pathCommand); } catch { pathCommandRealpath = pathCommand; }
  }
  const builtCliPath = packagePath ? path.join(path.dirname(packagePath), "dist", "index.js") : "unavailable";
  let gitResult: ReturnType<typeof spawnSync> | undefined;
  if (packagePath) {
    try { gitResult = spawnSync(resolveExecutable("git"), ["-C", path.dirname(packagePath), "rev-parse", "--short", "HEAD"], { encoding: "utf8", timeout: 1_000 }); }
    catch { /* Git is not installed on PATH. */ }
  }

  return {
    gitCommit: gitResult?.status === 0 ? String(gitResult.stdout).trim() : "unavailable",
    nodeVersion: process.version,
    packageVersion,
    cliEntryPath: entryPath,
    cliEntrySha256: entryPath === "unavailable" ? "unavailable" : sha256File(entryPath),
    builtCliPath,
    builtCliSha256: builtCliPath === "unavailable" ? "unavailable" : sha256File(builtCliPath),
    pathCommand,
    pathCommandRealpath,
    pathCommandSha256: pathCommandRealpath === "unavailable" ? "unavailable" : sha256File(pathCommandRealpath),
  };
}

export function readMemoryPipelineOutcomes(): { save: string; load: string; trace_id?: string } {
  const tracePath = path.join(os.homedir(), ".codeatlas", "memory-pipeline-events.jsonl");
  const latest: { save: string; load: string; trace_id?: string } = { save: "unknown", load: "unknown" };
  try {
    const lines = fs.readFileSync(tracePath, "utf8").trim().split("\n").slice(-200);
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        const statuses = new Set(["acknowledged", "queued", "filtered", "skipped_empty", "invalid_payload", "unsupported_event", "unavailable", "empty", "suppressed", "injected", "error"]);
        if (record?.kind === "save" && statuses.has(record.status)) latest.save = record.status;
        if (record?.kind === "load" && statuses.has(record.status)) {
          latest.load = record.status;
          if (typeof record.trace_id === "string" && /^[A-Za-z0-9._:-]{1,255}$/.test(record.trace_id)) latest.trace_id = record.trace_id;
        }
      } catch { /* ignore malformed trace records */ }
    }
  } catch { /* no local outcome history */ }
  return latest;
}

export function readMemoryPipelineMetrics(): { capture_received: number; bootstrap_attempt: number; injected: number; readable: number; observations: number } {
  const metrics = { capture_received: 0, bootstrap_attempt: 0, injected: 0, readable: 0, observations: 0 };
  const tracePath = path.join(os.homedir(), ".codeatlas", "memory-pipeline-events.jsonl");
  try {
    const lines = fs.readFileSync(tracePath, "utf8").trim().split("\n").slice(-200);
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (!record || typeof record !== "object" || Array.isArray(record)) continue;
        metrics.observations++;
        for (const key of ["capture_received", "bootstrap_attempt", "injected", "readable"] as const) {
          if (record[key] === true) metrics[key]++;
        }
      } catch { /* ignore malformed trace records */ }
    }
  } catch { /* no local outcome history */ }
  return metrics;
}

export function getHooksDoctorJson(): Record<string, unknown> {
  const settingsPath = getClaudeSettingsPath();
  let settings: unknown = null;
  try { if (fs.existsSync(settingsPath)) settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { /* safely report unavailable */ }
  const routes = summarizeClaudeHookRoutes(settings);
  const routeValues = Object.values(routes).flat();
  const contextRegistered = routeValues.some((route) => route.endsWith(":brain-context"));
  const captureRegistered = routeValues.some((route) => route.endsWith(":brain-save"));
  const runtime = getMemoryPipelineRuntimeDiagnostics();
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let identity: Record<string, unknown> = { status: "unavailable" };
  try {
    // The canonical root stays local; diagnostics expose only its stable identifier and derivation source.
    const resolved = resolveProjectIdentity(cwd);
    identity = { status: "resolved", project_id: resolved.project_id, source: resolved.identity_source };
  } catch { /* report identity unavailable without exposing paths */ }
  return {
    schema_version: 1,
    hooks: {
      configured: contextRegistered && captureRegistered,
      context_registered: contextRegistered,
      capture_registered: captureRegistered,
      available: runtime.pathCommandRealpath !== "unavailable",
      resolved_command_path: runtime.pathCommandRealpath,
      registration: routes,
    },
    endpoint: { url_present: Boolean(process.env.CODEATLAS_API_URL), key_present: Boolean(getResolvedApiKey()) },
    project_identity: identity,
    last_outcomes: readMemoryPipelineOutcomes(),
    pipeline_metrics: readMemoryPipelineMetrics(),
  };
}

export type AgentKind = "claude" | "codex" | "agents" | "gemini" | "cursor" | "generic";
export interface AgentInfo { kind: AgentKind; label: string; ruleFile: string | null; rulePresent: boolean; }
export interface CodeatlasSetupInfo {
  skills: { count: number; hasCodeatlas: boolean };
  rules: { count: number; hasCodeatlas: boolean };
  agents: { count: number };
  ruleFile: { path: string | null; present: boolean; agent: AgentKind };
}
export interface ProjectDirEntry { dir: string; name: string; isGit: boolean; branch?: string; codeatlasSetup: CodeatlasSetupInfo }

export function detectActiveAgent(projectDir: string): AgentInfo {
  // Which AI is in use? Check env + installed binaries + rule files
  const hasClaude = Boolean(process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT || process.env.ANTHROPIC_API_KEY || fs.existsSync(path.join(os.homedir(), ".claude", "settings.json")));
  const hasCodex = Boolean(process.env.CODEX_HOME || fs.existsSync(path.join(os.homedir(), ".codex", "config.toml")) || fs.existsSync(path.join(projectDir, "codex.md")) || fs.existsSync(path.join(projectDir, "CODEX.md")));
  const hasGemini = Boolean(process.env.GEMINI_API_KEY || fs.existsSync(path.join(os.homedir(), ".gemini", "settings.json")));
  // Pick based on strongest signal: explicit md files win, else env
  const hasClaudeMd = fs.existsSync(path.join(projectDir, "CLAUDE.md")) || fs.existsSync(path.join(projectDir, ".claude", "CLAUDE.md"));
  const hasCodexMd = fs.existsSync(path.join(projectDir, "codex.md")) || fs.existsSync(path.join(projectDir, "CODEX.md"));
  const hasAgentsMd = fs.existsSync(path.join(projectDir, "AGENTS.md")) || fs.existsSync(path.join(projectDir, ".agents", "AGENTS.md"));
  if (hasClaudeMd || (hasClaude && !hasCodexMd && !hasAgentsMd)) {
    const f = fs.existsSync(path.join(projectDir, "CLAUDE.md")) ? path.join(projectDir, "CLAUDE.md") : fs.existsSync(path.join(projectDir, ".claude", "CLAUDE.md")) ? path.join(projectDir, ".claude", "CLAUDE.md") : null;
    return { kind: "claude", label: "Claude Code", ruleFile: f, rulePresent: Boolean(f) };
  }
  if (hasCodexMd) {
    const f = fs.existsSync(path.join(projectDir, "codex.md")) ? path.join(projectDir, "codex.md") : path.join(projectDir, "CODEX.md");
    return { kind: "codex", label: "Codex", ruleFile: f, rulePresent: true };
  }
  if (hasAgentsMd) {
    const f = fs.existsSync(path.join(projectDir, "AGENTS.md")) ? path.join(projectDir, "AGENTS.md") : path.join(projectDir, ".agents", "AGENTS.md");
    return { kind: "agents", label: "AGENTS.md (generic)", ruleFile: f, rulePresent: true };
  }
  if (hasCodex) return { kind: "codex", label: "Codex", ruleFile: null, rulePresent: false };
  if (hasGemini) return { kind: "gemini", label: "Gemini CLI", ruleFile: null, rulePresent: false };
  return { kind: "generic", label: "Unknown / generic", ruleFile: null, rulePresent: false };
}

export function checkCodeatlasSetup(projectDir: string): CodeatlasSetupInfo {
  const skillsDir = path.join(projectDir, ".agents", "skills");
  const claudeSkillsDir = path.join(projectDir, ".claude", "skills");
  let skillCount = 0; let hasCodeatlasSkill = false;
  for (const d of [skillsDir, claudeSkillsDir]) {
    if (!fs.existsSync(d)) continue;
    try { const e = fs.readdirSync(d); skillCount += e.length; if (e.some((x: string) => x.toLowerCase().includes("codeatlas"))) hasCodeatlasSkill = true; } catch {}
  }
  // Also count home skills as fallback hint
  if (skillCount === 0) {
    for (const d of [path.join(os.homedir(), ".agents", "skills"), path.join(os.homedir(), ".claude", "skills")]) {
      if (!fs.existsSync(d)) continue;
      try { const e = fs.readdirSync(d); if (e.some((x: string) => x.toLowerCase().includes("codeatlas"))) hasCodeatlasSkill = true; } catch {}
    }
  }
  const rulesDir = path.join(projectDir, ".agents", "rules");
  let ruleCount = 0; let hasCodeatlasRule = false;
  if (fs.existsSync(rulesDir)) {
    try { const e = fs.readdirSync(rulesDir); ruleCount = e.length; hasCodeatlasRule = e.some((x: string) => x.toLowerCase().includes("codeatlas")); } catch {}
  }
  const agentsDir = path.join(projectDir, ".claude", "agents");
  let agentCount = 0;
  if (fs.existsSync(agentsDir)) { try { agentCount = fs.readdirSync(agentsDir).filter((x: string) => x.endsWith(".md")).length; } catch {} }
  // Alternative agent location
  const agentsDir2 = path.join(projectDir, ".agents", "agents");
  if (agentCount === 0 && fs.existsSync(agentsDir2)) { try { agentCount = fs.readdirSync(agentsDir2).filter((x: string) => x.endsWith(".md")).length; } catch {} }

  // Rule file per active agent
  const agent = detectActiveAgent(projectDir);
  let rulePath: string | null = null; let rulePresent = false;
  if (agent.kind === "claude") {
    rulePath = fs.existsSync(path.join(projectDir, "CLAUDE.md")) ? "CLAUDE.md" : fs.existsSync(path.join(projectDir, ".claude", "CLAUDE.md")) ? ".claude/CLAUDE.md" : "CLAUDE.md";
    rulePresent = agent.rulePresent;
  } else if (agent.kind === "codex") {
    rulePath = fs.existsSync(path.join(projectDir, "codex.md")) ? "codex.md" : fs.existsSync(path.join(projectDir, "CODEX.md")) ? "CODEX.md" : "codex.md";
    rulePresent = fs.existsSync(path.join(projectDir, "codex.md")) || fs.existsSync(path.join(projectDir, "CODEX.md"));
  } else if (agent.kind === "agents") {
    rulePath = fs.existsSync(path.join(projectDir, "AGENTS.md")) ? "AGENTS.md" : ".agents/AGENTS.md";
    rulePresent = agent.rulePresent;
  } else {
    // generic: check all
    if (fs.existsSync(path.join(projectDir, "CLAUDE.md"))) { rulePath = "CLAUDE.md"; rulePresent = true; }
    else if (fs.existsSync(path.join(projectDir, "AGENTS.md"))) { rulePath = "AGENTS.md"; rulePresent = true; }
    else if (fs.existsSync(path.join(projectDir, "codex.md"))) { rulePath = "codex.md"; rulePresent = true; }
    else { rulePath = "CLAUDE.md / AGENTS.md / codex.md"; rulePresent = false; }
  }

  return {
    skills: { count: skillCount, hasCodeatlas: hasCodeatlasSkill },
    rules: { count: ruleCount, hasCodeatlas: hasCodeatlasRule },
    agents: { count: agentCount },
    ruleFile: { path: rulePath, present: rulePresent, agent: agent.kind }
  };
}

export function listProjectDirs(): { connected: ProjectDirEntry[]; newDirs: ProjectDirEntry[] } {
  const raw = process.env.CODEATLAS_PROJECT_DIRS || process.env.CODEATLAS_PROJECT_DIR || "";
  const connectedSet = new Set(raw.split(",").map(s => s.trim()).filter(Boolean).map(s => path.resolve(s)));
  // Always include cwd as connected if it's a git project
  const cwd = path.resolve(process.cwd());
  if (fs.existsSync(path.join(cwd, ".git")) || fs.existsSync(path.join(cwd, "package.json"))) connectedSet.add(cwd);

  const scanRoots = [path.join(os.homedir(), "")];
  const candidates: string[] = [];
  // Discover sibling git projects under $HOME (max depth 1, cheap)
  try {
    for (const e of fs.readdirSync(os.homedir(), { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const full = path.join(os.homedir(), e.name);
      if (fs.existsSync(path.join(full, ".git")) || fs.existsSync(path.join(full, "package.json"))) candidates.push(full);
      if (candidates.length >= 30) break;
    }
  } catch {}

  function toEntry(dir: string): ProjectDirEntry {
    let isGit = fs.existsSync(path.join(dir, ".git"));
    let branch: string | undefined;
    if (isGit) {
      try {
        const h = fs.readFileSync(path.join(dir, ".git", "HEAD"), "utf-8").trim();
        branch = h.startsWith("ref: refs/heads/") ? h.replace("ref: refs/heads/", "") : h.slice(0, 7);
      } catch {}
    }
    return { dir, name: path.basename(dir), isGit, branch, codeatlasSetup: checkCodeatlasSetup(dir) };
  }

  const connected: ProjectDirEntry[] = [...connectedSet].filter(d => fs.existsSync(d)).map(toEntry);
  const newDirs: ProjectDirEntry[] = candidates.filter(c => !connectedSet.has(path.resolve(c))).map(toEntry);
  return { connected, newDirs };
}

export function checkProjectDir(customDir?: string): {
  status: "ok" | "warn";
  detail: string;
  projectDir: string;
  projectName: string;
  isGit: boolean;
  branch?: string;
  hasClaudeMd: boolean;
  hasLocalMemory: boolean;
  stack?: string;
} {
  const projectDir = path.resolve(customDir || process.env.CODEATLAS_PROJECT_DIR || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH || process.cwd());
  const projectName = path.basename(projectDir);

  // Git detection
  let isGit = false;
  let branch: string | undefined;
  const gitDir = path.join(projectDir, ".git");
  if (fs.existsSync(gitDir)) {
    isGit = true;
    try {
      const headPath = path.join(gitDir, "HEAD");
      if (fs.existsSync(headPath)) {
        const headContent = fs.readFileSync(headPath, "utf-8").trim();
        if (headContent.startsWith("ref: refs/heads/")) {
          branch = headContent.replace("ref: refs/heads/", "");
        } else {
          branch = headContent.slice(0, 7);
        }
      }
    } catch {}
  }

  // CLAUDE.md detection
  const claudeMdPath = path.join(projectDir, "CLAUDE.md");
  const dotClaudeMdPath = path.join(projectDir, ".claude", "CLAUDE.md");
  const hasClaudeMd = fs.existsSync(claudeMdPath) || fs.existsSync(dotClaudeMdPath);

  // Local CodeAtlas memory detection
  const hasLocalCodeatlas = fs.existsSync(path.join(projectDir, ".codeatlas"));
  const hasAgentMemory = fs.existsSync(path.join(projectDir, ".agents", "memory"));
  const hasLocalMemory = hasLocalCodeatlas || hasAgentMemory;

  // Stack detection
  let stack = "Generic";
  if (fs.existsSync(path.join(projectDir, "package.json"))) {
    stack = fs.existsSync(path.join(projectDir, "tsconfig.json")) ? "TypeScript/Node" : "JavaScript/Node";
  } else if (fs.existsSync(path.join(projectDir, "pyproject.toml")) || fs.existsSync(path.join(projectDir, "requirements.txt"))) {
    stack = "Python";
  } else if (fs.existsSync(path.join(projectDir, "composer.json"))) {
    stack = "PHP";
  } else if (fs.existsSync(path.join(projectDir, "Cargo.toml"))) {
    stack = "Rust";
  } else if (fs.existsSync(path.join(projectDir, "go.mod"))) {
    stack = "Go";
  }

  const details: string[] = [projectName];
  if (isGit) details.push(`git:${branch || "yes"}`);
  if (stack) details.push(stack);
  if (hasClaudeMd) details.push("CLAUDE.md ✓");
  if (hasLocalMemory) details.push("memory: active");

  return {
    status: isGit || hasClaudeMd || fs.existsSync(projectDir) ? "ok" : "warn",
    detail: `${projectDir} [${details.join(", ")}]`,
    projectDir,
    projectName,
    isGit,
    branch,
    hasClaudeMd,
    hasLocalMemory,
    stack
  };
}

export function checkFeaturesDiff(): {
  astParsers: string[];
  adrCount: number;
  localMode: boolean;
  cloudSync: boolean;
  connectedClients: string[];
} {
  const home = os.homedir();
  const adrDir = path.join(home, ".codeatlas", "adr");
  let adrCount = 0;
  if (fs.existsSync(adrDir)) {
    try {
      const entries = fs.readdirSync(adrDir, { recursive: true });
      adrCount = entries.filter((e: any) => typeof e === "string" && e.endsWith(".md")).length;
    } catch {}
  }

  const connectedClients: string[] = [];
  if (checkClaudeMcp().status === "ok") connectedClients.push("Claude Code");
  if (fs.existsSync(getHermesConfigPath()) && fs.readFileSync(getHermesConfigPath(), "utf-8").includes("codeatlas:")) {
    connectedClients.push("Hermes");
  }
  const zedCfg = getZedSettingsPath();
  if (fs.existsSync(zedCfg)) {
    try {
      const z = JSON.parse(fs.readFileSync(zedCfg, "utf-8"));
      if (z?.context_servers?.codeatlas || z?.context_servers?.["codeatlas-mcp-server"]) {
        connectedClients.push("Zed");
      }
    } catch {}
  }
  const geminiPath = getGeminiSettingsPath();
  if (fs.existsSync(geminiPath)) {
    try {
      const g = JSON.parse(fs.readFileSync(geminiPath, "utf-8"));
      if (g?.mcpServers?.codeatlas || g?.contextFileName) {
        connectedClients.push("Gemini CLI");
      }
    } catch {}
  }

  return {
    astParsers: ["TypeScript", "JavaScript", "Python", "PHP"],
    adrCount,
    localMode: !process.env.CODEATLAS_API_URL,
    cloudSync: Boolean(process.env.CODEATLAS_API_URL && getResolvedApiKey()),
    connectedClients
  };
}

import {
  stepAuthenticate,
  stepConnectProject,
  stepEnableSecondBrain,
  stepInitializeServices,
  stepVerifySync,
  stepHealthCheck
} from "./steps.js";
import { cmdSetupClaude, cmdSetupZed } from "./setupClaude.js";
import { decodeClaudeHookEvent } from "./hooks/eventDecoder.js";

/* ── CLI Commands ───────────────────────────────────────────────── */

export async function cmdSetup(): Promise<void> {
  console.log();
  console.log(bold("╔══════════════════════════════════════════════════╗"));
  console.log(bold("║   CodeAtlas Second Brain Setup Wizard           ║"));
  console.log(bold("╚══════════════════════════════════════════════════╝"));
  console.log(`  Cloud: ${API_URL || "(local mode)"}`);

  const s1 = await stepAuthenticate();
  if (!s1) {
    console.log(`\n${red("Setup failed at Step 1. Check your API key.")}`);
    process.exit(1);
  }

  const project = await stepConnectProject();
  const s3 = await stepEnableSecondBrain(project);
  if (!s3) {
    console.log(`\n${red("Setup failed at Step 3.")}`);
    process.exit(1);
  }

  await stepInitializeServices(project);
  await stepVerifySync();
  await stepHealthCheck();

  console.log(`\n${bold("🎉 Second Brain setup complete!")}`);
  console.log(`  ${ok()} Project: ${project}`);
  console.log(`  ${ok()} Cloud: ${API_URL || "(local mode)"}`);
  console.log(`  ${ok()} Config: ~/.hermes/config.yaml`);
  console.log(`  ${ok()} Plugin: ~/.hermes/plugins/codeatlas_second_brain/`);
  console.log(`\n  ${bold("Next steps:")}`);
  console.log(`  1. Restart your MCP client (Hermes: /restart)`);
  console.log(`  2. Ask: "Continue my project"`);
  console.log(`     → AI automatically retrieves Dreams + DNA + Immune`);
}

export async function cmdDoctor(): Promise<void> {
  if (process.argv[3] === "hooks" && process.argv[4] === "--json") {
    const diagnostics = getHooksDoctorJson();
    process.stdout.write(`${JSON.stringify(diagnostics)}\n`);
    return;
  }
  console.log(`\n${bold("CodeAtlas Second Brain — Health Check & Diagnostics")}`);
  console.log("=".repeat(60));

  let passed = 0;
  let total = 0;

  const countCheck = (status: "ok" | "warn" | "fail") => {
    total++;
    if (status === "ok") passed++;
  };

  // 1. Project & Workspace — flow: connected dirs vs new dirs + CodeAtlas setup completeness + AI-aware rule file
  console.log(`\n${bold("1. Project & Workspace")}`);
  const proj = checkProjectDir();
  console.log(`  ${proj.status === "ok" ? ok() : warn()} Directory: ${proj.projectDir}`);
  countCheck(proj.status);

  console.log(`  ${proj.isGit ? ok() : warn()} Git Repository: ${proj.isGit ? `Active (branch: ${proj.branch || "unknown"})` : "Not a git repository"}`);
  countCheck(proj.isGit ? "ok" : "warn");

  const agent = detectActiveAgent(proj.projectDir);
  const setup = checkCodeatlasSetup(proj.projectDir);
  const ruleLabel = setup.ruleFile.path || "CLAUDE.md / AGENTS.md / codex.md";
  const ruleOk = setup.ruleFile.present;
  console.log(`  ${ruleOk ? ok() : warn()} Project Rules (${agent.label}): ${ruleOk ? `${ruleLabel} present` : `${ruleLabel} missing (run 'codeatlas setup ${agent.kind === "codex" ? "codex" : agent.kind === "agents" ? "agents" : "claude"}')`}`);
  countCheck(ruleOk ? "ok" : "warn");

  console.log(`  ${proj.hasLocalMemory ? ok() : ok()} Local Memory: ${proj.hasLocalMemory ? "CodeAtlas memory indexed" : "Standard workspace"}`);
  countCheck("ok");

  const skillLabel = setup.skills.hasCodeatlas ? `CodeAtlas skills ready (${setup.skills.count})` : setup.skills.count > 0 ? `${setup.skills.count} skills (CodeAtlas skill missing)` : "No project skills (global: " + (setup.skills.hasCodeatlas ? "CodeAtlas present" : "missing") + ")";
  console.log(`  ${setup.skills.hasCodeatlas ? ok() : warn()} Skills: ${skillLabel}`);
  countCheck(setup.skills.hasCodeatlas ? "ok" : "warn");

  console.log(`  ${setup.rules.hasCodeatlas ? ok() : setup.rules.count > 0 ? warn() : warn()} Rules: ${setup.rules.count > 0 ? `${setup.rules.count} rule(s)${setup.rules.hasCodeatlas ? " (CodeAtlas present)" : " (CodeAtlas rule missing)"}` : "No .agents/rules"}`);
  countCheck(setup.rules.hasCodeatlas ? "ok" : "warn");

  console.log(`  ${setup.agents.count > 0 ? ok() : warn()} Agents: ${setup.agents.count > 0 ? `${setup.agents.count} agent(s) in .claude/agents` : "No project agents"}`);
  countCheck(setup.agents.count > 0 ? "ok" : "warn");

  console.log(`  ${ok()} Which AI: ${agent.label} ${agent.ruleFile ? `(${agent.ruleFile})` : "(no rule file)"}`);
  countCheck("ok");

  // Connected vs new project dirs — the flow
  const dirs = listProjectDirs();
  if (dirs.connected.length > 0) {
    console.log(`\n  ${bold("Connected project dirs")} (${dirs.connected.length}):`);
    for (const e of dirs.connected.slice(0, 12)) {
      const s = e.codeatlasSetup;
      const tag = s.skills.hasCodeatlas && s.rules.hasCodeatlas && s.ruleFile.present ? ok() : warn();
      console.log(`    ${tag} ${e.name} — ${e.dir}${e.isGit ? ` [${e.branch || "git"}]` : ""}  skills:${s.skills.count} rules:${s.rules.count} agents:${s.agents.count}`);
    }
    if (dirs.connected.length > 12) console.log(`    … +${dirs.connected.length - 12} more`);
  } else {
    console.log(`  ${warn()} No connected project dirs (set CODEATLAS_PROJECT_DIRS)`);
    countCheck("warn");
  }
  if (dirs.newDirs.length > 0) {
    console.log(`\n  ${bold("New / unconnected dirs")} (${dirs.newDirs.length}):`);
    for (const e of dirs.newDirs.slice(0, 12)) {
      console.log(`    ${warn()} ${e.name} — ${e.dir}${e.isGit ? ` [${e.branch || "git"}]` : ""}`);
    }
    if (dirs.newDirs.length > 12) console.log(`    … +${dirs.newDirs.length - 12} more`);
    console.log(`    ${yellow("Tip:")} add to CODEATLAS_PROJECT_DIRS or run 'codeatlas init' in that dir`);
  }

  // 2. MCP Client Integrations
  console.log(`\n${bold("2. MCP Client Integrations")}`);
  const claudeMcp = checkClaudeMcp();
  console.log(`  ${claudeMcp.status === "ok" ? ok() : warn()} Claude Code MCP: ${claudeMcp.detail}`);
  countCheck(claudeMcp.status);

  const hermesCfg = getHermesConfigPath();
  const hermesMcp = fs.existsSync(hermesCfg) && fs.readFileSync(hermesCfg, "utf-8").includes("codeatlas:");
  console.log(`  ${hermesMcp ? ok() : warn()} Hermes MCP: ${hermesMcp ? "configured" : (fs.existsSync(hermesCfg) ? "not configured" : "not found")}`);
  countCheck(hermesMcp ? "ok" : "warn");

  const zedCfg = getZedSettingsPath();
  let zedMcp = false;
  if (fs.existsSync(zedCfg)) {
    try {
      const z = JSON.parse(fs.readFileSync(zedCfg, "utf-8"));
      zedMcp = Boolean(z?.context_servers?.codeatlas || z?.context_servers?.["codeatlas-mcp-server"]);
    } catch {}
  }
  console.log(`  ${zedMcp ? ok() : warn()} Zed MCP: ${zedMcp ? "configured" : (fs.existsSync(zedCfg) ? "not configured" : "not found")}`);
  countCheck(zedMcp ? "ok" : "warn");

  const geminiCfg = getGeminiSettingsPath();
  let geminiMcp = false;
  if (fs.existsSync(geminiCfg)) {
    try {
      const g = JSON.parse(fs.readFileSync(geminiCfg, "utf-8"));
      geminiMcp = Boolean(g?.mcpServers?.codeatlas || g?.contextFileName);
    } catch {}
  }
  console.log(`  ${geminiMcp ? ok() : warn()} Gemini CLI MCP: ${geminiMcp ? "configured" : (fs.existsSync(geminiCfg) ? "not configured" : "not found")}`);
  countCheck(geminiMcp ? "ok" : "warn");

  // 3. Hooks & Automation Status
  console.log(`\n${bold("3. Hooks & Automation Status")}`);
  const claudeHooks = checkClaudeHooks();
  console.log(`  ${claudeHooks.status === "ok" ? ok() : warn()} Claude Code Hooks: ${claudeHooks.detail}`);
  countCheck(claudeHooks.status);
  let hookSettings: unknown = null;
  try {
    const hookSettingsPath = getClaudeSettingsPath();
    if (fs.existsSync(hookSettingsPath)) hookSettings = JSON.parse(fs.readFileSync(hookSettingsPath, "utf8"));
  } catch { /* report empty routes below; checkClaudeHooks includes parse status */ }
  const hookRoutes = summarizeClaudeHookRoutes(hookSettings);
  for (const [eventName, routes] of Object.entries(hookRoutes)) {
    if (routes.length > 0) console.log(`    ${eventName}: ${routes.join(", ")}`);
  }
  const runtime = getMemoryPipelineRuntimeDiagnostics();
  console.log(`  Memory pipeline runtime: git=${runtime.gitCommit} node=${runtime.nodeVersion} package=${runtime.packageVersion}`);
  console.log(`    CLI entry: ${runtime.cliEntryPath} sha256=${runtime.cliEntrySha256}`);
  console.log(`    Built CLI: ${runtime.builtCliPath} sha256=${runtime.builtCliSha256}`);
  console.log(`    PATH codeatlas: ${runtime.pathCommand} realpath=${runtime.pathCommandRealpath} sha256=${runtime.pathCommandSha256}`);

  const hermesPluginPath = path.join(getHermesPluginDir(), "__init__.py");
  const hermesPlugin = fs.existsSync(hermesPluginPath);
  console.log(`  ${hermesPlugin ? ok() : warn()} Hermes Auto-Plugin: ${hermesPlugin ? "installed" : "not installed"}`);
  countCheck(hermesPlugin ? "ok" : "warn");

  // 4. Environment & Cloud Services
  console.log(`\n${bold("4. Environment & Cloud Services")}`);
  const hasApiKey = Boolean(getResolvedApiKey());
  console.log(`  ${hasApiKey ? ok() : warn()} CODEATLAS_API_KEY: ${hasApiKey ? "Set" : "not set (local mode only)"}`);
  countCheck(hasApiKey ? "ok" : "warn");

  if (API_URL) {
    const r = await cloudFetch("GET", "/api/version");
    if (r.ok) {
      console.log(`  ${ok()} Cloud Connection: ${API_URL} (build ${r.data?.version || "?"})`);
      countCheck("ok");
    } else {
      console.log(`  ${r.status === 401 || r.status === 403 ? fail() : warn()} Cloud Connection: ${API_URL} (HTTP ${r.status})`);
      countCheck(r.status === 401 || r.status === 403 ? "fail" : "warn");
    }

    const d = await cloudFetch("GET", "/api/dreams/query?query=test&project=hermes-auto&limit=3");
    console.log(`  ${d.ok ? ok() : warn()} Dream Persistence: ${d.ok ? `${d.data?.memories?.length || 0} memories found` : "network unavailable"}`);
    countCheck(d.ok ? "ok" : "warn");

    const g = await cloudFetch("GET", "/api/genome/search?query=test&limit=3");
    console.log(`  ${g.ok ? ok() : warn()} Genome (DNA): ${g.ok ? `${g.data?.genes?.length || 0} genes found` : "network unavailable"}`);
    countCheck(g.ok ? "ok" : "warn");

    const im = await cloudFetch("GET", "/api/genome/immune?problem=test&limit=3");
    console.log(`  ${im.ok ? ok() : warn()} Immune System: ${im.ok ? `${im.data?.genes?.length || 0} immune genes found` : "network unavailable"}`);
    countCheck(im.ok ? "ok" : "warn");
  } else {
    console.log(`  ${ok()} Operation Mode: Local-First / Standalone (CODEATLAS_API_URL unset)`);
    countCheck("ok");
    console.log(`  ${ok()} Local AST Parsers: Ready (TypeScript/JavaScript, Python, PHP)`);
    countCheck("ok");
  }

  // 5. System Features & Difference Summary
  console.log(`\n${bold("5. System Features & Difference Summary")}`);
  const diff = checkFeaturesDiff();
  console.log(`  • Connected MCP Clients: ${diff.connectedClients.length > 0 ? diff.connectedClients.join(", ") : "None detected"}`);
  console.log(`  • AST Analysis Engines: ${diff.astParsers.join(", ")}`);
  console.log(`  • ADR System: ${diff.adrCount} records at ~/.codeatlas/adr`);
  console.log(`  • Execution Mode: ${diff.cloudSync ? "Cloud Synchronized" : (diff.localMode ? "Local-First / Standalone" : "Hybrid")}`);
  console.log(`  • Claude hook registration: ${claudeHooks.status === "ok" ? "configured" : "partial"} (registration does not confirm memory-pipeline health)`);

  console.log(`\n${bold("Result:")} ${passed}/${total} checks passed`);
  if (claudeMcp.status === "ok" && (claudeHooks.status === "ok" || hermesPlugin)) {
    console.log(`${green("Configured integrations are present. Use 'doctor hooks --json' to inspect memory-pipeline outcomes.")}`);
  } else {
    console.log(`${yellow("Tip: Run 'codeatlas setup claude' or 'codeatlas init' to enable missing integrations.")}`);
  }
  console.log("=".repeat(60));
}

// ──────────────────────────────────────────────────────────────────────
// ── Main CLI router ──────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────
  
export function isCLICommand(argv: string[]): boolean {
  return classifyCommand(argv) === "cli";
}

export async function runCLI(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === "doctor") {
    await cmdDoctor();
  } else if (cmd === "brain-context") {
    await cmdBrainContext();
  } else if (cmd === "brain-save") {
    await cmdBrainSave();
  } else if (cmd === "task-router") {
    await cmdTaskRouter();
  } else if (cmd === "update") {
    console.log("Updating CodeAtlas from npm...");
    runNpmUpdate();
    console.log("CodeAtlas updated successfully.");
  } else if (cmd === "hook" || cmd === "hooks") {
    const subCmd = process.argv[3];
    if (subCmd === "brain-context") {
      await cmdBrainContext();
    } else if (subCmd === "brain-save") {
      await cmdBrainSave();
    } else if (subCmd === "task-router") {
      await cmdTaskRouter();
    } else {
      console.error(`Unknown hook: ${subCmd}`);
      process.exit(1);
    }
  } else if (cmd === "init" || cmd === "setup") {
    if (process.argv[3] === "claude") {
      const prefix = "--projectDir=";
      const projectDirArg = process.argv.find(a => a.startsWith(prefix));
      if (!projectDirArg) {
        console.error("Error: --projectDir= value is required");
        process.exit(1);
      }
      const value = projectDirArg.slice(prefix.length).trim();
      if (!value) {
        console.error("Error: --projectDir= value cannot be empty or whitespace-only");
        process.exit(1);
      }
      await cmdSetupClaude(value);
    } else if (process.argv[3] === "zed") {
      await cmdSetupZed();
    } else {
      await cmdSetup();
    }
  } else if (cmd === "setup-hook" || cmd === "setup-hooks" || (cmd === "setup" && process.argv[3] === "hook")) {
    // Install Claude hooks using the setup-hooks script
    console.log("🚀 Installing CodeAtlas hooks for Claude CLI...");
    try {
      const { installClaudeHooks } = await import("../../scripts/claude-hook-settings.js");
      installClaudeHooks();
      console.log("✅ Hooks installed successfully!");
    } catch (error) {
      console.error(`${fail()} Failed to install hooks: ${error}`);
      process.exit(1);
    }
  } else if (cmd === "validate-hook" || cmd === "validate-hooks" || (cmd === "setup" && process.argv[3] === "hook" && (process.argv[4] === "--validate" || process.argv[4] === "-v"))) {
    // Validate Claude hooks installation
    console.log("🔍 Validating CodeAtlas hooks installation...");
    const { spawnSync } = await import("child_process");
    try {
      const validator = fileURLToPath(new URL("../../scripts/validate-hooks.js", import.meta.url));
      const result = spawnSync(process.execPath, [validator], { stdio: "inherit", shell: false });
      checkSpawnResult(result);
      console.log("✅ Hooks validation completed successfully!");
    } catch (error) {
      console.error(`${fail()} Hooks validation failed: ${error}`);
      process.exit(1);
    }
  } else if (cmd === "--help" || cmd === "-h") {
    console.log(`
Usage: codeatlas-enterprise <command>

Commands:
  init              Interactive Second Brain setup wizard
  setup             Same as init
  setup claude      Install Claude hooks and configs
  setup hook        Install CodeAtlas hooks for Claude CLI
  setup validate     Validate hooks installation
  setup zed         Register CodeAtlas as a Zed MCP context
  doctor            Health check & diagnostics
  brain-context     Load Second Brain context for current task
  brain-save        Save dream memory to Second Brain
  task-router       Route task to appropriate model
  update            Upgrade the globally installed npm package

Without a command, runs the MCP server.
`);
  }
}

/* ── Brain Context & Save Commands ───────────────────────────────── */

export async function cmdBrainContext(): Promise<void> {
  const startedAt = performance.now();
  let bootstrapAttempt = false;
  const report = (event: Parameters<typeof reportMemoryPipelineEvent>[0]) => reportMemoryPipelineEvent({
    ...event,
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    ...(bootstrapAttempt ? { bootstrap_attempt: true } : {}),
  });
  const input = await readStdin();
  let payload: any = {};

  if (input) {
    try {
      payload = JSON.parse(input);
    } catch {
      // Invalid JSON, use defaults
    }
  }

  if (process.env.CODEATLAS_INJECT_BRAIN_CONTEXT !== "1") {
    report({ kind: "load", status: "suppressed", reason: "disabled", trace_id: randomUUID() });
    return;
  }

  const hookEventName: "SessionStart" | "UserPromptSubmit" = payload?.hook_event_name === "SessionStart" ? "SessionStart" : "UserPromptSubmit";
  const cwd = typeof payload?.cwd === "string" ? payload.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const promptValue = typeof payload?.prompt === "string" ? payload.prompt : typeof payload?.query === "string" ? payload.query : "";
  const prompt = promptValue.slice(0, 2_000);
  const sessionId = typeof payload?.session_id === "string" && payload.session_id.length > 0 ? payload.session_id.slice(0, 256) : `unknown-${createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 16)}`;
  const traceId = randomUUID();
  if (!process.env.CODEATLAS_API_URL || !getResolvedApiKey()) {
    report({ kind: "load", status: "unavailable", reason: "not_configured", trace_id: traceId });
    return;
  }

  let failureStage = "project_identity";
  try {
    const identity = resolveProjectIdentity(cwd);
    const { loadBrainContext, formatBrainContext } = await import("../services/brainContext.js");
    const { prepareContextPacket, commitContextPacket } = await import("./hooks/contextPacket.js");
    failureStage = "context_fetch";
    bootstrapAttempt = true;
    const result = await loadBrainContext({ query: prompt, project: identity.project, project_id: identity.project_id, display_name: identity.project, workspace_path: identity.workspace_path, trace_id: traceId, limit: 5 });
    if (result.retrievalStatus && /_error$/.test(result.retrievalStatus)) {
      report({ kind: "load", status: "error", reason: result.retrievalStatus, trace_id: traceId, project_id: identity.project_id });
      return;
    }
    if (result.componentStatuses && Object.values(result.componentStatuses).some((status) => /_error$/.test(status))) {
      report({ kind: "load", status: "error", reason: "partial_retrieval_failure", trace_id: traceId, project_id: identity.project_id });
    }
    const maxCharsRaw = Number(process.env.CODEATLAS_CONTEXT_MAX_CHARS);
    const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw >= 500 && maxCharsRaw <= 20_000 ? Math.trunc(maxCharsRaw) : 6_000;
    failureStage = "context_format";
    const packet = formatBrainContext(result, { query: prompt, minRelevanceScore: payload?.minRelevanceScore, maxChars });
    if (packet === "No Second Brain context found for this query.") {
      report({ kind: "load", status: "empty", reason: result.checkpointStatus === "empty" ? "checkpoint_empty" : "no_matching_context", trace_id: traceId, project_id: identity.project_id });
      return;
    }
    const packetInput = { projectId: identity.project_id, sessionId, eventName: hookEventName, content: packet };
    failureStage = "cache_prepare";
    const decision = await prepareContextPacket(packetInput);
    if (decision.status === "suppressed") {
      report({ kind: "load", status: "suppressed", reason: "duplicate", trace_id: traceId, project_id: identity.project_id });
      return;
    }
    const hostOutput = JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: packet } });
    failureStage = "host_output";
    await new Promise<void>((resolve, reject) => process.stdout.write(`${hostOutput}\n`, (error) => error ? reject(error) : resolve()));
    failureStage = "cache_commit";
    await commitContextPacket(packetInput, decision.contentHash);
    writeContextLoadStatus({
      projectId: identity.project_id,
      sessionId,
      eventName: hookEventName,
      sourceCount: Array.isArray(result.checkpoint?.source_event_ids) ? result.checkpoint.source_event_ids.length : 0,
    });
    report({ kind: "load", status: "injected", reason: "context_available", trace_id: traceId, project_id: identity.project_id, packet_chars: packet.length, injected: true, readable: true });
  } catch {
    report({ kind: "load", status: "error", reason: failureStage, trace_id: traceId });
  }
}

function writeContextLoadStatus(input: { projectId: string; sessionId: string; eventName: "SessionStart" | "UserPromptSubmit"; sourceCount: number }): void {
  try {
    const directory = path.join(os.homedir(), ".codeatlas");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, "context-load-status.json");
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ status: "injected", project_id: input.projectId, session_id: input.sessionId, event: input.eventName, source_count: input.sourceCount })}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch { /* A visible receipt must never make the host hook fail. */ }
}

function reportMemoryPipelineEvent(event: { kind: "save" | "load"; status: string; reason: string; trace_id: string; project_id?: string; packet_chars?: number; duration_ms?: number; capture_received?: boolean; bootstrap_attempt?: boolean; injected?: boolean; readable?: boolean }): void {
  const MAX_MEMORY_PIPELINE_EVENTS_BYTES = 5 * 1024 * 1024;
  const safe = {
    timestamp: new Date().toISOString(),
    kind: event.kind,
    status: event.status,
    reason: event.reason,
    trace_id: event.trace_id,
    ...(event.project_id && /^[A-Za-z0-9._:-]{1,255}$/.test(event.project_id) ? { project_id: event.project_id } : {}),
    ...(Number.isInteger(event.packet_chars) ? { packet_chars: event.packet_chars } : {}),
    ...(Number.isFinite(event.duration_ms) ? { duration_ms: Math.max(0, Math.trunc(event.duration_ms!)) } : {}),
    ...(event.capture_received ? { capture_received: true } : {}),
    ...(event.bootstrap_attempt ? { bootstrap_attempt: true } : {}),
    ...(event.injected ? { injected: true } : {}),
    ...(event.readable ? { readable: true } : {}),
  };
  try {
    const dir = path.join(os.homedir(), ".codeatlas");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
    const file = path.join(dir, "memory-pipeline-events.jsonl");
    try {
      if (fs.statSync(file).size > MAX_MEMORY_PIPELINE_EVENTS_BYTES) fs.renameSync(file, `${file}.1`);
    } catch { /* absent or unavailable diagnostics file */ }
    fs.appendFileSync(file, `${JSON.stringify(safe)}\n`, { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  } catch { /* diagnostics must never break a host hook */ }
  console.error(`[CodeAtlas hook] ${event.kind}_status=${event.status} reason=${event.reason} trace_id=${event.trace_id}`);
}

export async function cmdBrainSave(): Promise<void> {
  const startedAt = performance.now();
  const input = await readStdin();
  const event = decodeClaudeHookEvent(input);
  const report = (details: { status: string; reason: string; trace_id: string; project_id?: string }) => reportMemoryPipelineEvent({
    kind: "save", ...details,
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    ...(event.status === "capture" || event.status === "lifecycle" ? { capture_received: true } : {}),
  });
  const traceId = event.status === "capture" ? event.eventId ?? event.idempotencyKey ?? randomUUID() : randomUUID();

  if (event.status !== "capture" && event.status !== "lifecycle") {
    report({ status: event.status, reason: "reason" in event ? event.reason : "skipped", trace_id: traceId });
    process.exit(0);
  }

  if (event.status === "lifecycle") {
    if (!process.env.CODEATLAS_API_URL || !getResolvedApiKey()) {
      report({ status: "unavailable", reason: "not_configured", trace_id: traceId });
      process.exit(0);
    }
    try {
      const { resolveProjectIdentity } = await import("../services/projectIdentity.js");
      const { captureTranscriptCheckpoint } = await import("./hooks/sessionSpool.js");
      const identity = resolveProjectIdentity(event.cwd);
      const result = await captureTranscriptCheckpoint({ identity, sessionId: event.sessionId, cwd: event.cwd, transcriptPath: event.transcriptPath, trigger: event.eventName });
      report({ status: result.status, reason: "lifecycle_capture", trace_id: traceId, project_id: identity.project_id });
    } catch {
      report({ status: "error", reason: "local_capture_failed", trace_id: traceId });
    }
    process.exit(0);
  }

  if (!event.sessionId || !event.idempotencyKey) {
    report({ status: "invalid_payload", reason: "missing_session_context", trace_id: traceId });
    process.exit(0);
  }

  if (!process.env.CODEATLAS_API_URL || !getResolvedApiKey()) {
    report({ status: "unavailable", reason: "not_configured", trace_id: traceId });
    process.exit(0);
  }

  const cwd = event.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    const { resolveProjectIdentity } = await import("../services/projectIdentity.js");
    const { captureSessionEvents } = await import("./hooks/sessionSpool.js");
    const identity = resolveProjectIdentity(cwd);
    const result = await captureSessionEvents({
      identity,
      sessionId: event.sessionId,
      events: [{
        event_id: event.eventId ?? event.idempotencyKey,
        session_id: event.sessionId,
        content: event.content,
        actor_role: "TOOL",
        memory_type_hint: event.memoryType,
        tool_name: event.toolName,
      }],
    });
    report({ status: result.status, reason: "tool_capture", trace_id: traceId, project_id: identity.project_id });
  } catch {
    report({ status: "error", reason: "local_capture_failed", trace_id: traceId });
    process.exit(0);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    const chunks: (string | Buffer)[] = [];

    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
    });

    process.stdin.on("end", () => {
      data = chunks.join("");
      resolve(data);
    });

    // Handle cases where stdin might close immediately
    if (process.stdin.isTTY) {
      setTimeout(() => resolve(data), 500);
    } else {
      // For pipes, we'll wait until the stream ends
      const timeout = setTimeout(() => {
        process.stdin.destroy();
        resolve(chunks.join(""));
      }, 2000);
      process.stdin.once("end", () => clearTimeout(timeout));
    }
  });
}

export async function cmdTaskRouter(): Promise<void> {
  const input = await readStdin();
  let payload: any = {};

  if (input) {
    try {
      payload = JSON.parse(input);
    } catch {
      // Invalid JSON, use defaults
    }
  }

  const taskName = payload.task_name || payload.taskName || payload.prompt || "unknown";
  const taskType = payload.task_type || payload.taskType || "unknown";

  try {
    const { routeTask } = await import("./taskRouter.js");
    const route = routeTask(taskName, taskType);
    console.log(`MODEL_NAME=${route.model}`);
    console.log(`EFFORT=${route.effort}`);
  } catch (err) {
    // Fail silently - hooks should not break Claude
    console.error("Task router error:", err instanceof Error ? err.message : String(err));
    process.exit(0);
  }
}

/* ── Also export as MCP tools ───────────────────────────────────── */
/* These are already registered in mcpServer.ts */
