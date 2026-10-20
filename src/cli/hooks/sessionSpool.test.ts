import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { ProjectIdentity } from "../../services/projectIdentity.js";
import { SessionIngestError, type SessionIngestAck } from "../../services/dreamingService.js";
import { captureSessionEvents, captureTranscriptCheckpoint } from "./sessionSpool.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); delete process.env.CODEATLAS_MEMORY_SPOOL_DIR; });
const identity: ProjectIdentity = { project_id: "project_test", project: "repo", workspace_path: "/work/repo", canonical_root: "/work/repo", identity_source: "workspace_path" };
const event = { event_id: "event_stable", session_id: "session-1", content: "saved evidence", source_spans: [{ start: 0, end: 12 }] };
const ack = (event_id: string): SessionIngestAck => ({ success: true, status: "stored", persisted: true, acknowledged: true, event_id, memory_ids: [] });

test("persists before dispatch, retains failed events, and replays the same stable event ID", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-spool-")); roots.push(root); process.env.CODEATLAS_MEMORY_SPOOL_DIR = root;
  const calls: string[] = [];
  const failed = await captureSessionEvents({ identity, sessionId: "session-1", events: [event], dispatch: async (payload) => {
    calls.push(payload.event_id);
    const stored = JSON.parse(await readFile(path.join(root, identity.project_id, "session-1", "queue.json"), "utf8"));
    assert.equal(stored.pending[0].payload.event_id, "event_stable");
    assert.equal(stored.pending[0].payload.display_name, identity.project);
    assert.equal(stored.pending[0].payload.workspace_path, identity.workspace_path);
    throw new Error("network down");
  } });
  assert.deepEqual(failed, { status: "queued", pending_count: 1, acknowledged_count: 0 });
  const storedPending = JSON.parse(await readFile(path.join(root, identity.project_id, "session-1", "queue.json"), "utf8"));
  assert.equal(storedPending.pending[0].attempts, 1);
  assert.equal(storedPending.pending[0].last_failure, "transport_error");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const retried = await captureSessionEvents({ identity, sessionId: "session-1", events: [], dispatch: async (payload) => { calls.push(payload.event_id); return ack(payload.event_id); } });
  assert.deepEqual(retried, { status: "acknowledged", pending_count: 0, acknowledged_count: 1 });
  assert.deepEqual(calls, ["event_stable", "event_stable"]);
});

test("quarantines poison, drains later events, and keeps backend cursor behind unresolved gap", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-spool-poison-")); roots.push(root); process.env.CODEATLAS_MEMORY_SPOOL_DIR = root;
  const cwd = path.join(root, "work", "repo");
  const projectsRoot = path.join(root, "projects");
  const encodedCwd = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const sessionDir = path.join(projectsRoot, encodedCwd);
  await mkdir(cwd, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  const transcriptPath = path.join(sessionDir, "session-1.jsonl");
  await writeFile(transcriptPath, "{}\n");

  const poison = { ...event, event_id: "event_poison", content: "Decision: keep this body in quarantine; api_key=credential-secret-123. AWS_SECRET_ACCESS_KEY=synthetic-quarantine-access-secret AWS_SESSION_TOKEN=synthetic-quarantine-session-secret" };
  const valid = { ...event, event_id: "event_valid_after_poison", content: "valid event after the poison" };
  const cursor10 = { dev: 1, ino: 2, offset: 10, prefix_hash: "a".repeat(64) };
  const cursor20 = { dev: 1, ino: 2, offset: 20, prefix_hash: "b".repeat(64) };
  const dispatched: string[] = [];
  const first = await captureSessionEvents({ identity, sessionId: "session-1", events: [poison, valid], cursorAfter: cursor10, dispatch: async (payload) => {
    dispatched.push(payload.event_id);
    if (payload.event_id === poison.event_id) return { success: false, status: "rejected", persisted: false, acknowledged: false, event_id: payload.event_id, memory_ids: [], reason_code: "invalid_event" };
    return ack(payload.event_id);
  } });

  assert.deepEqual(dispatched, [poison.event_id, valid.event_id]);
  assert.deepEqual(first, { status: "queued", pending_count: 1, acknowledged_count: 1 });
  const quarantinePath = path.join(root, identity.project_id, "session-1", "quarantine.json");
  const quarantine = JSON.parse(await readFile(quarantinePath, "utf8"));
  assert.equal(quarantine.events.length, 1);
  assert.equal(quarantine.events[0].payload.event_id, poison.event_id);
  assert.match(quarantine.events[0].payload.content, /api_key=\[REDACTED_SECRET\]/);
  assert.doesNotMatch(JSON.stringify(quarantine), /credential-secret-123/);
  assert.doesNotMatch(JSON.stringify(quarantine), /synthetic-quarantine-access-secret|synthetic-quarantine-session-secret/);
  const firstState = JSON.parse(await readFile(path.join(root, identity.project_id, "session-1", "queue.json"), "utf8"));
  assert.equal(firstState.cursor, null);
  assert.equal(firstState.readCursor.offset, 10);
  assert.equal(firstState.ackBlocked, true);
  assert.deepEqual(firstState.pending, []);

  const readCursors: unknown[] = [];
  const next = { ...event, event_id: "event_after_restart", project_id: identity.project_id, actor_role: "ASSISTANT" as const,
    source_metadata: { source: "claude_transcript_jsonl" as const, offset_unit: "byte" as const }, content: "valid new transcript after restart" };
  const resumed = await captureTranscriptCheckpoint({
    identity: { ...identity, workspace_path: cwd, canonical_root: cwd },
    sessionId: "session-1", cwd, transcriptPath, projectsRoot, trigger: "Stop",
    transcriptReader: async (args) => {
      readCursors.push(args.cursor);
      return { events: [next], cursor: cursor20, observedAt: 200 };
    },
    dispatch: async (payload) => { dispatched.push(payload.event_id); return ack(payload.event_id); },
  });
  assert.deepEqual(readCursors, [cursor10]);
  assert.ok(dispatched.includes(next.event_id));
  assert.equal(dispatched.filter((id) => id === poison.event_id).length, 1);
  assert.deepEqual(resumed, { status: "queued", pending_count: 1, acknowledged_count: 2 });
  const resumedState = JSON.parse(await readFile(path.join(root, identity.project_id, "session-1", "queue.json"), "utf8"));
  assert.equal(resumedState.cursor, null);
  assert.equal(resumedState.readCursor.offset, 20);
});

test("quarantines mismatched acknowledgments and permanent HTTP failures while auth failures remain retryable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-spool-failures-")); roots.push(root); process.env.CODEATLAS_MEMORY_SPOOL_DIR = root;
  const payloads = [
    { ...event, event_id: "mismatched-receipt", content: "mismatch body" },
    { ...event, event_id: "rejected-http", content: "rejected body" },
    { ...event, event_id: "auth-retry", content: "auth body" },
    { ...event, event_id: "after-auth", content: "valid after auth retry" },
  ];
  const dispatched: string[] = [];
  const result = await captureSessionEvents({ identity, sessionId: "session-1", events: payloads, dispatch: async (payload) => {
    dispatched.push(payload.event_id);
    if (payload.event_id === "mismatched-receipt") return ack("another-event");
    if (payload.event_id === "rejected-http") throw new SessionIngestError("HTTP 400", false, "http_400");
    if (payload.event_id === "auth-retry") throw new SessionIngestError("HTTP 401", true, "http_401");
    return ack(payload.event_id);
  } });
  assert.deepEqual(dispatched, ["mismatched-receipt", "rejected-http", "auth-retry"]);
  assert.deepEqual(result, { status: "queued", pending_count: 4, acknowledged_count: 0 });
  const directory = path.join(root, identity.project_id, "session-1");
  const quarantine = JSON.parse(await readFile(path.join(directory, "quarantine.json"), "utf8"));
  assert.deepEqual(quarantine.events.map((item: { payload: { event_id: string }; last_failure: string }) => [item.payload.event_id, item.last_failure]), [
    ["mismatched-receipt", "ack_event_id_mismatch"], ["rejected-http", "http_400"],
  ]);
  const state = JSON.parse(await readFile(path.join(directory, "queue.json"), "utf8"));
  assert.deepEqual(state.pending.map((item: { payload: { event_id: string }; attempts: number; last_failure: string }) => [item.payload.event_id, item.attempts, item.last_failure]), [
    ["auth-retry", 1, "http_401"], ["after-auth", undefined, undefined],
  ]);
});

test("drains a bounded chunk and durably retains the undispatched remainder", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-spool-chunk-")); roots.push(root); process.env.CODEATLAS_MEMORY_SPOOL_DIR = root;
  const events = Array.from({ length: 51 }, (_, index) => ({ ...event, event_id: `chunk-${index}`, content: `event ${index}` }));
  const firstCalls: string[] = [];
  const first = await captureSessionEvents({ identity, sessionId: "session-1", events, dispatch: async (payload) => { firstCalls.push(payload.event_id); return ack(payload.event_id); } });
  assert.equal(firstCalls.length, 50);
  assert.deepEqual(first, { status: "queued", pending_count: 1, acknowledged_count: 50 });
  const queue = JSON.parse(await readFile(path.join(root, identity.project_id, "session-1", "queue.json"), "utf8"));
  assert.deepEqual(queue.pending.map((item: { payload: { event_id: string } }) => item.payload.event_id), ["chunk-50"]);
  const finalCalls: string[] = [];
  const final = await captureSessionEvents({ identity, sessionId: "session-1", events: [], dispatch: async (payload) => { finalCalls.push(payload.event_id); return ack(payload.event_id); } });
  assert.deepEqual(finalCalls, ["chunk-50"]);
  assert.deepEqual(final, { status: "acknowledged", pending_count: 0, acknowledged_count: 1 });
});

test("isolates pending queues by project and session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-spool-")); roots.push(root); process.env.CODEATLAS_MEMORY_SPOOL_DIR = root;
  const result = await captureSessionEvents({ identity, sessionId: "session-1", events: [event], dispatch: async () => { throw new Error("offline"); } });
  assert.equal(result.status, "queued");
  const otherIdentity = { ...identity, project_id: "project_other" };
  const fresh = await captureSessionEvents({ identity: otherIdentity, sessionId: "session-1", events: [], dispatch: async () => ack("none") });
  assert.equal(fresh.status, "acknowledged");
  const stored = JSON.parse(await readFile(path.join(root, identity.project_id, "session-1", "queue.json"), "utf8"));
  assert.equal(stored.pending.length, 1);
});

test("drains simultaneous same-session queues for different projects independently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-spool-project-race-")); roots.push(root); process.env.CODEATLAS_MEMORY_SPOOL_DIR = root;
  const projectA = identity;
  const projectB = { ...identity, project_id: "project_other", project: "other-repo", workspace_path: "/work/other-repo", canonical_root: "/work/other-repo" };
  let releaseA!: () => void;
  let startedA!: () => void;
  const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
  const started = new Promise<void>((resolve) => { startedA = resolve; });
  const eventA = { ...event, event_id: "project-a-event" };
  const eventB = { ...event, event_id: "project-b-event" };
  const first = captureSessionEvents({ identity: projectA, sessionId: "same-session", events: [eventA], dispatch: async (payload) => { startedA(); await gateA; return ack(payload.event_id); } });
  await started;
  const second = await captureSessionEvents({ identity: projectB, sessionId: "same-session", events: [eventB], dispatch: async (payload) => ack(payload.event_id) });
  assert.deepEqual(second, { status: "acknowledged", pending_count: 0, acknowledged_count: 1 });
  releaseA();
  assert.deepEqual(await first, { status: "acknowledged", pending_count: 0, acknowledged_count: 1 });
  assert.equal(JSON.parse(await readFile(path.join(root, projectA.project_id, "same-session", "queue.json"), "utf8")).pending.length, 0);
  assert.equal(JSON.parse(await readFile(path.join(root, projectB.project_id, "same-session", "queue.json"), "utf8")).pending.length, 0);
});

test("rollback flag durably queues new events without dispatch and can drain them after reenable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-spool-")); roots.push(root); process.env.CODEATLAS_MEMORY_SPOOL_DIR = root;
  process.env.CODEATLAS_DURABLE_CAPTURE = "0";
  let dispatches = 0;
  const queued = await captureSessionEvents({ identity, sessionId: "session-1", events: [event], dispatch: async (payload) => { dispatches++; return ack(payload.event_id); } });
  assert.equal(queued.status, "queued");
  assert.equal(dispatches, 0);
  process.env.CODEATLAS_DURABLE_CAPTURE = "1";
  const additional = { ...event, event_id: "event_second", content: "second event" };
  const drained = await captureSessionEvents({ identity, sessionId: "session-1", events: [additional], dispatch: async (payload) => { dispatches++; return ack(payload.event_id); } });
  assert.equal(drained.status, "acknowledged");
  assert.equal(drained.acknowledged_count, 2);
  assert.equal(dispatches, 2);
});

test("does not replace a corrupt spool with an empty cursor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-spool-")); roots.push(root); process.env.CODEATLAS_MEMORY_SPOOL_DIR = root;
  const dir = path.join(root, identity.project_id, "session-1");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "queue.json");
  await writeFile(file, "{corrupt");
  await assert.rejects(() => captureSessionEvents({ identity, sessionId: "session-1", events: [event], dispatch: async (payload) => ack(payload.event_id) }), /corrupt/);
  assert.equal(await readFile(file, "utf8"), "{corrupt");
});

test("persists same-session events before lock acquisition so concurrent hooks cannot drop them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-spool-")); roots.push(root); process.env.CODEATLAS_MEMORY_SPOOL_DIR = root;
  const dir = path.join(root, identity.project_id, "session-1");
  await mkdir(path.join(dir, ".lock"), { recursive: true });
  await writeFile(path.join(dir, ".lock", "owner"), JSON.stringify({ pid: process.pid, created: Date.now() }));
  const other = { ...event, event_id: "event_concurrent", content: "concurrent evidence" };
  const queued = await captureSessionEvents({ identity, sessionId: "session-1", events: [other], dispatch: async (payload) => ack(payload.event_id) });
  assert.equal(queued.status, "queued");
  assert.equal((await readdir(path.join(dir, "inbox"))).length, 1);
  await rm(path.join(dir, ".lock"), { recursive: true, force: true });
  const dispatched: string[] = [];
  const drained = await captureSessionEvents({ identity, sessionId: "session-1", events: [event], dispatch: async (payload) => { dispatched.push(payload.event_id); return ack(payload.event_id); } });
  assert.equal(drained.status, "acknowledged");
  assert.deepEqual(dispatched, ["event_concurrent", "event_stable"]);
});

test("out-of-order lifecycle snapshots cannot move an acknowledged transcript cursor backward", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codeatlas-spool-race-")); roots.push(root); process.env.CODEATLAS_MEMORY_SPOOL_DIR = path.join(root, "spool");
  const cwd = path.join(root, "work", "repo");
  const projectsRoot = path.join(root, "projects");
  const encodedCwd = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const sessionDir = path.join(projectsRoot, encodedCwd);
  await mkdir(cwd, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  const transcriptPath = path.join(sessionDir, "session-race.jsonl");
  await writeFile(transcriptPath, "{}\n");

  let oldReadStarted!: () => void;
  const oldStarted = new Promise<void>((resolve) => { oldReadStarted = resolve; });
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  let reads = 0;
  const transcriptReader = async () => {
    reads++;
    if (reads === 1) {
      oldReadStarted();
      await oldGate;
      return { events: [], cursor: { dev: 1, ino: 2, offset: 10, prefix_hash: "a".repeat(64) }, observedAt: 100 };
    }
    return { events: [], cursor: { dev: 1, ino: 2, offset: 20, prefix_hash: "b".repeat(64) }, observedAt: 200 };
  };
  const dispatch = async (payload: any) => ack(payload.event_id);
  const oldSnapshot = captureTranscriptCheckpoint({ identity: { ...identity, workspace_path: cwd, canonical_root: cwd }, sessionId: "session-race", cwd, transcriptPath, projectsRoot, trigger: "Stop", transcriptReader, dispatch });
  await oldStarted;
  const newerSnapshot = await captureTranscriptCheckpoint({ identity: { ...identity, workspace_path: cwd, canonical_root: cwd }, sessionId: "session-race", cwd, transcriptPath, projectsRoot, trigger: "PreCompact", transcriptReader, dispatch });
  assert.equal(newerSnapshot.status, "acknowledged");
  releaseOld();
  await oldSnapshot;
  await captureSessionEvents({ identity: { ...identity, workspace_path: cwd, canonical_root: cwd }, sessionId: "session-race", events: [], dispatch });
  const state = JSON.parse(await readFile(path.join(process.env.CODEATLAS_MEMORY_SPOOL_DIR!, identity.project_id, "session-race", "queue.json"), "utf8"));
  assert.equal(state.cursor.offset, 20);
});
