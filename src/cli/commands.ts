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
import * as readline from "readline";
import { getHermesConfigPath, getHermesPluginDir, getZedSettingsPath } from "../utils/pathUtils.js";

export const API_URL = process.env.CODEATLAS_API_URL ?? "";

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
  const url = `${API_URL.replace(/\/+$/, "")}${path_}`;
  const headers: Record<string, string> = {
    "User-Agent": "codeatlas-enterprise-cli/2.0",
    "Content-Type": "application/json",
  };
  const apiKey = process.env.CODEATLAS_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
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

import {
  stepAuthenticate,
  stepConnectProject,
  stepEnableSecondBrain,
  stepInitializeServices,
  stepVerifySync,
  stepHealthCheck
} from "./steps.js";
import { cmdSetupClaude, cmdSetupZed } from "./setupClaude.js";

/* ── CLI Commands ───────────────────────────────────────────────── */

export async function cmdSetup(): Promise<void> {
  console.log();
  console.log(bold("╔══════════════════════════════════════════════════╗"));
  console.log(bold("║   CodeAtlas Second Brain Setup Wizard           ║"));
  console.log(bold("╚══════════════════════════════════════════════════╝"));
  console.log(`  Cloud: ${API_URL}`);

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
  console.log(`  ${ok()} Cloud: ${API_URL}`);
  console.log(`  ${ok()} Config: ~/.hermes/config.yaml`);
  console.log(`  ${ok()} Plugin: ~/.hermes/plugins/codeatlas_second_brain/`);
  console.log(`\n  ${bold("Next steps:")}`);
  console.log(`  1. Restart your MCP client (Hermes: /restart)`);
  console.log(`  2. Ask: "Continue my project"`);
  console.log(`     → AI automatically retrieves Dreams + DNA + Immune`);
}

export async function cmdDoctor(): Promise<void> {
  console.log(`\n${bold("CodeAtlas Second Brain — Health Check")}`);
  console.log("=".repeat(50));

  const checks: [string, () => Promise<{ status: string; detail?: string }>][] = [
    ["CODEATLAS_API_KEY", async () => {
      if (process.env.CODEATLAS_API_KEY) return { status: "ok", detail: "Set" };
      return { status: "fail", detail: "not set" };
    }],
    ["Cloud connection", async () => {
      const r = await cloudFetch("GET", "/api/version");
      if (r.ok) return { status: "ok", detail: `${API_URL} (build ${r.data?.version || "?"})` };
      return { status: "fail", detail: `HTTP ${r.status}` };
    }],
    ["MCP config (Hermes)", async () => {
      const cfg = getHermesConfigPath();
      if (!fs.existsSync(cfg)) return { status: "warn", detail: "not found" };
      const c = fs.readFileSync(cfg, "utf-8");
      if (c.includes("codeatlas:")) return { status: "ok" };
      return { status: "warn", detail: "codeatlas not configured" };
    }],
    ["MCP config (Zed)", async () => {
      const cfg = getZedSettingsPath();
      if (!fs.existsSync(cfg)) return { status: "warn", detail: "not found" };
      try {
        const c = JSON.parse(fs.readFileSync(cfg, "utf-8"));
        if (c?.context_servers?.codeatlas) return { status: "ok" };
      } catch { /* ignore parse errors */ }
      return { status: "warn", detail: "codeatlas not configured" };
    }],
    ["Auto plugin (Hermes)", async () => {
      const p = path.join(getHermesPluginDir(), "__init__.py");
      return fs.existsSync(p) ? { status: "ok" } : { status: "warn", detail: "not installed" };
    }],
    ["Dream persistence", async () => {
      const r = await cloudFetch("GET", "/api/dreams/query?query=test&project=hermes-auto&limit=3");
      if (!r.ok) return { status: "warn", detail: "query timed out (network-specific)" };
      return { status: "ok", detail: `${r.data?.memories?.length || 0} dreams found` };
    }],
    ["Genome (DNA)", async () => {
      const r = await cloudFetch("GET", "/api/genome/search?query=test&limit=3");
      if (!r.ok) return { status: "warn", detail: `transient (HTTP ${r.status})` };
      return { status: "ok", detail: `${r.data?.genes?.length || 0} genes found` };
    }],
    ["Immune System", async () => {
      const r = await cloudFetch("GET", "/api/genome/immune?problem=test&limit=3");
      if (!r.ok) return { status: "warn", detail: `transient (HTTP ${r.status})` };
      return { status: "ok", detail: `${r.data?.genes?.length || 0} immune genes found` };
    }],
  ];

  let passed = 0, failed = 0;
  for (const [name, fn] of checks) {
    const r = await fn();
    const icon = r.status === "ok" ? ok() : r.status === "warn" ? warn() : fail();
    const detail = r.detail ? ` (${r.detail})` : "";
    console.log(`  ${icon} ${name}${detail}`);
    if (r.status === "ok") passed++;
    else failed++;
  }

  console.log(`\n${bold("Result:")} ${passed}/${passed + failed} checks passed`);
  if (failed === 0) {
    console.log(`${green("All systems operational. Your Second Brain is ready.")}`);
  } else {
    console.log(`${red("Some checks failed. Run 'codeatlas init' to reconfigure.")}`);
  }
  console.log("=".repeat(50));
}

// ──────────────────────────────────────────────────────────────────────
// ── Main CLI router ──────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────
  
export function isCLICommand(argv: string[]): boolean {
  const cmd = argv[2];
  if (!cmd) return false;
  return ["init", "setup", "doctor", "--help", "-h"].includes(cmd);
}
  
export async function runCLI(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === "doctor") {
    await cmdDoctor();
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
  } else if (cmd === "--help" || cmd === "-h") {
    console.log(`
Usage: codeatlas-enterprise <command>

Commands:
  init           Interactive Second Brain setup wizard
  setup          Same as init
  setup claude   Install Claude hooks and configs
  setup zed      Register CodeAtlas as a Zed MCP context
  doctor         Health check & diagnostics
  brain-context  Load Second Brain context for current task
  brain-save     Save dream memory to Second Brain
  task-router    Route task to appropriate model

Without a command, runs the MCP server.
`);
  }
}

/* ── Brain Context & Save Commands ───────────────────────────────── */

export async function cmdBrainContext(): Promise<void> {
  const input = await readStdin();
  let payload: any = {};

  if (input) {
    try {
      payload = JSON.parse(input);
    } catch {
      // Invalid JSON, use defaults
    }
  }

  const prompt = payload.prompt || payload.query || "session context";
  const cwd = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const project = process.env.CODEATLAS_PROJECT || (cwd ? path.basename(cwd) : "default");
  const limit = payload.limit || 5;

  if (!process.env.CODEATLAS_API_URL || !process.env.CODEATLAS_API_KEY) {
    // Silently exit if not configured
    process.exit(0);
  }

  try {
    const { loadBrainContext, formatBrainContext } = await import("../services/brainContext.js");
    const result = await loadBrainContext({ query: prompt, project, limit });
    console.log(formatBrainContext(result));
    process.exit(0);
  } catch (err) {
    // Fail silently - hooks should not break Claude
    console.error("Brain context error:", err instanceof Error ? err.message : String(err));
    process.exit(0);
  }
}
  
  if (input) {
    try {
      payload = JSON.parse(input);
    } catch {
      // Invalid JSON, use defaults
    }
  }

  const prompt = payload.prompt || payload.query || "session context";
  const cwd = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const project = process.env.CODEATLAS_PROJECT || (cwd ? path.basename(cwd) : "default");
  const limit = payload.limit || 5;

  if (!process.env.CODEATLAS_API_URL || !process.env.CODEATLAS_API_KEY) {
    // Silently exit if not configured
    process.exit(0);
  }

  try {
    const { loadBrainContext, formatBrainContext } = await import("../services/brainContext.js");
    const result = await loadBrainContext({ query: prompt, project, limit });
    console.log(formatBrainContext(result));
  } catch (err) {
    // Fail silently - hooks should not break Claude
    console.error("Brain context error:", err instanceof Error ? err.message : String(err));
    process.exit(0);
  }
}

export async function cmdBrainSave(): Promise<void> {
  const input = await readStdin();
  let payload: any = {};
  
  if (input) {
    try {
      payload = JSON.parse(input);
    } catch {
      // Invalid JSON, exit silently
      process.exit(0);
    }
  }

  if (!process.env.CODEATLAS_API_URL || !process.env.CODEATLAS_API_KEY) {
    // Silently exit if not configured
    process.exit(0);
  }

  const cwd = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const project = process.env.CODEATLAS_PROJECT || (cwd ? path.basename(cwd) : "default");
  const toolName = payload.tool_name || "unknown";
  const sessionId = payload.session_id || payload.sessionId || "";

  // Extract content from tool response
  let content = "";
  let memoryType: "KNOWLEDGE" | "MISTAKE" | "PREFERENCE" | "PATTERN" | "SESSION_SUMMARY" = "KNOWLEDGE";
  
  if (payload.response) {
    const response = typeof payload.response === "string" ? payload.response : JSON.stringify(payload.response);
    content = response.slice(0, 1000);
    
    // Detect mistakes from errors
    if (payload.error || response.toLowerCase().includes("error") || response.toLowerCase().includes("failed")) {
      memoryType = "MISTAKE";
    }
  }

  if (!content) {
    // Nothing to save
    process.exit(0);
  }

  try {
    const { saveDreamMemory } = await import("../services/dreamingService.js");
    await saveDreamMemory({
      memory_type: memoryType,
      content: `[${toolName}] ${content}`,
      importance: 5,
      session_id: sessionId,
      project,
    });
  } catch {
    // Fail silently - hooks should not break Claude
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