import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { resolveExecutable } from "./commandPath.js";

const roots: string[] = [];
afterEach(() => {
  process.env.PATH = originalPath;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const originalPath = process.env.PATH;

test("resolves commands to executable absolute paths before spawning", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codeatlas-command-path-"));
  roots.push(root);
  const executable = path.join(root, "git");
  writeFileSync(executable, "#!/bin/sh\nexit 0\n");
  chmodSync(executable, 0o700);
  process.env.PATH = root;

  assert.equal(resolveExecutable("git"), executable);
});

test("rejects commands missing from PATH", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codeatlas-command-path-empty-"));
  roots.push(root);
  process.env.PATH = root;

  assert.throws(() => resolveExecutable("missing-command"), /Executable not found/);
});
