import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveExecutable } from "../utils/commandPath.js";

export interface ProjectIdentity {
  project_id: string;
  project: string;
  workspace_path: string;
  canonical_root: string;
  identity_source: "explicit" | "git_common_dir" | "workspace_path";
}

function getCanonicalProjectRoot(workspacePath: string): { root: string; source: ProjectIdentity["identity_source"] } {
  let gitExecutable: string;
  try { gitExecutable = resolveExecutable("git"); } catch { return { root: fs.realpathSync(workspacePath), source: "workspace_path" }; }
  const git = spawnSync(gitExecutable, ["-C", workspacePath, "rev-parse", "--git-common-dir"], {
    encoding: "utf8",
    timeout: 1_000,
  });
  if (git.status === 0 && git.stdout.trim()) {
    const commonDir = fs.realpathSync(path.resolve(workspacePath, git.stdout.trim()));
    if (path.basename(commonDir) === ".git") {
      return { root: fs.realpathSync(path.dirname(commonDir)), source: "git_common_dir" };
    }
    const topLevel = spawnSync(gitExecutable, ["-C", workspacePath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 1_000,
    });
    if (topLevel.status === 0 && topLevel.stdout.trim()) {
      return { root: fs.realpathSync(topLevel.stdout.trim()), source: "git_common_dir" };
    }
  }
  return { root: fs.realpathSync(workspacePath), source: "workspace_path" };
}

function validateProjectId(value: string): string {
  const projectId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(projectId)) {
    throw new Error("invalid CODEATLAS_PROJECT_ID: use 1-255 letters, digits, dots, underscores, colons, or hyphens");
  }
  return projectId;
}

export function resolveProjectIdentity(
  workspacePath: string,
  explicitProjectId = process.env.CODEATLAS_PROJECT_ID,
  projectOverride = process.env.CODEATLAS_PROJECT,
): ProjectIdentity {
  const resolvedWorkspace = fs.realpathSync(path.resolve(workspacePath));
  const canonical = getCanonicalProjectRoot(resolvedWorkspace);
  const projectId = explicitProjectId?.trim()
    ? validateProjectId(explicitProjectId)
    : `project_${createHash("sha256").update(`codeatlas-project-v1\0${canonical.root}`).digest("hex")}`;
  const project = projectOverride?.trim() || path.basename(canonical.root);

  return {
    project_id: projectId,
    project,
    workspace_path: resolvedWorkspace,
    canonical_root: canonical.root,
    identity_source: explicitProjectId?.trim() ? "explicit" : canonical.source,
  };
}
