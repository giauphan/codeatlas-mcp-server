import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { redactSensitiveContent } from "./eventDecoder.js";

export interface TranscriptCursor {
  dev: number;
  ino: number;
  offset: number;
  prefix_hash: string;
}

export interface NormalizedTranscriptEvent {
  event_id: string;
  session_id: string;
  project_id: string;
  content: string;
  actor_role: "USER" | "ASSISTANT";
  occurred_at?: string;
  source_spans: Array<{ start: number; end: number }>;
  source_metadata: { source: "claude_transcript_jsonl"; offset_unit: "byte" };
}

export interface ReadTranscriptResult {
  events: NormalizedTranscriptEvent[];
  cursor: TranscriptCursor;
  observedAt: number;
}

function boundedEnvBytes(name: string, fallback: number, minimum: number, maximum: number): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured >= minimum && configured <= maximum ? Math.trunc(configured) : fallback;
}

async function hashFilePrefix(file: string, length: number): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(file, "r");
  try {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < length) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, length - position), position);
      if (!bytesRead) break;
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally { await handle.close(); }
  return hash.digest("hex");
}

function claudeEncodedPath(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "-");
}

export async function validateClaudeTranscriptPath(args: {
  transcriptPath: string;
  sessionId: string;
  cwd: string;
  canonicalRoot?: string;
  projectsRoot?: string;
}): Promise<string> {
  if (!/^[A-Za-z0-9._-]{1,255}$/.test(args.sessionId)) throw new Error("invalid session id");
  const projectsRoot = await realpath(path.resolve(args.projectsRoot ?? process.env.CODEATLAS_CLAUDE_PROJECTS_DIR ?? path.join(process.env.HOME ?? "", ".claude", "projects")));
  const provided = await realpath(path.resolve(args.transcriptPath));
  if (path.basename(provided) !== `${args.sessionId}.jsonl`) throw new Error("transcript filename does not match session");
  const aliases = [args.cwd, args.canonicalRoot].filter((item): item is string => Boolean(item));
  const realAliases = await Promise.all(aliases.map(async (item) => realpath(item).catch(() => path.resolve(item))));
  const allowedDirectories = new Set([...aliases, ...realAliases].map(claudeEncodedPath));
  const relative = path.relative(projectsRoot, provided);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("transcript is outside Claude projects root");
  const pieces = relative.split(path.sep);
  if (pieces.length !== 2 || !allowedDirectories.has(pieces[0]!)) throw new Error("transcript project directory is not authorized");
  return provided;
}

function extractMessageText(row: Record<string, unknown>): string {
  if (row.type !== "user" && row.type !== "assistant") return "";
  const message = row.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return "";
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.filter((part): part is Record<string, unknown> => typeof part === "object" && part !== null && !Array.isArray(part))
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => (part.text as string).trim()).filter(Boolean).join("\n");
}

function sanitizeTranscriptText(text: string): string {
  const redacted = redactSensitiveContent(text);
  const max = 1_800;
  if (redacted.length <= max) return redacted;
  const marker = "\n[… output truncated …]\n";
  return `${redacted.slice(0, 900 - Math.floor(marker.length / 2))}${marker}${redacted.slice(-(max - 900 - Math.ceil(marker.length / 2)))}`;
}

export async function readClaudeTranscript(args: {
  transcriptPath: string;
  sessionId: string;
  projectId: string;
  cursor: TranscriptCursor | null;
  authorizedCwds?: string[];
}): Promise<ReadTranscriptResult> {
  const transcriptPath = await realpath(args.transcriptPath);
  const info = await stat(transcriptPath);
  const maxFileBytes = boundedEnvBytes("CODEATLAS_TRANSCRIPT_MAX_FILE_BYTES", 128 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024);
  if (info.size > maxFileBytes) throw new Error("transcript exceeds configured safety limit; no cursor advanced");
  const batchBytes = boundedEnvBytes("CODEATLAS_TRANSCRIPT_BATCH_BYTES", 1024 * 1024, 64 * 1024, 16 * 1024 * 1024);
  const maxLineBytes = 16 * 1024 * 1024;
  const sameFile = Boolean(args.cursor && args.cursor.dev === info.dev && args.cursor.ino === info.ino && info.size >= args.cursor.offset &&
    await hashFilePrefix(transcriptPath, args.cursor.offset) === args.cursor.prefix_hash);
  let offset = sameFile && args.cursor ? args.cursor.offset : 0;
  if (offset > info.size) offset = 0;
  const handle = await open(transcriptPath, "r");
  let unread: Buffer;
  try {
    const initialLength = Math.min(batchBytes, info.size - offset);
    unread = Buffer.alloc(initialLength);
    if (initialLength) await handle.read(unread, 0, initialLength, offset);
    if (unread.indexOf(0x0a) < 0 && info.size - offset > unread.length) {
      const expandedLength = Math.min(maxLineBytes, info.size - offset);
      if (expandedLength > unread.length) {
        const expanded = Buffer.alloc(expandedLength);
        await handle.read(expanded, 0, expandedLength, offset);
        unread = expanded;
      }
      if (unread.indexOf(0x0a) < 0 && info.size - offset > unread.length) throw new Error("transcript line exceeds 16 MiB safety limit; no cursor advanced");
    }
  } finally { await handle.close(); }
  const newline = unread.lastIndexOf(0x0a);
  const complete = newline < 0 ? Buffer.alloc(0) : unread.subarray(0, newline + 1);
  const completeEnd = offset + complete.length;
  const events: NormalizedTranscriptEvent[] = [];
  const allowedCwds = await Promise.all((args.authorizedCwds ?? []).map(async (cwd) => realpath(cwd).catch(() => path.resolve(cwd))));
  let lineOffset = offset;
  for (const rawLine of complete.toString("utf8").split("\n")) {
    if (!rawLine) { lineOffset += 1; continue; }
    const lineBytes = Buffer.byteLength(rawLine) + 1;
    try {
      const row: unknown = JSON.parse(rawLine);
      if (typeof row === "object" && row !== null && !Array.isArray(row)) {
        const record = row as Record<string, unknown>;
        const rowSession = typeof record.sessionId === "string" ? record.sessionId : typeof record.session_id === "string" ? record.session_id : undefined;
        if (rowSession && rowSession !== args.sessionId) { lineOffset += lineBytes; continue; }
        const rowCwd = typeof record.cwd === "string" ? record.cwd : undefined;
        if (rowCwd && allowedCwds.length) {
          const normalizedCwd = await realpath(rowCwd).catch(() => path.resolve(rowCwd));
          const insideAuthorizedRoot = allowedCwds.some((root) => {
            const relative = path.relative(root, normalizedCwd);
            return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
          });
          if (!insideAuthorizedRoot) { lineOffset += lineBytes; continue; }
        }
        const content = extractMessageText(record);
        if (content) {
          const suppliedUuid = typeof record.uuid === "string" && /^[A-Za-z0-9._:-]{1,255}$/.test(record.uuid) ? record.uuid : undefined;
          const sourceHash = createHash("sha256").update(`${args.projectId}\0${args.sessionId}\0${lineOffset}\0${rawLine}`).digest("hex");
          const eventId = suppliedUuid ? `claude_${createHash("sha256").update(`${args.projectId}\0${args.sessionId}\0${suppliedUuid}`).digest("hex")}` : `claude_${sourceHash}`;
          const time = typeof record.timestamp === "string" && !Number.isNaN(Date.parse(record.timestamp)) ? record.timestamp : undefined;
          const actorRole = record.type === "user" ? "USER" : "ASSISTANT";
          const roleContent = `[${actorRole}]\n${content}`;
          events.push({ event_id: eventId, session_id: args.sessionId, project_id: args.projectId, actor_role: actorRole, content: sanitizeTranscriptText(roleContent), source_spans: [{ start: lineOffset, end: lineOffset + lineBytes }], source_metadata: { source: "claude_transcript_jsonl", offset_unit: "byte" }, ...(time ? { occurred_at: time } : {}) });
        }
      }
    } catch { /* An invalid complete row is skipped; incomplete trailing JSON is never consumed. */ }
    lineOffset += lineBytes;
  }
  return { events, cursor: { dev: info.dev, ino: info.ino, offset: completeEnd, prefix_hash: await hashFilePrefix(transcriptPath, completeEnd) }, observedAt: Date.now() };
}
