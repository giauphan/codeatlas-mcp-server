import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveProjectIdentity } from "./projectIdentity.js";

describe("project identity", () => {
  it("uses the same project ID for a repository and its git worktree", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-identity-"));
    const repo = path.join(tempRoot, "repo");
    const worktree = path.join(tempRoot, "worktree");
    fs.mkdirSync(repo);
    try {
      execFileSync("git", ["init", "-q", repo]);
      execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial"], { stdio: "ignore" });
      execFileSync("git", ["-C", repo, "worktree", "add", "-q", "-b", "identity-test", worktree]);
      assert.equal(resolveProjectIdentity(repo).project_id, resolveProjectIdentity(worktree).project_id);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("distinguishes two projects that share a directory basename", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-identity-"));
    const first = path.join(tempRoot, "one", "same-name");
    const second = path.join(tempRoot, "two", "same-name");
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    try {
      assert.notEqual(resolveProjectIdentity(first).project_id, resolveProjectIdentity(second).project_id);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("honors explicit project IDs and preserves the legacy display name separately", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-identity-"));
    try {
      const identity = resolveProjectIdentity(tempRoot, "team:project-17", "legacy-display-name");
      assert.equal(identity.project_id, "team:project-17");
      assert.equal(identity.project, "legacy-display-name");
      assert.equal(identity.workspace_path, fs.realpathSync(tempRoot));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsafe explicit project IDs", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-identity-"));
    try {
      assert.throws(() => resolveProjectIdentity(tempRoot, "../../other-project"), /invalid CODEATLAS_PROJECT_ID/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
