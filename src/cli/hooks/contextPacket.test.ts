import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { commitContextPacket, prepareContextPacket } from "./contextPacket.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; delete process.env.CODEATLAS_CONTEXT_CACHE_DIR; delete process.env.CODEATLAS_CONTEXT_SUPPRESS_DUPLICATES; });

test("suppresses an unchanged packet for the same session but keeps sessions separate", async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-context-cache-")); process.env.CODEATLAS_CONTEXT_CACHE_DIR = root;
  const input = { projectId: "project_1", sessionId: "session-1", eventName: "UserPromptSubmit" as const, content: "verified task context" };
  const first = await prepareContextPacket(input);
  assert.deepEqual(first, { status: "inject", contentHash: first.contentHash });
  await commitContextPacket(input, first.contentHash);
  assert.deepEqual(await prepareContextPacket(input), { status: "suppressed", reason: "duplicate", contentHash: first.contentHash });
  assert.equal((await prepareContextPacket({ ...input, sessionId: "session-2" })).status, "inject");
});

test("duplicate suppression can be rolled back and cache stores only a digest", async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-context-cache-")); process.env.CODEATLAS_CONTEXT_CACHE_DIR = root;
  const input = { projectId: "project_1", sessionId: "session-1", eventName: "SessionStart" as const, content: "secret-bearing context" };
  const first = await prepareContextPacket(input); await commitContextPacket(input, first.contentHash);
  process.env.CODEATLAS_CONTEXT_SUPPRESS_DUPLICATES = "0";
  assert.equal((await prepareContextPacket(input)).status, "inject");
  const projectHash = createHash("sha256").update(input.projectId).digest("hex");
  const sessionHash = createHash("sha256").update(input.sessionId).digest("hex");
  const cachePath = path.join(root, projectHash, `${sessionHash}.json`);
  const stored = await readFile(cachePath, "utf8");
  assert.doesNotMatch(stored, /secret-bearing context/);
  assert.match(stored, /^[a-f0-9]{64}$/);
});
