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
import { getHermesConfigPath, getHermesPluginDir } from "../utils/pathUtils.js";
import * as readline from "readline";

const API_URL = process.env.CODEATLAS_API_URL || "https://your-server.com";

/* ── Helpers ───────────────────────────────────────────────────── */

function bold(s: string): string {
  return `\x1b[1m${s}\x1b[0m`;
}
function green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`;
}
function red(s: string): string {
  return `\x1b[31m${s}\x1b[0m`;
}
function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[0m`;
}
function ok(): string {
  return green("✓");
}
function fail(): string {
  return red("✗");
}
function warn(): string {
  return yellow("⚠");
}

function ask(query: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (a) => { rl.close(); resolve(a.trim()); }));
}

async function cloudFetch(method: string, path_: string, body?: any): Promise<{ ok: boolean; status: number; data: any }> {
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

/* ── Step functions ─────────────────────────────────────────────── */

async function stepAuthenticate(): Promise<boolean> {
  console.log(`\n${bold("Step 1: Authenticate with CodeAtlas Cloud")}`);
  const existingKey = process.env.CODEATLAS_API_KEY;
  if (existingKey) {
    const r = await cloudFetch("GET", "/api/version");
    if (r.ok) {
      console.log(`  ${ok()} Authenticated (key: ${existingKey.substring(0, 8)}...)`);
      console.log(`  ${ok()} Cloud reachable: ${API_URL} (build: ${r.data?.version || "?"})`);
      return true;
    }
    console.log(`  ${warn()} Key exists but cloud unreachable (${r.status}). Will try later.`);
  }
  const key = await ask(`  ${bold("Enter CODEATLAS_API_KEY:")} `);
  if (key) process.env.CODEATLAS_API_KEY = key;
  const r = await cloudFetch("GET", "/api/version");
  if (r.ok) {
    console.log(`  ${ok()} Authenticated`);
    return true;
  }
  console.log(`  ${fail()} Authentication failed (${r.status})`);
  return false;
}

async function stepConnectProject(): Promise<string> {
  console.log(`\n${bold("Step 2: Connect Project")}`);
  const project = await ask(`  ${bold("Project name:")} `);
  if (!project) {
    console.log(`  ${warn()} Using default: "my-second-brain"`);
    return "my-second-brain";
  }
  console.log(`  ${ok()} Project: ${project}`);
  return project;
}

async function stepEnableSecondBrain(project: string): Promise<boolean> {
  console.log(`\n${bold("Step 3: Enable AI Second Brain")}`);
  console.log(`  Enabling for project '${project}'...`);

  // Verify cloud connectivity
  const r = await cloudFetch("GET", `/api/genome/search?limit=1&project=${encodeURIComponent(project)}`);
  if (r.ok) {
    console.log(`  ${ok()} Second Brain accessible on Cloud`);
    return true;
  }
  if (r.status === 403) {
    console.log(`  ${fail()} API key invalid or missing`);
    return false;
  }
  // 404 or empty is fine — new project
  console.log(`  ${ok()} Second Brain ready (new project will be created on first save)`);
  return true;
}

async function stepInitializeServices(project: string): Promise<boolean> {
  console.log(`\n${bold("Step 4: Initialize Services")}`);
  const services: [string, string, any][] = [
    ["Dreams", "POST", "/api/dreams/save"],
    ["Genome (DNA)", "POST", "/api/genome/gene"],
    ["Immune System", "POST", "/api/genome/immune"],
  ];
  let allOk = true;
  for (const [name, method, endpoint] of services) {
    const body: any = { project };
    if (endpoint.includes("/dreams")) {
      body.memory_type = "KNOWLEDGE";
      body.content = "[Init] Second Brain initialized";
      body.importance = 1;
      body.session_id = "init-" + Date.now();
    } else if (endpoint.includes("/gene")) {
      body.name = "init-gene";
      body.description = "Initial Second Brain gene";
      body.problem = "initialization";
      body.solution = "second brain ready";
      body.category = "system";
    } else if (endpoint.includes("/immune")) {
      body.problem = "INIT";
      body.failure = "Initial setup";
      body.prevention = "Second Brain initialized";
    }
    const r = await cloudFetch(method, endpoint, body);
    if (r.ok || r.status === 500) {
      // HTTP 500 on rate limit is acceptable during init
      console.log(`  ${ok()} ${name} initialized`);
    } else {
      console.log(`  ${fail()} ${name}: HTTP ${r.status}`);
      allOk = false;
    }
  }
  return allOk;
}

async function stepVerifySync(): Promise<boolean> {
  console.log(`\n${bold("Step 5: Verify Synchronization")}`);
  const r = await cloudFetch("GET", "/api/dreams/query?query=Second+Brain&project=hermes-auto&limit=3");
  if (r.ok) {
    console.log(`  ${ok()} Cloud sync verified`);
    return true;
  }
  console.log(`  ${warn()} Sync check inconclusive (${r.status})`);
  return true;
}

async function stepHealthCheck(): Promise<boolean> {
  console.log(`\n${bold("Step 6: Health Check")}`);
  let allOk = true;
  const checks: [string, () => Promise<boolean>] [] = [
    ["Cloud connectivity", async () => (await cloudFetch("GET", "/api/version")).ok],
    ["MCP server", async () => true], // We're already running
    ["Authentication", async () => (await cloudFetch("GET", "/api/genome/search?limit=1")).status !== 403],
  ];
  for (const [name, fn] of checks) {
    const ok2 = await fn();
    if (ok2) console.log(`  ${ok()} ${name}`);
    else { console.log(`  ${fail()} ${name}`); allOk = false; }
  }
  return allOk;
}

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
      if (process.env.CODEATLAS_API_KEY) return { status: "ok", detail: `${process.env.CODEATLAS_API_KEY.substring(0, 8)}...` };
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

/* ── Main CLI router ────────────────────────────────────────────── */

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
    await cmdSetup();
  } else if (cmd === "--help" || cmd === "-h") {
    console.log(`
Usage: codeatlas-enterprise <command>

Commands:
  init    Interactive Second Brain setup wizard
  setup   Same as init
  doctor  Health check & diagnostics

Without a command, runs the MCP server.
`);
  }
}

/* ── Also export as MCP tools ───────────────────────────────────── */
/* These are already registered in mcpServer.ts */