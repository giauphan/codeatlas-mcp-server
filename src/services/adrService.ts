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

function ensureDir(project: string): string {
  const dir = path.join(ADR_DIR, project);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listADRs(project?: string): ADR[] {
  const base = project ? path.join(ADR_DIR, project) : ADR_DIR;
  if (!fs.existsSync(base)) return [];
  const all: ADR[] = [];
  if (project) {
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
  const file = path.join(ADR_DIR, project, `${id}.json`);
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
  const file = path.join(ADR_DIR, project, `${id}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
