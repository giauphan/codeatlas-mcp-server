import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ingestSessionEvent, SessionIngestError, type SessionIngestAck, type SessionIngestInput } from "../../services/dreamingService.js";
import type { ProjectIdentity } from "../../services/projectIdentity.js";
import { redactSensitiveContent } from "./eventDecoder.js";
import { readClaudeTranscript, validateClaudeTranscriptPath, type TranscriptCursor } from "./transcriptReader.js";

interface PendingEvent { payload: SessionIngestInput; attempts?: number; last_failure?: string; retry_at?: number }
interface SpoolBatch { version: 1; created_at: number; events: SessionIngestInput[]; cursorAfter?: TranscriptCursor | null; cursorObservedAt?: number }
interface SpoolState { version: 1; cursor: TranscriptCursor | null; cursorObservedAt?: number; readCursor?: TranscriptCursor | null; readCursorObservedAt?: number; ackBlocked?: boolean; pending: PendingEvent[]; pendingCursor?: TranscriptCursor | null; pendingCursorObservedAt?: number }
interface QuarantinedEvent { payload: SessionIngestInput; attempts: number; last_failure: string; quarantined_at: string }
interface QuarantineState { version: 1; events: QuarantinedEvent[] }
export interface CaptureDrainResult { status: "acknowledged" | "queued"; pending_count: number; acknowledged_count: number }
type DispatchEvent = (event: SessionIngestInput) => Promise<SessionIngestAck>;

const MAX_DRAIN_EVENTS = 50;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 15 * 60_000;

function validPathPart(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,255}$/.test(value) || value === "." || value === "..") throw new Error("invalid session spool identity");
  return value;
}

function spoolDirectory(): string {
  return path.resolve(process.env.CODEATLAS_MEMORY_SPOOL_DIR ?? path.join(os.homedir(), ".codeatlas", "memory-spool"));
}

function sessionDirectory(projectId: string, sessionId: string): string {
  return path.join(spoolDirectory(), validPathPart(projectId), validPathPart(sessionId));
}

async function readState(file: string): Promise<SpoolState> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, cursor: null, pending: [] };
    throw new Error("pending capture spool cannot be read; no cursor advanced");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("pending capture spool is corrupt; no cursor advanced"); }
  if (typeof parsed !== "object" || parsed === null || (parsed as SpoolState).version !== 1 || !Array.isArray((parsed as SpoolState).pending)) {
    throw new Error("pending capture spool has an unsupported format; no cursor advanced");
  }
  const state = parsed as SpoolState;
  if (!state.pending.every((item) => item && item.payload && typeof item.payload.event_id === "string" && typeof item.payload.session_id === "string" && typeof item.payload.content === "string")) {
    throw new Error("pending capture spool contains invalid events; no cursor advanced");
  }
  return state;
}

async function saveState(file: string, state: SpoolState): Promise<void> {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temp, "w", 0o600);
  try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, file);
  try {
    const directory = await open(path.dirname(file), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch { /* Some platforms do not allow syncing directory handles. */ }
}

function redactQuarantineContent(content: string): string {
  return redactSensitiveContent(content);
}

function quarantineFile(directory: string): string { return path.join(directory, "quarantine.json"); }

async function readQuarantine(directory: string): Promise<QuarantineState> {
  try {
    const parsed = JSON.parse(await readFile(quarantineFile(directory), "utf8")) as QuarantineState;
    if (parsed.version !== 1 || !Array.isArray(parsed.events) || !parsed.events.every((item) => item?.payload && typeof item.payload.event_id === "string")) {
      throw new Error("invalid quarantine format");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, events: [] };
    throw new Error("capture quarantine is corrupt; no cursor advanced");
  }
}

async function saveQuarantine(directory: string, state: QuarantineState): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const file = quarantineFile(directory);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temp, "w", 0o600);
  try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, file);
  try { const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); } } catch { /* best effort on platforms without directory sync */ }
}

function safeFailureCode(error: unknown): string {
  if (error instanceof SessionIngestError) return error.failureCode;
  if (error instanceof Error && /invalid ingest acknowledgment/i.test(error.message)) return "invalid_ack";
  return "transport_error";
}

function retryDelay(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(16, Math.max(0, attempts - 1)));
}

function recordRetry(item: PendingEvent, reason: string): void {
  const attempts = Math.min(Number.MAX_SAFE_INTEGER, (item.attempts ?? 0) + 1);
  item.attempts = attempts;
  item.last_failure = /^[a-z0-9_]{1,64}$/.test(reason) ? reason : "transport_error";
  item.retry_at = Date.now() + retryDelay(attempts);
}

function recordPermanentFailure(item: PendingEvent, reason: string): void {
  item.attempts = Math.min(Number.MAX_SAFE_INTEGER, (item.attempts ?? 0) + 1);
  item.last_failure = /^[a-z0-9_]{1,64}$/.test(reason) ? reason : "permanent_rejection";
}

function quarantinedPayload(payload: SessionIngestInput): SessionIngestInput {
  return { ...payload, content: redactQuarantineContent(payload.content) };
}

async function quarantine(directory: string, item: PendingEvent, reason: string): Promise<void> {
  const state = await readQuarantine(directory);
  if (state.events.some((entry) => entry.payload.event_id === item.payload.event_id)) return;
  state.events.push({
    payload: quarantinedPayload(item.payload),
    attempts: item.attempts ?? 1,
    last_failure: /^[a-z0-9_]{1,64}$/.test(reason) ? reason : "permanent_rejection",
    quarantined_at: new Date().toISOString(),
  });
  await saveQuarantine(directory, state);
}

async function persistInboxBatch(directory: string, events: SessionIngestInput[], cursorAfter?: TranscriptCursor | null, cursorObservedAt?: number): Promise<void> {
  if (!events.length && cursorAfter === undefined) return;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(path.dirname(directory), 0o700);
  await chmod(directory, 0o700);
  const inbox = path.join(directory, "inbox");
  await mkdir(inbox, { recursive: true, mode: 0o700 });
  await chmod(inbox, 0o700);
  const batch: SpoolBatch = { version: 1, created_at: Date.now(), events, ...(cursorAfter !== undefined ? { cursorAfter } : {}), ...(cursorObservedAt !== undefined ? { cursorObservedAt } : {}) };
  const serialized = JSON.stringify(batch);
  const digest = createHash("sha256").update(serialized).digest("hex");
  const destination = path.join(inbox, `${String(batch.created_at).padStart(16, "0")}-${digest}.json`);
  const temp = `${destination}.${process.pid}.${randomBytes(16).toString("hex")}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, destination);
  try { const dir = await open(inbox, "r"); try { await dir.sync(); } finally { await dir.close(); } } catch { /* best effort on platforms without directory sync */ }
}

async function mergeInbox(state: SpoolState, file: string, directory: string): Promise<void> {
  const inbox = path.join(directory, "inbox");
  const names = (await readdir(inbox).catch(() => [] as string[])).filter((name) => /^\d+-[a-f0-9]{64}\.json$/.test(name)).sort();
  if (!names.length) return;
  const ids = new Set(state.pending.map((item) => item.payload.event_id));
  for (const name of names) {
    const batchPath = path.join(inbox, name);
    const batch = JSON.parse(await readFile(batchPath, "utf8")) as SpoolBatch;
    if (batch.version !== 1 || !Array.isArray(batch.events) || !batch.events.every((event) => event && typeof event.event_id === "string" && typeof event.session_id === "string" && typeof event.content === "string")) {
      throw new Error("capture inbox contains invalid data; no cursor advanced");
    }
    for (const payload of batch.events) {
      if (ids.has(payload.event_id)) continue;
      state.pending.push({ payload });
      ids.add(payload.event_id);
    }
    if (Object.prototype.hasOwnProperty.call(batch, "cursorAfter")) {
      const current = state.pendingCursor !== undefined ? state.pendingCursor : state.readCursor ?? state.cursor;
      const currentObservedAt = state.pendingCursor !== undefined ? state.pendingCursorObservedAt : state.readCursor !== undefined ? state.readCursorObservedAt : state.cursorObservedAt;
      if (isNewerCursor(batch.cursorAfter ?? null, batch.cursorObservedAt, current ?? null, currentObservedAt)) {
        state.pendingCursor = batch.cursorAfter;
        state.pendingCursorObservedAt = batch.cursorObservedAt;
      }
    }
  }
  if (state.pendingCursor !== undefined) {
    state.readCursor = state.pendingCursor;
    state.readCursorObservedAt = state.pendingCursorObservedAt;
  }
  await saveState(file, state);
  await Promise.all(names.map((name) => rm(path.join(inbox, name), { force: true })));
}

function isNewerCursor(candidate: TranscriptCursor | null, candidateObservedAt: number | undefined, current: TranscriptCursor | null, currentObservedAt: number | undefined): boolean {
  if (!current) return true;
  if (!candidate) return false;
  if (candidateObservedAt !== undefined && currentObservedAt !== undefined && candidateObservedAt !== currentObservedAt) return candidateObservedAt > currentObservedAt;
  if (candidate.dev === current.dev && candidate.ino === current.ino) return candidate.offset > current.offset;
  if (candidateObservedAt !== undefined && currentObservedAt !== undefined) return candidateObservedAt >= currentObservedAt;
  return true;
}

async function acquireSessionLock(directory: string): Promise<() => Promise<void>> {
  const lock = path.join(directory, ".lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeFile(path.join(lock, "owner"), JSON.stringify({ pid: process.pid, created: Date.now() }), { mode: 0o600, flag: "wx" });
      return async () => rm(lock, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let stale = false;
      try {
        const owner = JSON.parse(await readFile(path.join(lock, "owner"), "utf8")) as { pid?: number; created?: number };
        if (typeof owner.pid === "number") {
          try { process.kill(owner.pid, 0); } catch (probeError) { stale = (probeError as NodeJS.ErrnoException).code === "ESRCH"; }
        } else stale = Date.now() - (owner.created ?? 0) > 120_000;
      } catch {
        const info = await stat(lock).catch(() => null);
        stale = Boolean(info && Date.now() - info.mtimeMs > 120_000);
      }
      if (!stale) throw new Error("session capture is already active");
      await rm(lock, { recursive: true, force: true });
    }
  }
  throw new Error("could not acquire session capture lock");
}

function durableAck(ack: SessionIngestAck, eventId: string): boolean {
  if (ack.event_id !== eventId || !ack.success || !ack.acknowledged) return false;
  if (ack.status === "stored" || ack.status === "duplicate") return ack.persisted;
  return ack.status === "filtered" && !ack.persisted;
}

function permanentAckFailure(ack: SessionIngestAck, eventId: string): string | null {
  if (ack.event_id !== eventId) return "ack_event_id_mismatch";
  if (ack.status === "rejected" && !ack.success && !ack.persisted && !ack.acknowledged) return "backend_rejected";
  return null;
}

async function withSpool<T>(projectId: string, sessionId: string, action: (state: SpoolState, file: string, directory: string) => Promise<T>): Promise<T> {
  const directory = sessionDirectory(projectId, sessionId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(path.dirname(directory), 0o700);
  await chmod(directory, 0o700);
  const file = path.join(directory, "queue.json");
  const unlock = await acquireSessionLock(directory);
  try {
    const state = await readState(file);
    await mergeInbox(state, file, directory);
    return await action(state, file, directory);
  } finally { await unlock(); }
}

async function lockBusyAsQueued<T extends CaptureDrainResult>(run: () => Promise<T>, pendingCount: number): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof Error && error.message === "session capture is already active") {
      return { status: "queued", pending_count: Math.max(1, pendingCount), acknowledged_count: 0 } as T;
    }
    throw error;
  }
}

async function drain(state: SpoolState, file: string, directory: string, dispatch: DispatchEvent): Promise<CaptureDrainResult> {
  const quarantineState = await readQuarantine(directory);
  if (quarantineState.events.length) {
    state.ackBlocked = true;
    const quarantinedIds = new Set(quarantineState.events.map((item) => item.payload.event_id));
    const priorLength = state.pending.length;
    state.pending = state.pending.filter((item) => !quarantinedIds.has(item.payload.event_id));
    if (state.pending.length !== priorLength) await saveState(file, state);
  }
  if (process.env.CODEATLAS_DURABLE_CAPTURE === "0") {
    const pendingCount = state.pending.length + quarantineState.events.length;
    return { status: pendingCount || state.ackBlocked ? "queued" : "acknowledged", pending_count: pendingCount, acknowledged_count: 0 };
  }
  let acknowledged = 0;
  let processed = 0;
  let index = 0;
  const remaining: PendingEvent[] = [];
  while (index < state.pending.length) {
    if (processed >= MAX_DRAIN_EVENTS) { remaining.push(...state.pending.slice(index)); break; }
    const item = state.pending[index];
    if (item.retry_at !== undefined && item.retry_at > Date.now()) { remaining.push(...state.pending.slice(index)); break; }
    try {
      const receipt = await dispatch(item.payload);
      const permanentFailure = permanentAckFailure(receipt, item.payload.event_id);
      if (permanentFailure) {
        recordPermanentFailure(item, permanentFailure);
        await quarantine(directory, item, permanentFailure);
        state.ackBlocked = true;
        processed++;
        index++;
        continue;
      }
      if (durableAck(receipt, item.payload.event_id)) {
        acknowledged++;
        processed++;
        index++;
        continue;
      }
      recordRetry(item, receipt.status === "error" ? "backend_error" : "invalid_ack");
      remaining.push(...state.pending.slice(index));
      break;
    } catch (error) {
      if (error instanceof SessionIngestError && !error.retryable) {
        recordPermanentFailure(item, error.failureCode);
        await quarantine(directory, item, error.failureCode);
        state.ackBlocked = true;
        processed++;
        index++;
        continue;
      }
      recordRetry(item, safeFailureCode(error));
      remaining.push(...state.pending.slice(index));
      break;
    }
  }
  state.pending = remaining;
  if (state.pending.length === 0) {
    if (!state.ackBlocked && quarantineState.events.length === 0 && state.pendingCursor !== undefined) {
      state.cursor = state.pendingCursor;
      state.cursorObservedAt = state.pendingCursorObservedAt;
    }
    delete state.pendingCursor;
    delete state.pendingCursorObservedAt;
  }
  await saveState(file, state);
  const updatedQuarantine = await readQuarantine(directory);
  const pendingCount = state.pending.length + updatedQuarantine.events.length;
  const complete = pendingCount === 0 && !state.ackBlocked;
  return { status: complete ? "acknowledged" : "queued", pending_count: pendingCount, acknowledged_count: acknowledged };
}

export async function captureSessionEvents(args: {
  identity: ProjectIdentity;
  sessionId: string;
  events: Array<Omit<SessionIngestInput, "project_id" | "project"> & Partial<Pick<SessionIngestInput, "project_id" | "project">>>;
  cursorAfter?: TranscriptCursor | null;
  dispatch?: DispatchEvent;
}): Promise<CaptureDrainResult> {
  const dispatch = args.dispatch ?? ingestSessionEvent;
  const events = args.events.map((event) => ({ ...event, project_id: args.identity.project_id, project: args.identity.project, display_name: args.identity.project, workspace_path: args.identity.workspace_path } as SessionIngestInput));
  const directory = sessionDirectory(args.identity.project_id, args.sessionId);
  await persistInboxBatch(directory, events, args.cursorAfter);
  return lockBusyAsQueued(() => withSpool(args.identity.project_id, args.sessionId, async (state, file, directory) => drain(state, file, directory, dispatch)), events.length);
}

export async function captureTranscriptCheckpoint(args: {
  identity: ProjectIdentity;
  sessionId: string;
  cwd: string;
  transcriptPath: string;
  trigger: "Stop" | "PreCompact";
  projectsRoot?: string;
  dispatch?: DispatchEvent;
  transcriptReader?: typeof readClaudeTranscript;
}): Promise<CaptureDrainResult> {
  const dispatch = args.dispatch ?? ingestSessionEvent;
  const directory = sessionDirectory(args.identity.project_id, args.sessionId);
  const file = path.join(directory, "queue.json");
  const prior = await readState(file);
  const validTranscript = await validateClaudeTranscriptPath({ transcriptPath: args.transcriptPath, sessionId: args.sessionId, cwd: args.cwd, canonicalRoot: args.identity.canonical_root, projectsRoot: args.projectsRoot });
  const transcriptReader = args.transcriptReader ?? readClaudeTranscript;
  const result = await transcriptReader({ transcriptPath: validTranscript, sessionId: args.sessionId, projectId: args.identity.project_id, cursor: prior.readCursor ?? prior.cursor, authorizedCwds: [args.cwd, args.identity.canonical_root] });
  const events: SessionIngestInput[] = result.events.map((event) => ({ ...event, project: args.identity.project, display_name: args.identity.project, workspace_path: args.identity.workspace_path }));
  const checkpointId = `claude_${createHash("sha256").update(`${args.identity.project_id}\0${args.sessionId}\0checkpoint\0${args.trigger}\0${result.cursor.offset}`).digest("hex")}`;
  events.push({ event_id: checkpointId, session_id: args.sessionId, project_id: args.identity.project_id, project: args.identity.project, display_name: args.identity.project, workspace_path: args.identity.workspace_path,
    content: `Session checkpoint (${args.trigger})`, checkpoint: { trigger: args.trigger, transcript_cursor: result.cursor.offset }, source_spans: [] });
  await persistInboxBatch(directory, events, result.cursor, result.observedAt);
  return lockBusyAsQueued(() => withSpool(args.identity.project_id, args.sessionId, async (state, queueFile, sessionPath) => drain(state, queueFile, sessionPath, dispatch)), events.length);
}
