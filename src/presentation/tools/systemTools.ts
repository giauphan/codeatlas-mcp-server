import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { checkAuth, logActivity } from "../../services/authService.js";
import { loadAnalysisAsync } from "../../services/projectService.js";
import { execFileSync } from "child_process";


export function registerSystemTools(server: McpServer) {
    // Tool 18: run_script — Run npm scripts
    server.tool(
      "run_script",
      "Run an npm/pnpm/yarn script from package.json. Returns exit code, stdout/stderr, and duration. Handles cd to project dir automatically.",
      {
        project: z.string().optional().describe("Project name or path"),
        script: z.string().describe("Script name from package.json (e.g. 'build', 'test', 'lint')"),
        args: z.string().optional().describe("Optional args (e.g. '-- --watch')"),
        timeout: z.number().optional().describe("Timeout in seconds (default: 60, max: 300)"),
      },
      async ({ project, script, args, timeout }: { project?: string; script: string; args?: string; timeout?: number }) => {
        const auth = await checkAuth();
        await logActivity(auth, "run_script", { project, script, args, timeout });
        const loaded = await loadAnalysisAsync(project);
        if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

        // 🛡️ Sentinel Security Validation
        // Use spawnSync without a shell to prevent command injection entirely
        const projectDir = loaded.projectDir;
        const pkgPath = path.join(projectDir, "package.json");
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            if (!pkg.scripts?.[script]) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Script '${script}' not found`, available: pkg.scripts ? Object.keys(pkg.scripts) : [] }) }] };
          } catch { /* skip */ }
        }

        const maxTime = Math.min(timeout || 60, 300);
        const startTime = Date.now();

        try {
          const cp = require("child_process");
          const parsedArgs = args ? args.split(" ").filter(Boolean) : [];
          const result = cp.spawnSync("npm", ["run", script, ...parsedArgs], {
            timeout: maxTime * 1000,
            shell: false, // Security: explicit shell false
            maxBuffer: 1024 * 1024,
            cwd: projectDir
          });

          const dur = ((Date.now() - startTime) / 1000).toFixed(1);

          if (result.error) {
            throw result.error;
          }

          const stdoutStr = result.stdout ? result.stdout.toString().substring(0, 10000) : "";
          const stderrStr = result.stderr ? result.stderr.toString().substring(0, 5000) : "";

          if (result.status !== 0) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ script, project: loaded.projectName, exitCode: result.status || 1, duration: `${dur}s`, stdout: stdoutStr, stderr: stderrStr, error: `Process exited with code ${result.status}` }, null, 2) }] };
          }

          return { content: [{ type: "text" as const, text: JSON.stringify({ script, project: loaded.projectName, exitCode: 0, duration: `${dur}s`, stdout: stdoutStr, stderr: stderrStr }, null, 2) }] };
        } catch (err: any) {
          const dur = ((Date.now() - startTime) / 1000).toFixed(1);
          return { content: [{ type: "text" as const, text: JSON.stringify({ script, project: loaded.projectName, exitCode: err.status || 1, duration: `${dur}s`, stdout: (err.stdout || "").toString().substring(0, 10000), stderr: (err.stderr || "").toString().substring(0, 5000), error: err.killed ? "TIMEOUT" : err.message?.substring(0, 300) }, null, 2) }] };
        }
      }
    );

    // Tool 19: git_changes — Recent git activity
    server.tool(
      "git_changes",
      "Get recent git changes: last N commits (hash, author, date, message, files changed), uncommitted changes (modified/added/deleted), branch status (ahead/behind). Saves multiple git commands.",
      {
        project: z.string().optional().describe("Project name or path"),
        commits: z.number().optional().describe("Number of recent commits (default: 5, max: 20)"),
      },
      async ({ project, commits }: { project?: string; commits?: number }) => {
        const auth = await checkAuth();
        await logActivity(auth, "git_changes", { project, commits });
        const loaded = await loadAnalysisAsync(project);
        if (!loaded) return { content: [{ type: "text" as const, text: "No analysis found. Run 'analyze' first." }] };

        const projectDir = loaded.projectDir;
        if (!fs.existsSync(path.join(projectDir, ".git"))) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Not a git repository" }) }] };

        const maxC = Math.min(commits || 5, 20);
        const result: any = { project: loaded.projectName };
        const cp = require("child_process");

        try {
          result.branch = cp.execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectDir, encoding: "utf-8" }).toString().trim();
          const st = cp.execFileSync("git", ["status", "--porcelain"], { cwd: projectDir, encoding: "utf-8" }).toString();
          const mod: string[] = [], add: string[] = [], del: string[] = [];
          for (const line of st.split("\n").map((x: string) => x.trim()).filter(Boolean)) { const s = line.substring(0, 2), f = line.substring(3); if (s.includes("M")) mod.push(f); if (s.includes("A")) add.push(f); if (s.includes("D")) del.push(f); }
          result.uncommitted = { modified: mod.slice(0, 20), added: add.slice(0, 10), deleted: del.slice(0, 10), hasChanges: st.trim().length > 0 };
          try {
            const [behind, ahead] = cp.execFileSync("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd: projectDir, encoding: "utf-8" }).toString().trim().split("\t").map(Number);
            result.ahead = ahead || 0; result.behind = behind || 0;
          } catch { result.ahead = null; result.behind = null; }
          const logRaw = cp.execFileSync("git", ["log", `-${maxC}`, "--format=COMMIT%n%H%n%an%n%ai%n%s%nFILES:", "--name-only"], { cwd: projectDir, encoding: "utf-8", maxBuffer: 1024 * 1024 }).toString();
          result.recentCommits = [];
          for (const block of logRaw.split("COMMIT\n").filter(Boolean)) {
            const ls = block.trim().split("\n"); if (ls.length < 4) continue;
            const ci: any = { hash: ls[0]?.substring(0, 12), author: ls[1], date: ls[2], message: ls[3] };
            const fi = ls.findIndex((x: string) => x === "FILES:");
            if (fi !== -1) ci.files = ls.slice(fi + 1).filter((x: string) => x.trim()).slice(0, 15);
            result.recentCommits.push(ci);
          }
        } catch (err: any) { result.error = err.message?.substring(0, 300); }

        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
    );

    // ── Tool 9a: Setup Second Brain ──────────────────────────────
    server.tool(
      "setup_second_brain",
      "Configure CodeAtlas Second Brain for any MCP client (Hermes, Claude Code, Gemini CLI). "
      + "Installs MCP config and auto-retrieval plugin so the AI automatically saves/retrieves knowledge.",
      {
        client: z.enum(["hermes", "claude", "gemini", "all"]).optional().default("all")
          .describe("Which client to configure. Choose one of: hermes, claude, gemini, all"),
        apiKey: z.string().optional().describe("CODEATLAS_API_KEY (will use env var if not provided)"),
        autoPlugin: z.boolean().optional().default(true)
          .describe("Also install Hermes auto Second Brain plugin (pre/post LLM hooks)"),
      },
      async ({ client = "all", apiKey, autoPlugin = true }) => {
        const auth = await checkAuth();
        await logActivity(auth, "setup_second_brain", { client, autoPlugin });

        const key = apiKey || process.env.CODEATLAS_API_KEY;
        if (!key) return { content: [{ type: "text" as const, text: JSON.stringify({
          success: false, error: "CODEATLAS_API_KEY not set. Provide apiKey parameter or set env var."
        }, null, 2) }] };

        const results: any[] = [];
        const mcpEntry = `  codeatlas:\n    command: npx\n    args: ["-y", "codeatlas-enterprise"]\n    env:\n      CODEATLAS_API_KEY: "${key}"\n    enabled: true\n`;

        // Hermes MCP config
        if (client === "hermes" || client === "all") {
          const hermesCfg = path.join(os.homedir(), ".hermes", "config.yaml");
          try {
            if (fs.existsSync(hermesCfg)) {
              let cfg = fs.readFileSync(hermesCfg, "utf-8");
              if (cfg.includes("codeatlas:")) {
                results.push({ client: "hermes", action: "mcp_config", status: "already_configured" });
              } else if (cfg.includes("mcp_servers:")) {
                cfg = cfg.replace("mcp_servers:", "mcp_servers:\n" + mcpEntry);
                fs.writeFileSync(hermesCfg, cfg);
                results.push({ client: "hermes", action: "mcp_config", status: "updated" });
              } else {
                fs.writeFileSync(hermesCfg, "\nmcp_servers:\n" + mcpEntry, { flag: "a" });
                results.push({ client: "hermes", action: "mcp_config", status: "appended" });
              }
            } else {
              fs.mkdirSync(path.dirname(hermesCfg), { recursive: true });
              fs.writeFileSync(hermesCfg, "mcp_servers:\n" + mcpEntry);
              results.push({ client: "hermes", action: "mcp_config", status: "created" });
            }
          } catch (err: any) {
            results.push({ client: "hermes", action: "mcp_config", status: "error", error: err.message });
          }

          // Hermes auto plugin
          if (autoPlugin) {
            try {
              const pluginDir = path.join(os.homedir(), ".hermes", "plugins", "codeatlas_second_brain");
              if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
              const pluginInit = `"""CodeAtlas Second Brain Plugin — Auto activation on every turn"""
  import json, urllib.request, urllib.parse, logging
  from typing import Any
  log = logging.getLogger(__name__)
  KEY = "${key}"
  URL = process.env.CODEATLAS_API_URL || "https://your-server.com/"
  UA = "Hermes-SecondBrain-Plugin/1.0"
  def _rq(m, p, b=None, q=None):
      import urllib.error
      u = URL.rstrip("/") + p
      if q: u += "?" + "&".join(f"{k}={urllib.parse.quote(str(v))}" for k,v in q.items() if v)
      h = urllib.request.Request(u, data=json.dumps(b).encode() if b else None, method=m)
      h.add_header("x-api-key", KEY); h.add_header("Content-Type", "application/json"); h.add_header("User-Agent", UA)
      try:
          r = urllib.request.urlopen(h, timeout=10)
          return json.loads(r.read().decode()), r.status
      except urllib.error.HTTPError as e:
          return {"err": e.read().decode("utf-8",errors="replace")[:200]}, e.code
  def register(ctx):
      def on_pre_llm_call(**kw):
          user = kw.get("user_message","")
          if not user: return None
          parts = []
          try:
              r,s = _rq("GET","/api/dreams/query",q={"query":user,"project":"hermes-auto","limit":3})
              m = r.get("memories",[]) if 200<=s<300 else []
              if m:
                  ctx=["## Auto-retrieved Dreams from CodeAtlas"]
                  for x in m:
                      c = x.get("content","")[:120]
                      if c: ctx.append(f"- [{x.get('memory_type','?')}] {c}")
                  parts.append("\\n".join(ctx))
          except: pass
          try:
              r,s = _rq("GET","/api/genome/search",q={"query":user,"project":"hermes-auto","limit":3})
              g = r.get("genes",[]) if 200<=s<300 else []
              if g:
                  ctx=["## Auto-retrieved Genome DNA"]
                  for x in g[:3]: ctx.append(f"- [{x.get('category','')}] {x.get('name','')} (conf:{x.get('confidence','')})")
                  parts.append("\\n".join(ctx))
          except: pass
          try:
              r,s = _rq("GET","/api/genome/immune/context",q={"problem":user,"project":"hermes-auto"})
              c = r.get("context","") if 200<=s<300 else ""
              if c and len(c)>50: parts.append(f"## Auto-retrieved Immune Prevention\\n{c[:500]}")
          except: pass
          if parts: return {"context":"\\n\\n".join(parts)}
          return None
      def on_post_llm_call(**kw):
          resp = kw.get("assistant_response","")
          if not resp or len(resp)<100: return
          try: _rq("POST","/api/dreams/save",b={"memory_type":"KNOWLEDGE","content":"[Auto-Save] "+resp[:200].replace(chr(10)," "),"importance":5,"project":"hermes-auto","session_id":"auto-"+kw.get("turn_id","0")})
          except: pass
      ctx.register_hook("pre_llm_call",on_pre_llm_call)
      ctx.register_hook("post_llm_call",on_post_llm_call)
      log.info("Second Brain auto plugin active")
  `;
              const pluginYaml = `name: codeatlas_second_brain\nversion: "1.0"\ndescription: Automatic Second Brain activation\nhooks:\n  - pre_llm_call\n  - post_llm_call\nenabled: true\n`;
              fs.writeFileSync(path.join(pluginDir, "__init__.py"), pluginInit);
              fs.writeFileSync(path.join(pluginDir, "plugin.yaml"), pluginYaml);
              results.push({ client: "hermes", action: "auto_plugin", status: "installed" });
            } catch (err: any) {
              results.push({ client: "hermes", action: "auto_plugin", status: "error", error: err.message });
            }
          }
        }

        // Claude MCP config
        if (client === "claude" || client === "all") {
          const claudeCfg = path.join(os.homedir(), ".claude", "claude.json");
          try {
            const claudeEntry = { mcpServers: {
              codeatlas: { command: "npx", args: ["-y", "codeatlas-enterprise"], env: { CODEATLAS_API_KEY: key } },
              ["codeatlas-genome"]: { command: "npx", args: ["-y", "codeatlas-enterprise"], env: { CODEATLAS_API_KEY: key } },
            }};
            if (fs.existsSync(claudeCfg)) {
              const existing = JSON.parse(fs.readFileSync(claudeCfg, "utf-8"));
              existing.mcpServers = { ...existing.mcpServers, ...claudeEntry.mcpServers };
              fs.writeFileSync(claudeCfg, JSON.stringify(existing, null, 2));
              results.push({ client: "claude", action: "mcp_config", status: "updated" });
            } else {
              fs.mkdirSync(path.dirname(claudeCfg), { recursive: true });
              fs.writeFileSync(claudeCfg, JSON.stringify(claudeEntry, null, 2));
              results.push({ client: "claude", action: "mcp_config", status: "created" });
            }
          } catch (err: any) {
            results.push({ client: "claude", action: "mcp_config", status: "error", error: err.message });
          }
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({
          success: true, results,
          summary: `${results.filter(r => !r.error).length}/${results.length} operations succeeded`,
          restartRequired: true,
          message: "Restart your MCP client for changes to take effect",
        }, null, 2) }] };
      }
    );

    // ── Tool 9b: Check Second Brain Status ──────────────────────
    server.tool(
      "check_second_brain_status",
      "Check the current Second Brain configuration status for all MCP clients.",
      {},
      async () => {
        const auth = await checkAuth();
        const results: any = { hermes: {}, claude: {}, gemini: {} };

        // Hermes
        const hermesCfg = path.join(os.homedir(), ".hermes", "config.yaml");
        if (fs.existsSync(hermesCfg)) {
          const cfg = fs.readFileSync(hermesCfg, "utf-8");
          results.hermes.mcp = cfg.includes("codeatlas:") ? "configured" : "not_configured";
        } else {
          results.hermes.mcp = "no_config";
        }
        const pluginDir = path.join(os.homedir(), ".hermes", "plugins", "codeatlas_second_brain");
        results.hermes.plugin = fs.existsSync(path.join(pluginDir, "__init__.py")) ? "installed" : "not_installed";
        results.hermes.restartRequired = results.hermes.plugin === "installed" || results.hermes.mcp === "not_configured";
        // Claude
        const claudeCfg = path.join(os.homedir(), ".claude", "claude.json");
        if (fs.existsSync(claudeCfg)) {
          const cl = JSON.parse(fs.readFileSync(claudeCfg, "utf-8"));
          results.claude.mcp = cl.mcpServers?.codeatlas ? "configured" : "not_configured";
        } else {
          results.claude.mcp = "no_config";
        }

        // API key
        results.apiKey = process.env.CODEATLAS_API_KEY ? "set" : "not_set";

        // Cloud connectivity
        try {
          const resp = await fetch(`${process.env.CODEATLAS_API_URL || "https://your-server.com"}/api/genome/search?limit=1`, {
            headers: { "x-api-key": process.env.CODEATLAS_API_KEY || "", "User-Agent": "codeatlas-enterprise/2.0" },
          });
          results.cloud = resp.ok ? "reachable" : `error_${resp.status}`;
        } catch {
          results.cloud = "unreachable";
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      }
    );

}
