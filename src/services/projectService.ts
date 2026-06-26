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

export const fsWrapper = {
  existsSync: (p: string) => fs.existsSync(p),
  readFileSync: (p: string, encoding: "utf8") => fs.readFileSync(p, encoding),
  readdirSync: (p: string) => fs.readdirSync(p)
};

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

function findDirMatchingNormalized(normalized: string): string | null {
  if (!/^[a-zA-Z0-9_]+$/.test(normalized)) {
    return null;
  }

  const directPath = "/" + normalized.replace(/_/g, "/");
  if (fsWrapper.existsSync(directPath)) {
    return directPath;
  }
  
  const parts = normalized.split("_").filter(Boolean);
  if (parts.length === 0) return null;
  
  let currentPath = "/";
  for (let i = 0; i < parts.length; i++) {
    if (!fsWrapper.existsSync(currentPath)) return null;
    
    try {
      const files = fsWrapper.readdirSync(currentPath);
      let matchedEntry = "";
      let matchedPartCount = 0;
      let matchedIsExactCase = false;
      
      for (const file of files) {
        const normFile = file.replace(/[^a-zA-Z0-9]/g, "_");
        const normFileParts = normFile.split("_").filter(Boolean);
        if (normFileParts.length === 0) continue;
        
        let match = true;
        let isExactCase = true;
        for (let j = 0; j < normFileParts.length; j++) {
          if (i + j >= parts.length) {
            match = false;
            break;
          }
          const partA = parts[i + j];
          const partB = normFileParts[j];
          if (partA.toLowerCase() !== partB.toLowerCase()) {
            match = false;
            break;
          }
          if (partA !== partB) {
            isExactCase = false;
          }
        }
        
        if (match) {
          if (normFileParts.length > matchedPartCount || (normFileParts.length === matchedPartCount && isExactCase && !matchedIsExactCase)) {
            matchedEntry = file;
            matchedPartCount = normFileParts.length;
            matchedIsExactCase = isExactCase;
          }
        }
      }
      
      if (matchedEntry) {
        currentPath = path.join(currentPath, matchedEntry);
        i += matchedPartCount - 1;
      } else {
        currentPath = path.join(currentPath, parts[i]);
      }
    } catch {
      return null;
    }
  }
  
  if (fsWrapper.existsSync(currentPath)) {
    return currentPath;
  }
  return null;
}

/**
 * Discovers workspace directory by traversing ancestor processes via /proc.
 * @param startPid - Process ID to start traversal from (defaults to current process)
 * @returns Resolved workspace directory path, or null if not found or on unsupported platforms
 * @platform Linux only - requires /proc filesystem
 */
export function getWorkspaceFromAncestors(startPid: number = process.pid): string | null {
  try {
    // 1. Build a map of PPID -> children PIDs by scanning /proc once.
    // This allows us to inspect siblings of processes in the ancestor chain.
    const ppidToChildren = new Map<number, number[]>();
    if (fsWrapper.existsSync('/proc')) {
      const files = fsWrapper.readdirSync('/proc');
      for (const file of files) {
        if (/^\d+$/.test(file)) {
          const pid = parseInt(file, 10);
          const statusPath = `/proc/${pid}/status`;
          try {
            if (fsWrapper.existsSync(statusPath)) {
              const statusContent = fsWrapper.readFileSync(statusPath, 'utf8');
              const ppidMatch = statusContent.match(/^PPid:\s+(\d+)/m);
              if (ppidMatch) {
                const ppid = parseInt(ppidMatch[1], 10);
                if (!ppidToChildren.has(ppid)) {
                  ppidToChildren.set(ppid, []);
                }
                ppidToChildren.get(ppid)!.push(pid);
              }
            }
          } catch {
            // Ignore access errors on individual processes
          }
        }
      }
    }

    // 2. Traverse up the ancestor chain
    let currentPid = startPid;
    let iterations = 0;
    while (currentPid > 1 && iterations < 100) {
      iterations++;
      const statusPath = `/proc/${currentPid}/status`;
      if (!fsWrapper.existsSync(statusPath)) break;
      const statusContent = fsWrapper.readFileSync(statusPath, 'utf8');
      const ppidMatch = statusContent.match(/^PPid:\s+(\d+)/m);
      if (!ppidMatch) break;
      const ppid = parseInt(ppidMatch[1], 10);
      if (ppid <= 1 || ppid === currentPid) break;

      // First check: does the parent process itself have the workspace ID?
      const parentCmdlinePath = `/proc/${ppid}/cmdline`;
      if (fsWrapper.existsSync(parentCmdlinePath)) {
        const cmdline = fsWrapper.readFileSync(parentCmdlinePath, 'utf8');
        const args = cmdline.split('\0');
        const workspaceIdIndex = args.indexOf('--workspace_id');
        if (workspaceIdIndex !== -1 && workspaceIdIndex + 1 < args.length) {
          const workspaceId = args[workspaceIdIndex + 1];
          if (workspaceId.startsWith('file_')) {
            const normalized = workspaceId.substring(5);
            const dir = findDirMatchingNormalized(normalized);
            if (dir) return dir;
          }
        }
      }

      // Second check: check all siblings (other children of ppid)
      const siblings = ppidToChildren.get(ppid) || [];
      for (const siblingPid of siblings) {
        if (siblingPid === currentPid) continue; // Skip self
        const cmdlinePath = `/proc/${siblingPid}/cmdline`;
        if (fsWrapper.existsSync(cmdlinePath)) {
          const cmdline = fsWrapper.readFileSync(cmdlinePath, 'utf8');
          const args = cmdline.split('\0');
          const workspaceIdIndex = args.indexOf('--workspace_id');
          if (workspaceIdIndex !== -1 && workspaceIdIndex + 1 < args.length) {
            const workspaceId = args[workspaceIdIndex + 1];
            if (workspaceId.startsWith('file_')) {
              const normalized = workspaceId.substring(5);
              const dir = findDirMatchingNormalized(normalized);
              if (dir) return dir;
            }
          }
        }
      }

      currentPid = ppid;
    }
  } catch {
    // Ignore and fallback
  }
  return null;
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
    if (isSystemIdeDirectory(absPath)) {
      return;
    }
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

/**
 * LRU cache that evicts oldest entries when exceeding maxSize.
 * On eviction, also cleans up the corresponding CodeAnalyzer instance.
 */
class LRUCache<V> {
  private map = new Map<string, V>();
  private readonly maxSize: number;
  private evictionLog: string;

  constructor(maxSize: number, name = "cache") {
    this.maxSize = maxSize;
    this.evictionLog = `[${name}]`;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): this {
    this.map.delete(key); // Remove if exists, re-add at end
    this.map.set(key, value);
    this.evict();
    return this;
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  private evict() {
    while (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
        // Also cleanup the CodeAnalyzer instance to free memory
        const hadAnalyzer = analyzerInstances.delete(oldestKey);
        console.error(`${this.evictionLog} 🗑️ Evicted cache for: ${oldestKey}${hadAnalyzer ? ' (analyzer also freed)' : ''}`);
      }
    }
  }

  [Symbol.iterator](): IterableIterator<[string, V]> {
    return this.map[Symbol.iterator]();
  }
}

export const inMemoryAnalysisCache = new LRUCache<any>(3, "Cache");

export const analyzerInstances = new LRUCache<CodeAnalyzer>(5, "Analyzer");

export function getOpenIdeForDir(dir: string): string | null {
  try {
    const absPath = path.resolve(dir.trim());
    if (!fs.existsSync('/proc')) return null;
    const files = fs.readdirSync('/proc');
    // Safety: only scan up to 500 process entries to prevent abuse
    const pidEntries = files.filter(f => /^\d+$/.test(f)).slice(0, 500);
    for (const file of pidEntries) {
      const pid = file;
      const cmdlinePath = `/proc/${pid}/cmdline`;
      try {
          if (fs.existsSync(cmdlinePath)) {
            const cmdline = fs.readFileSync(cmdlinePath, 'utf8');
            const args = cmdline.split('\0').filter(Boolean);
            if (args.length === 0) continue;
            
            const hasDirArg = args.some(arg => {
              try {
                return path.resolve(arg) === absPath;
              } catch {
                return false;
              }
            });
            
            if (hasDirArg) {
              const exePath = args[0].toLowerCase();
              const ideKeywords = ['code', 'vscode', 'cursor', 'windsurf', 'intellij', 'webstorm', 'phpstorm', 'idea', 'eclipse', 'sublime', 'gemini-cli'];
              for (const keyword of ideKeywords) {
                if (exePath.includes(keyword)) {
                  return path.basename(args[0]);
                }
              }
            }
          }
        } catch {
          // ignore
        }
    }
  } catch {
    // ignore
  }
  return null;
}

export function isProjectDirectory(dir: string): boolean {
  if (isSystemIdeDirectory(dir)) {
    return false;
  }
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return false;
    }
    const gitPath = path.join(dir, ".git");
    if (fs.existsSync(gitPath)) {
      return true;
    }
    const codeatlasPath = path.join(dir, ".codeatlas");
    if (fs.existsSync(codeatlasPath)) {
      return true;
    }
    const openIde = getOpenIdeForDir(dir);
    if (openIde) {
      console.error(`[Project-Discovery] 🖥️ Project ${dir} is active in IDE: ${openIde}`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function isProjectDirectoryAsync(dir: string): Promise<boolean> {
  if (isSystemIdeDirectory(dir)) {
    return false;
  }
  try {
    const stat = await fs.promises.stat(dir);
    if (!stat.isDirectory()) {
      return false;
    }
    const gitPath = path.join(dir, ".git");
    if (await fileExists(gitPath)) {
      return true;
    }
    const codeatlasPath = path.join(dir, ".codeatlas");
    if (await fileExists(codeatlasPath)) {
      return true;
    }
    const openIde = getOpenIdeForDir(dir);
    if (openIde) {
      console.error(`[Project-Discovery] 🖥️ Project ${dir} is active in IDE: ${openIde}`);
      return true;
    }
    return false;
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

export function isSystemIdeDirectory(dir: string): boolean {
  try {
    const absPath = path.resolve(dir.trim());
    if (absPath === "/config/Downloads/Antigravity" || absPath.startsWith("/config/Downloads/Antigravity/")) {
      return true;
    }
    
    // Dynamically resolve ~/.gemini/antigravity across operating systems
    const homeDir = os.homedir();
    const dynamicAntigravityPath = path.resolve(path.join(homeDir, ".gemini", "antigravity"));
    if (absPath === dynamicAntigravityPath || absPath.startsWith(dynamicAntigravityPath + path.sep)) {
      return true;
    }

    // Ignore home directory itself, system root, or /config root
    if (absPath === homeDir || absPath === "/" || absPath === "/config") {
      return true;
    }

    // Ignore system/IDE configuration folders starting with a dot (e.g. .codeium, .vscode, .cursor)
    // but allow double-dot prefixes (like ..projectA)
    const parts = absPath.split(path.sep);
    if (parts.some(part => part.startsWith('.') && !part.startsWith('..') && part !== '.codeatlas')) {
      return true;
    }

    // Check if it's the IDE resources directory
    if (fsWrapper.existsSync(path.join(absPath, "resources", "app", "extensions")) ||
        fsWrapper.existsSync(path.join(absPath, "resources", "app", "out", "vs"))) {
      return true;
    }
  } catch {
    // Ignore errors
  }
  return false;
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

/**
 * Scans a parent directory for sub-projects with .git directories,
 * optionally filtering to only those currently open in an IDE.
 * Scans up to 3 levels deep and skips node_modules / hidden dirs.
 */
export async function discoverGitSubProjects(parentDir: string, onlyIdeOpen = false): Promise<string[]> {
  const discovered: string[] = [];
  const seen = new Set<string>();

  async function walk(dir: string, depth: number) {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);
      const resolved = path.resolve(fullPath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      if (await fileExists(path.join(resolved, '.git'))) {
        if (onlyIdeOpen) {
          const ide = getOpenIdeForDir(resolved);
          if (ide) {
            console.error(`[SubProject] 🖥️ Found project "${entry.name}" — open in IDE: ${ide}`);
            discovered.push(resolved);
          }
          // else: skip — no IDE has this open
        } else {
          console.error(`[SubProject] 📂 Found project: ${entry.name}`);
          discovered.push(resolved);
        }
      } else if (depth < 3) {
        await walk(resolved, depth + 1);
      }
    }
  }

  await walk(parentDir, 0);
  return discovered;
}

export function discoverProjects(tenantId?: string): { name: string; dir: string; analysisPath: string; modifiedAt: Date }[] {
  const projects: { name: string; dir: string; analysisPath: string; modifiedAt: Date }[] = [];
  const searchDirs: string[] = [];

  // Multi-Tenant Isolation
  if (process.env.CODEATLAS_MULTI_TENANT === "true") {
    const auth = authStorage.getStore();
    const isSystemAdmin = auth
      ? (auth.uid === "admin" || auth.role === "admin")
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
      const defaultProjDir = process.env.CODEATLAS_PROJECT_DIR || getWorkspaceFromAncestors() || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
      if (defaultProjDir) {
        searchDirs.push(defaultProjDir);
      }
      searchDirs.push(process.cwd());
    } else {
      return [];
    }
  } else {
    const defaultProjDir = process.env.CODEATLAS_PROJECT_DIR || getWorkspaceFromAncestors() || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
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
          let updated = false;
          const filtered = registered.filter((dir) => {
            if (isSystemIdeDirectory(dir)) {
              updated = true;
              return false;
            }
            return true;
          });
          if (updated) {
            fs.writeFileSync(regPath, JSON.stringify(filtered, null, 2));
          }
          for (const dir of filtered) {
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
    if (isSystemIdeDirectory(dir)) continue;

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
    if (isSystemIdeDirectory(absPath)) {
      console.warn(`[Auto-Scan] 🛡️ Ignored IDE system/extensions directory from workspace indexing: ${absPath}`);
      return null;
    }
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
      ? (auth.uid === "admin" || auth.role === "admin")
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
      const defaultProjDir = process.env.CODEATLAS_PROJECT_DIR || getWorkspaceFromAncestors() || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
      if (defaultProjDir) {
        searchDirs.push(defaultProjDir);
      }
      searchDirs.push(process.cwd());
    } else {
      return [];
    }
  } else {
    const defaultProjDir = process.env.CODEATLAS_PROJECT_DIR || getWorkspaceFromAncestors() || process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
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
          let updated = false;
          const filtered = registered.filter((dir) => {
            if (isSystemIdeDirectory(dir)) {
              updated = true;
              return false;
            }
            return true;
          });
          if (updated) {
            await fs.promises.writeFile(regPath, JSON.stringify(filtered, null, 2));
          }
          for (const dir of filtered) {
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
    if (isSystemIdeDirectory(dir)) continue;

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
    if (isSystemIdeDirectory(absPath)) {
      console.warn(`[Auto-Scan] 🛡️ Ignored IDE system/extensions directory from workspace indexing: ${absPath}`);
      return null;
    }
    let match = projects.find(
      (p) => p.dir === absPath || p.name.toLowerCase() === projectDir.trim().toLowerCase()
    );
    if (match) {
      target = match;
      registerProject(target.dir);
    } else if (await isProjectDirectoryAsync(absPath)) {
      registerProject(absPath);
      target = {
        name: path.basename(absPath),
        dir: absPath,
        analysisPath: path.join(absPath, ".codeatlas", "analysis.json"),
        modifiedAt: new Date()
      };
    } else {
      console.error(`[Auto-Scan] ⚠️ Path is not a valid project directory, skipping: ${absPath}`);
      return null;
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
      result = await analyzer.analyzeProject((percent, done, total, currentFile) => {
        const fileMsg = currentFile ? ` — current: ${currentFile}` : '';
        console.error(`[Indexing] ⏳ ${projectLabel} ${percent}% (${done}/${total} files)${fileMsg}`);
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

export function getResolvedApiKey(): string | undefined {
  let key = process.env.CODEATLAS_API_KEY;
  if (key && (key.startsWith("ca_") || key.startsWith("test-"))) {
    return key;
  }

  const homeDir = os.homedir();
  const pathsToTry = [
    path.join(homeDir, ".gemini", "antigravity", "mcp_config.json"),
    path.join(homeDir, ".cursor", "mcp.json"),
    path.join(homeDir, ".codeatlas", "config.json"),
    path.join(homeDir, ".config", "Claude", "claude_desktop_config.json"),
    path.join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    path.join(homeDir, "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
  ];

  for (const filePath of pathsToTry) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(content);
        
        if (parsed.mcpServers?.codeatlas?.env?.CODEATLAS_API_KEY) {
          const foundKey = parsed.mcpServers.codeatlas.env.CODEATLAS_API_KEY;
          if (foundKey && typeof foundKey === 'string' && foundKey.trim().length > 0) {
            return foundKey.trim();
          }
        }
        
        for (const serverName of Object.keys(parsed.mcpServers || {})) {
          if (serverName.toLowerCase().includes("codeatlas")) {
            const foundKey = parsed.mcpServers[serverName]?.env?.CODEATLAS_API_KEY;
            if (foundKey && typeof foundKey === 'string' && foundKey.trim().length > 0) {
              return foundKey.trim();
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

export async function syncAnalysisToServer(projectName: string, analysis: any, businessRule?: string, changeDescription?: string): Promise<void> {
  const apiKey = getResolvedApiKey();
  if (!apiKey) {
    console.error("[Auto-Scan] ℹ️ CODEATLAS_API_KEY not set. Local analysis saved but cloud sync skipped.");
    throw new Error("CODEATLAS_API_KEY is not set.");
  }

  return new Promise((resolve, reject) => {
    try {
      const payload = JSON.stringify({ projectName, analysis, businessRule, changeDescription });
      const serverUrlStr = process.env.CODEATLAS_API_URL || "https://your-server.com/api";
      const serverApiKey = getResolvedApiKey();
      if (!serverApiKey || serverUrlStr === "https://your-server.com/api") {
        console.error(`[Auto-Scan] ⏭️ Cloud sync skipped — no CODEATLAS_API_URL configured.`);
        return;
      }
      const serverUrl = new URL(serverUrlStr);
      
      const options = {
        hostname: serverUrl.hostname,
        port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
        path: `/api/projects/sync`,
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
            resolve(undefined);
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

export async function getEpisodicMemoriesFromServer(projectName: string, eventType?: "BUSINESS_RULE" | "CHANGE_LOG"): Promise<any[]> {
  const apiKey = getResolvedApiKey();
  if (!apiKey) {
    console.error("[Auto-Scan] ℹ️ CODEATLAS_API_KEY not set. Cannot fetch episodic memory from cloud.");
    throw new Error("CODEATLAS_API_KEY is not set.");
  }

  return new Promise((resolve, reject) => {
    try {
      const serverUrlStr = process.env.CODEATLAS_API_URL || "https://your-server.com/api";
      const serverApiKey = getResolvedApiKey();
      if (!serverApiKey || serverUrlStr === "https://your-server.com/api") {
        console.error(`[Auto-Scan] ⏭️ Cloud sync skipped — no CODEATLAS_API_URL configured.`);
        resolve([]);
        return;
      }
      const serverUrl = new URL(serverUrlStr);
      
      let pathStr = `/api/projects/memory?projectName=${encodeURIComponent(projectName)}`;
      if (eventType) {
        pathStr += `&eventType=${encodeURIComponent(eventType)}`;
      }

      const options = {
        hostname: serverUrl.hostname,
        port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
        path: pathStr,
        method: "GET",
        headers: {
          "x-api-key": apiKey
        }
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const responseObj = JSON.parse(data);
              resolve(responseObj.memories || []);
            } catch (err) {
              reject(new Error(`Failed to parse memory response: ${data}`));
            }
          } else {
            const errMsg = `Failed to get episodic memory from cloud: status ${res.statusCode}: ${data}`;
            reject(new Error(errMsg));
          }
        });
      });

      req.on("error", (e) => {
        const errMsg = `Memory Retrieval Network Error: ${e.message}`;
        reject(new Error(errMsg));
      });

      req.end();
    } catch (error) {
      reject(error);
    }
  });
}


