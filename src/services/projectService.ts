import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as os from "os";
import { CodeAnalyzer } from "../analyzer/parser.js";
import { AnalysisResult } from "../analyzer/types.js";
import { authStorage } from "../context.js";

export interface AnalysisResultLocal extends AnalysisResult {
  stats?: { files: number; functions: number; classes: number; dependencies: number; circularDeps: number; deadCode: number };
}

/** Unified stats helper */
export function getStats(analysis: AnalysisResultLocal) {
  const ec = analysis.entityCounts;
  const st = analysis.stats;
  return {
    files: st?.files ?? analysis.totalFilesAnalyzed ?? ec?.modules ?? 0,
    modules: ec?.modules ?? st?.files ?? analysis.totalFilesAnalyzed ?? 0,
    functions: ec?.functions ?? st?.functions ?? 0,
    classes: ec?.classes ?? st?.classes ?? 0,
    dependencies: ec?.dependencies ?? st?.dependencies ?? 0,
    circularDeps: ec?.circularDeps ?? st?.circularDeps ?? 0,
    deadCode: ec?.deadCode ?? st?.deadCode ?? 0,
  };
}

export function registerProject(dir: string): void {
  try {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, ".codeatlas");
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const regPath = path.join(configDir, "registered_projects.json");
    let projects: string[] = [];
    if (fs.existsSync(regPath)) {
      try {
        const data = fs.readFileSync(regPath, "utf-8");
        projects = JSON.parse(data);
      } catch {
        projects = [];
      }
    }
    if (!Array.isArray(projects)) {
      projects = [];
    }
    const absPath = path.resolve(dir);
    if (!projects.includes(absPath)) {
      projects.push(absPath);
      fs.writeFileSync(regPath, JSON.stringify(projects, null, 2));
      console.error(`[Project-Registry] 📝 Registered new project: ${absPath}`);
    }
  } catch (err) {
    console.error(`[Project-Registry] ❌ Failed to register project: ${err}`);
  }
}

let onProjectLoadedCallback: ((dir: string) => void) | null = null;
export function registerOnProjectLoaded(cb: (dir: string) => void) {
  onProjectLoadedCallback = cb;
}

export const inMemoryAnalysisCache = new Map<string, any>();

export function isProjectDirectory(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export async function isProjectDirectoryAsync(dir: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function scanForCodeatlasProjects(parentDir: string): string[] {
  const discovered: string[] = [];
  try {
    if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
      return [];
    }
    
    // If the directory itself contains .codeatlas, it is a project
    if (fs.existsSync(path.join(parentDir, ".codeatlas"))) {
      discovered.push(path.resolve(parentDir));
      return discovered;
    }
    
    // Otherwise, scan subdirectories up to 2 levels deep
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        const subPath = path.join(parentDir, entry.name);
        if (fs.existsSync(path.join(subPath, ".codeatlas"))) {
          discovered.push(path.resolve(subPath));
        } else {
          // Check 2nd level
          try {
            const subEntries = fs.readdirSync(subPath, { withFileTypes: true });
            for (const subEntry of subEntries) {
              if (subEntry.isDirectory() && subEntry.name !== "node_modules" && !subEntry.name.startsWith(".")) {
                const subSubPath = path.join(subPath, subEntry.name);
                if (fs.existsSync(path.join(subSubPath, ".codeatlas"))) {
                  discovered.push(path.resolve(subSubPath));
                }
              }
            }
          } catch { /* skip */ }
        }
      }
    }
  } catch (err) {
    console.error(`[Project-Discovery] ❌ Failed to scan for .codeatlas projects: ${err}`);
  }
  return discovered;
}

export async function scanForCodeatlasProjectsAsync(parentDir: string): Promise<string[]> {
  const discovered: string[] = [];
  try {
    if (!(await fileExists(parentDir))) {
      return [];
    }
    const parentStat = await fs.promises.stat(parentDir);
    if (!parentStat.isDirectory()) {
      return [];
    }
    
    if (await fileExists(path.join(parentDir, ".codeatlas"))) {
      discovered.push(path.resolve(parentDir));
      return discovered;
    }
    
    const entries = await fs.promises.readdir(parentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        const subPath = path.join(parentDir, entry.name);
        if (await fileExists(path.join(subPath, ".codeatlas"))) {
          discovered.push(path.resolve(subPath));
        } else {
          // Check 2nd level
          try {
            const subEntries = await fs.promises.readdir(subPath, { withFileTypes: true });
            for (const subEntry of subEntries) {
              if (subEntry.isDirectory() && subEntry.name !== "node_modules" && !subEntry.name.startsWith(".")) {
                const subSubPath = path.join(subPath, subEntry.name);
                if (await fileExists(path.join(subSubPath, ".codeatlas"))) {
                  discovered.push(path.resolve(subSubPath));
                }
              }
            }
          } catch { /* skip */ }
        }
      }
    }
  } catch (err) {
    console.error(`[Project-Discovery] ❌ Failed async scan for .codeatlas projects: ${err}`);
  }
  return discovered;
}

export function discoverProjects(tenantId?: string): { name: string; dir: string; analysisPath: string; modifiedAt: Date }[] {
  const projects: { name: string; dir: string; analysisPath: string; modifiedAt: Date }[] = [];
  const searchDirs: string[] = [];

  // Multi-Tenant Isolation
  if (process.env.CODEATLAS_MULTI_TENANT === "true") {
    const auth = authStorage.getStore();
    const isSystemAdmin = auth
      ? (auth.uid === "admin" || auth.role === "admin" || auth.email === "admin@genrostore.com")
      : (tenantId === "admin");

    if (tenantId && !isSystemAdmin) {
      const tenantRoot = process.env.CODEATLAS_PROJECTS_ROOT || path.join(process.cwd(), "tenants");
      const userDir = path.join(tenantRoot, tenantId);
      if (fs.existsSync(userDir)) {
        try {
          const userProjects = fs.readdirSync(userDir);
          for (const p of userProjects) {
            const fullPath = path.join(userDir, p);
            if (fs.statSync(fullPath).isDirectory()) {
              searchDirs.push(fullPath);
            }
          }
        } catch { /* skip */ }
      }
    } else if (isSystemAdmin) {
      const defaultProjDir = process.env.CODEATLAS_PROJECT_DIR || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
      if (defaultProjDir) {
        searchDirs.push(defaultProjDir);
      }
      searchDirs.push(process.cwd());
    } else {
      return [];
    }
  } else {
    const defaultProjDir = process.env.CODEATLAS_PROJECT_DIR || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
    if (defaultProjDir) {
      searchDirs.push(defaultProjDir);
    }
    
    // Dynamically search defaultProjDir || process.cwd() for any projects configured with .codeatlas
    const baseDir = defaultProjDir || process.cwd();
    const localProjects = scanForCodeatlasProjects(baseDir);
    searchDirs.push(...localProjects);
    
    // Fallback to active workspace if no subprojects were found with .codeatlas configuration
    if (!searchDirs.includes(baseDir)) {
      searchDirs.push(baseDir);
    }

    // Load globally registered projects
    try {
      const homeDir = os.homedir();
      const regPath = path.join(homeDir, ".codeatlas", "registered_projects.json");
      if (fs.existsSync(regPath)) {
        const registered = JSON.parse(fs.readFileSync(regPath, "utf-8"));
        if (Array.isArray(registered)) {
          for (const dir of registered) {
            if (fs.existsSync(dir)) {
              searchDirs.push(dir);
            }
          }
        }
      }
    } catch { /* skip */ }
  }

  const seen = new Set<string>();
  for (const dir of searchDirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);

    if (isProjectDirectory(dir)) {
      try {
        const analysisPath = path.join(dir, ".codeatlas", "analysis.json");
        let modifiedAt: Date;
        if (fs.existsSync(analysisPath)) {
          modifiedAt = fs.statSync(analysisPath).mtime;
        } else {
          modifiedAt = fs.statSync(dir).mtime;
        }
        projects.push({
          name: path.basename(dir),
          dir,
          analysisPath,
          modifiedAt,
        });
      } catch { /* skip */ }
    }
  }

  projects.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return projects;
}

export function loadAnalysis(projectDir?: string, force = false): { analysis: AnalysisResult; projectName: string; projectDir: string } | null {
  const auth = authStorage.getStore();
  const tenantId = auth ? auth.uid : undefined;
  
  const projects = discoverProjects(tenantId);
  if (projects.length === 0) return null;

  let target: { name: string; dir: string; analysisPath: string; modifiedAt: Date } | undefined = projects[0];

  if (projectDir) {
    const absPath = path.resolve(projectDir.trim());
    let match = projects.find(
      (p) => p.dir === absPath || p.name.toLowerCase() === projectDir.trim().toLowerCase()
    );
    if (match) {
      target = match;
      registerProject(target.dir);
    } else if (fs.existsSync(absPath) && isProjectDirectory(absPath)) {
      registerProject(absPath);
      target = {
        name: path.basename(absPath),
        dir: absPath,
        analysisPath: path.join(absPath, ".codeatlas", "analysis.json"),
        modifiedAt: new Date()
      };
    } else {
      return null;
    }
  } else if (target) {
    registerProject(target.dir);
  }

  try {
    if (onProjectLoadedCallback) {
      onProjectLoadedCallback(target.dir);
    }
    if (!force && inMemoryAnalysisCache.has(target.dir)) {
      const cached = inMemoryAnalysisCache.get(target.dir);
      return { analysis: cached, projectName: target.name, projectDir: target.dir };
    }
    console.error(`[Auto-Scan] ⚠️ Warning: Sync scanning called. Returning null since scan is memory-only.`);
    return null;
  } catch (err) {
    console.error(`[Auto-Scan] ❌ Sync scanning failed: ${err}`);
    return null;
  }
}

export async function discoverProjectsAsync(tenantId?: string): Promise<{ name: string; dir: string; analysisPath: string; modifiedAt: Date }[]> {
  const projects: { name: string; dir: string; analysisPath: string; modifiedAt: Date }[] = [];
  const searchDirs: string[] = [];

  // Multi-Tenant Isolation
  if (process.env.CODEATLAS_MULTI_TENANT === "true") {
    const auth = authStorage.getStore();
    const isSystemAdmin = auth
      ? (auth.uid === "admin" || auth.role === "admin" || auth.email === "admin@genrostore.com")
      : (tenantId === "admin");

    if (tenantId && !isSystemAdmin) {
      const tenantRoot = process.env.CODEATLAS_PROJECTS_ROOT || path.join(process.cwd(), "tenants");
      const userDir = path.join(tenantRoot, tenantId);
      if (await fileExists(userDir)) {
        try {
          const userProjects = await fs.promises.readdir(userDir);
          for (const p of userProjects) {
            const fullPath = path.join(userDir, p);
            try {
              const stat = await fs.promises.stat(fullPath);
              if (stat.isDirectory()) {
                searchDirs.push(fullPath);
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    } else if (isSystemAdmin) {
      const defaultProjDir = process.env.CODEATLAS_PROJECT_DIR || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
      if (defaultProjDir) {
        searchDirs.push(defaultProjDir);
      }
      searchDirs.push(process.cwd());
    } else {
      return [];
    }
  } else {
    const defaultProjDir = process.env.CODEATLAS_PROJECT_DIR || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
    if (defaultProjDir) {
      searchDirs.push(defaultProjDir);
    }
    
    // Dynamically search defaultProjDir || process.cwd() for any projects configured with .codeatlas
    const baseDir = defaultProjDir || process.cwd();
    const localProjects = await scanForCodeatlasProjectsAsync(baseDir);
    searchDirs.push(...localProjects);
    
    // Fallback to active workspace if no subprojects were found with .codeatlas configuration
    if (!searchDirs.includes(baseDir)) {
      searchDirs.push(baseDir);
    }

    // Load globally registered projects
    try {
      const homeDir = os.homedir();
      const regPath = path.join(homeDir, ".codeatlas", "registered_projects.json");
      if (await fileExists(regPath)) {
        const data = await fs.promises.readFile(regPath, "utf-8");
        const registered = JSON.parse(data);
        if (Array.isArray(registered)) {
          for (const dir of registered) {
            if (await fileExists(dir)) {
              searchDirs.push(dir);
            }
          }
        }
      }
    } catch { /* skip */ }
  }

  const seen = new Set<string>();
  for (const dir of searchDirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);

    if (await isProjectDirectoryAsync(dir)) {
      try {
        const analysisPath = path.join(dir, ".codeatlas", "analysis.json");
        let modifiedAt: Date;
        if (await fileExists(analysisPath)) {
          modifiedAt = (await fs.promises.stat(analysisPath)).mtime;
        } else {
          modifiedAt = (await fs.promises.stat(dir)).mtime;
        }
        projects.push({
          name: path.basename(dir),
          dir,
          analysisPath,
          modifiedAt,
        });
      } catch { /* skip */ }
    }
  }

  projects.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return projects;
}

export const analyzerInstances = new Map<string, CodeAnalyzer>();

export async function loadAnalysisAsync(
  projectDir?: string, 
  force = false, 
  changedFilePath?: string
): Promise<{ analysis: AnalysisResult; projectName: string; projectDir: string } | null> {
  const auth = authStorage.getStore();
  const tenantId = auth ? auth.uid : undefined;
  
  const projects = await discoverProjectsAsync(tenantId);
  if (projects.length === 0) return null;

  let target: { name: string; dir: string; analysisPath: string; modifiedAt: Date } | undefined = projects[0];

  if (projectDir) {
    const absPath = path.resolve(projectDir.trim());
    let match = projects.find(
      (p) => p.dir === absPath || p.name.toLowerCase() === projectDir.trim().toLowerCase()
    );
    if (match) {
      target = match;
      registerProject(target.dir);
    } else {
      // Accept any valid directory as a scannable project even without .codeatlas
      try {
        const stat = await fs.promises.stat(absPath);
        if (stat.isDirectory()) {
          registerProject(absPath);
          target = {
            name: path.basename(absPath),
            dir: absPath,
            analysisPath: path.join(absPath, ".codeatlas", "analysis.json"),
            modifiedAt: new Date()
          };
        } else {
          console.error(`[Auto-Scan] ⚠️ Path is not a directory, skipping: ${absPath}`);
          return null;
        }
      } catch {
        console.error(`[Auto-Scan] ⚠️ Directory not accessible, skipping: ${absPath}`);
        return null;
      }
    }
  } else if (target) {
    registerProject(target.dir);
  }

  try {
    if (onProjectLoadedCallback) {
      onProjectLoadedCallback(target.dir);
    }
    
    // Check in-memory cache first
    if (!force && !changedFilePath && inMemoryAnalysisCache.has(target.dir)) {
      const cached = inMemoryAnalysisCache.get(target.dir);
      return { analysis: cached, projectName: target.name, projectDir: target.dir };
    }

    const projectLabel = `[${target.name}]`;
    const startTime = Date.now();

    // Cache CodeAnalyzer instance for incremental updates
    let analyzer = analyzerInstances.get(target.dir);
    if (!analyzer) {
      analyzer = new CodeAnalyzer(target.dir, 5000);
      analyzerInstances.set(target.dir, analyzer);
    }

    let result: AnalysisResult;
    
    if (changedFilePath) {
      const relPath = path.relative(target.dir, changedFilePath);
      console.error(`[Indexing] ⚡ ${projectLabel} Incremental indexing file: ${relPath}`);
      result = await analyzer.analyzeFileIncremental(changedFilePath);
    } else {
      console.error(`[Indexing] 🔍 ${projectLabel} Starting AST indexing: ${target.dir}`);
      result = await analyzer.analyzeProject((percent, done, total) => {
        console.error(`[Indexing] ⏳ ${projectLabel} ${percent}% (${done}/${total} files)`);
      });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const { totalFilesAnalyzed, entityCounts } = result;
    
    if (changedFilePath) {
      console.error(
        `[Indexing] ✅ ${projectLabel} Incremental re-indexed in ${elapsed}s — ` +
        `Total: ${totalFilesAnalyzed} files | ${entityCounts.modules} modules | ` +
        `${entityCounts.classes} classes | ${entityCounts.functions} functions`
      );
    } else {
      console.error(
        `[Indexing] ✅ ${projectLabel} Done in ${elapsed}s — ` +
        `${totalFilesAnalyzed} files | ${entityCounts.modules} modules | ` +
        `${entityCounts.classes} classes | ${entityCounts.functions} functions`
      );
    }
    
    // Save in memory
    inMemoryAnalysisCache.set(target.dir, result);
    
    // Securely sync analysis to the CodeAtlas Remote VPS Cloud
    syncAnalysisToServer(target.name, result).catch((err) => {
      console.error(`[Auto-Scan] ❌ Background secure cloud sync failed: ${err}`);
    });
    
    return { analysis: result, projectName: target.name, projectDir: target.dir };
  } catch (err) {
    console.error(`[Auto-Scan] ❌ Dynamic async scanning failed: ${err}`);
    return null;
  }
}

export async function syncAnalysisToServer(projectName: string, analysis: any, businessRule?: string, changeDescription?: string): Promise<void> {
  const apiKey = process.env.CODEATLAS_API_KEY;
  if (!apiKey) {
    console.error("[Auto-Scan] ℹ️ CODEATLAS_API_KEY not set. Local analysis saved but cloud sync skipped.");
    throw new Error("CODEATLAS_API_KEY is not set.");
  }

  return new Promise((resolve, reject) => {
    try {
      const payload = JSON.stringify({ projectName, analysis, businessRule, changeDescription });
      const serverUrlStr = process.env.CODEATLAS_API_URL || "https://atlas.genrostore.com";
      const serverUrl = new URL(serverUrlStr);
      
      const options = {
        hostname: serverUrl.hostname,
        port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
        path: `/api/projects/sync?apiKey=${encodeURIComponent(apiKey)}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "Content-Length": Buffer.byteLength(payload)
        }
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.error(`[Auto-Scan] ✅ Securely synced ${projectName} AST analysis to CodeAtlas Cloud!`);
            resolve();
          } else {
            const errMsg = `Secure Cloud Sync failed with status ${res.statusCode}: ${data}`;
            console.error(`[Auto-Scan] ❌ ${errMsg}`);
            reject(new Error(errMsg));
          }
        });
      });

      req.on("error", (e) => {
        const errMsg = `Secure Cloud Sync Network Error: ${e.message}`;
        console.error(`[Auto-Scan] ❌ ${errMsg}`);
        reject(new Error(errMsg));
      });

      req.write(payload);
      req.end();
    } catch (err: unknown) {
      const errMsg = `Secure Cloud Sync Initialization Error: ${(err instanceof Error ? err.message : String(err))}`;
      console.error(`[Auto-Scan] ❌ ${errMsg}`);
      reject(new Error(errMsg));
    }
  });
}
