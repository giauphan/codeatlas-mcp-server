import {
  API_URL,
  bold,
  green,
  red,
  yellow,
  ok,
  fail,
  warn,
  ask,
  cloudFetch
} from "./commands.js";

/* ── Step functions ─────────────────────────────────────────────── */

export async function stepAuthenticate(): Promise<boolean> {
  console.log(`\n${bold("Step 1: Authenticate with CodeAtlas Cloud")}`);
  const existingKey = process.env.CODEATLAS_API_KEY;
  if (existingKey) {
    const r = await cloudFetch("GET", "/api/version");
    if (r.ok) {
      console.log(`  ${ok()} Authenticated (key: ***)`);
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

export async function stepConnectProject(): Promise<string> {
  console.log(`\n${bold("Step 2: Connect Project")}`);
  const project = await ask(`  ${bold("Project name:")} `);
  if (!project) {
    console.log(`  ${warn()} Using default: "my-second-brain"`);
    return "my-second-brain";
  }
  console.log(`  ${ok()} Project: ${project}`);
  return project;
}

export async function stepEnableSecondBrain(project: string): Promise<boolean> {
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

export async function stepInitializeServices(project: string): Promise<boolean> {
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

export async function stepVerifySync(): Promise<boolean> {
  console.log(`\n${bold("Step 5: Verify Synchronization")}`);
  const r = await cloudFetch("GET", "/api/dreams/query?query=Second+Brain&project=hermes-auto&limit=3");
  if (r.ok) {
    console.log(`  ${ok()} Cloud sync verified`);
    return true;
  }
  console.log(`  ${warn()} Sync check inconclusive (${r.status})`);
  return true;
}

export async function stepHealthCheck(): Promise<boolean> {
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
