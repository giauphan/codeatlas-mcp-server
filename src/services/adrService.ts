import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ADR_DIR = path.join(os.homedir(), ".codeatlas", "adr");

export interface ADR {
  id: string;
  title: string;
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  context: string;
  decision: string;
  consequences: string;
  project: string;
  date?: string;
  supersededBy?: string;
}

const PROJECT_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const ID_RE = /^[a-zA-Z0-9_-]+$/;

function sanitizeProject(project: string): string {
  if (!PROJECT_NAME_RE.test(project)) {
    throw new Error(`Invalid project name: must match /^[a-zA-Z0-9_-]+$/`);
  }
  return project;
}

function sanitizeID(id: string): string {
  if (!ID_RE.test(id)) {
    throw new Error(`Invalid ADR ID: must match /^[a-zA-Z0-9_-]+$/`);
  }
  return id;
}

function ensureDir(project: string): string {
  const safeProject = sanitizeProject(project);
  const dir = path.join(ADR_DIR, safeProject);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listADRs(project?: string): ADR[] {
  const safeProject = project ? sanitizeProject(project) : undefined;
  const base = safeProject ? path.join(ADR_DIR, safeProject) : ADR_DIR;
  if (!fs.existsSync(base)) return [];
  const all: ADR[] = [];
  if (safeProject) {
    for (const f of fs.readdirSync(base)) {
      if (f.endsWith(".json")) {
        try {
          all.push(JSON.parse(fs.readFileSync(path.join(base, f), "utf-8")));
        } catch { /* skip corrupt */ }
      }
    }
  } else {
    for (const pdir of fs.readdirSync(base)) {
      const pPath = path.join(base, pdir);
      if (!fs.statSync(pPath).isDirectory()) continue;
      for (const f of fs.readdirSync(pPath)) {
        if (f.endsWith(".json")) {
          try {
            all.push(JSON.parse(fs.readFileSync(path.join(pPath, f), "utf-8")));
          } catch { /* skip */ }
        }
      }
    }
  }
  return all.sort((a, b) => ((b.date || "").localeCompare(a.date || "")));
}

export function getADR(id: string, project: string): ADR | null {
  const safeProject = sanitizeProject(project);
  const safeId = sanitizeID(id);
  const file = path.join(ADR_DIR, safeProject, `${safeId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch { return null; }
}

export function saveADR(adr: ADR): ADR {
  const dir = ensureDir(adr.project);
  const file = path.join(dir, `${adr.id}.json`);
  if (!adr.date) adr.date = new Date().toISOString().split("T")[0];
  fs.writeFileSync(file, JSON.stringify(adr, null, 2));
  return adr;
}

export function deleteADR(id: string, project: string): boolean {
  const safeProject = sanitizeProject(project);
  const safeId = sanitizeID(id);
  const file = path.join(ADR_DIR, safeProject, `${safeId}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
