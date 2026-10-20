import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ContextHookEvent = "SessionStart" | "UserPromptSubmit";
export interface ContextPacketInput { projectId: string; sessionId: string; eventName: ContextHookEvent; content: string }
export type ContextPacketDecision =
  | { status: "inject"; contentHash: string }
  | { status: "suppressed"; reason: "duplicate"; contentHash: string };

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function cachePath(input: ContextPacketInput): string {
  const root = path.resolve(process.env.CODEATLAS_CONTEXT_CACHE_DIR ?? path.join(os.homedir(), ".codeatlas", "context-cache"));
  return path.join(root, digest(input.projectId), `${digest(input.sessionId)}.json`);
}

export async function prepareContextPacket(input: ContextPacketInput): Promise<ContextPacketDecision> {
  const contentHash = digest(input.content);
  if (process.env.CODEATLAS_CONTEXT_SUPPRESS_DUPLICATES === "0") return { status: "inject", contentHash };
  try {
    const previousHash = (await readFile(cachePath(input), "utf8")).trim();
    if (previousHash === contentHash) return { status: "suppressed", reason: "duplicate", contentHash };
  } catch { /* No prior packet exists. */ }
  return { status: "inject", contentHash };
}

export async function commitContextPacket(input: ContextPacketInput, contentHash: string): Promise<void> {
  const file = cachePath(input);
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temp, "w", 0o600);
  try { await handle.writeFile(contentHash); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, file);
  try { const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); } } catch { /* best effort */ }
}
