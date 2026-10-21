import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { formatBrainContext, loadBrainContext, parseLatestCheckpointResponse } from "./brainContext.js";

const originalUrl = process.env.CODEATLAS_API_URL;
const originalKey = process.env.CODEATLAS_API_KEY;
afterEach(() => {
  if (originalUrl === undefined) delete process.env.CODEATLAS_API_URL; else process.env.CODEATLAS_API_URL = originalUrl;
  if (originalKey === undefined) delete process.env.CODEATLAS_API_KEY; else process.env.CODEATLAS_API_KEY = originalKey;
});

const checkpoint = {
  id: "checkpoint-1", project_id: "project_canonical", session_id: "session-1",
  active_task: "Repair Unicode query retrieval", completed: ["Added scoped query"], decisions: ["Use actor_role for evidence"],
  blockers: ["Waiting on API deployment"], next_actions: ["Run compiled hook canary"],
  source_event_ids: ["event-1"], source_session_ids: ["session-source"], created_at: "2026-10-19T10:00:00.000Z",
};

test("parses only a project-matching, typed latest checkpoint response", () => {
  assert.deepEqual(parseLatestCheckpointResponse({ success: true, retrieval_status: "ok", checkpoint }, "project_canonical"), { status: "ok", checkpoint });
  assert.deepEqual(parseLatestCheckpointResponse({ success: true, retrieval_status: "empty", checkpoint: null }, "project_canonical"), { status: "empty", checkpoint: null });
  assert.deepEqual(parseLatestCheckpointResponse({ success: true, retrieval_status: "ok", checkpoint }, "project_other"), { status: "error", checkpoint: null });
  assert.deepEqual(parseLatestCheckpointResponse({ success: true, retrieval_status: "empty", checkpoint }, "project_canonical"), { status: "error", checkpoint: null });
});

test("formats checkpoint fields as bounded, untrusted evidence with provenance", () => {
  const packet = formatBrainContext({ dreams: [], genes: [], immune: "", checkpoint, checkpointStatus: "ok" }, { maxChars: 1_600 });
  assert.match(packet, /Untrusted CodeAtlas historical reference/);
  assert.match(packet, /Check cited sources and the current working tree before relying on past status; current user and tool evidence takes precedence\./);
  assert.match(packet, /Active task: Repair Unicode query retrieval/);
  assert.match(packet, /Decision: Use actor_role for evidence/);
  assert.match(packet, /Next: Run compiled hook canary/);
  assert.match(packet, /event-1/);
  assert.ok(packet.length <= 1_600);
});

test("keeps stale checkpoint actions as historical context beside a newer query", () => {
  const staleCheckpoint = { ...checkpoint, created_at: "2000-01-01T00:00:00.000Z" };
  const packet = formatBrainContext({ dreams: [], genes: [], immune: "", checkpoint: staleCheckpoint, checkpointStatus: "ok" }, { query: "Current task from 2026: inspect the latest source and status", maxChars: 1_600 });

  assert.match(packet, /Recorded: 2000-01-01T00:00:00\.000Z/);
  assert.match(packet, /Next: Run compiled hook canary/);
  assert.match(packet, /Check cited sources and the current working tree before relying on past status; current user and tool evidence takes precedence\./);
});

test("SessionStart checkpoint retrieval uses canonical identity even with an empty query", async () => {
  process.env.CODEATLAS_API_URL = "https://api.codeatlas.ai";
  process.env.CODEATLAS_API_KEY = "fixture-key";
  const urls: string[] = [];
  const requestHeaders: Headers[] = [];
  const redirectModes: Array<RequestRedirect | undefined> = [];
  let semanticQueries = 0;
  const result = await loadBrainContext({ query: "", project_id: "project_canonical", project: "legacy-display", trace_id: "trace-session-start" }, {
    queryDreams: async () => { semanticQueries++; return []; },
    fetcher: async (url, init) => {
      urls.push(String(url));
      requestHeaders.push(new Headers(init?.headers));
      redirectModes.push(init?.redirect);
      return new Response(JSON.stringify({ success: true, retrieval_status: "ok", checkpoint }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(semanticQueries, 0);
  assert.equal(result.checkpointStatus, "ok");
  assert.equal(result.checkpoint?.active_task, checkpoint.active_task);
  assert.equal(new URL(urls[0]!).pathname, "/api/dreams/checkpoints/latest");
  assert.equal(new URL(urls[0]!).searchParams.get("project_id"), "project_canonical");
  assert.equal(requestHeaders[0]!.get("x-request-id"), "trace-session-start");
  assert.equal(redirectModes[0], "error");
});

test("prompt retrieval preserves newlines and Unicode while scoping semantic queries", async () => {
  process.env.CODEATLAS_API_URL = "https://api.codeatlas.ai";
  process.env.CODEATLAS_API_KEY = "fixture-key";
  const query = "Continue: sửa lỗi retrieval\ncheck scopes";
  let queryParams: unknown;
  await loadBrainContext({ query, project_id: "project_canonical", project: "legacy-display", display_name: "Display Name", workspace_path: "/work/repo", trace_id: "trace-prompt" }, {
    queryDreams: async (params) => { queryParams = params; return []; },
    fetcher: async () => new Response(JSON.stringify({ success: true, retrieval_status: "empty", checkpoint: null }), { status: 200 }),
  });
  assert.equal((queryParams as any).query, query);
  assert.equal((queryParams as any).project_id, "project_canonical");
  assert.equal((queryParams as any).project, "legacy-display");
  assert.equal((queryParams as any).display_name, "Display Name");
  assert.equal((queryParams as any).workspace_path, "/work/repo");
  assert.equal((queryParams as any).request_id, "trace-prompt");
});

test("checkpoint HTTP failures retain auth, transport and backend taxonomy", async () => {
  process.env.CODEATLAS_API_URL = "https://api.codeatlas.ai";
  process.env.CODEATLAS_API_KEY = "fixture-key";
  for (const [httpStatus, expected] of [[401, "auth_error"], [503, "backend_error"]] as const) {
    const result = await loadBrainContext({ query: "", project_id: "project_canonical" }, {
      fetcher: async () => new Response("sensitive backend details", { status: httpStatus }),
    });
    assert.equal(result.checkpointStatus, expected);
    assert.equal(result.retrievalStatus, expected);
    assert.doesNotMatch(formatBrainContext(result), /No Second Brain context|sensitive backend details/);
  }
  const result = await loadBrainContext({ query: "", project_id: "project_canonical" }, {
    fetcher: async () => { throw new TypeError("fetch failed"); },
  });
  assert.equal(result.checkpointStatus, "transport_error");
});

test("prompt retrieval errors are observable even when a checkpoint is empty", async () => {
  process.env.CODEATLAS_API_URL = "https://api.codeatlas.ai";
  process.env.CODEATLAS_API_KEY = "fixture-key";
  const result = await loadBrainContext({ query: "resolver.ts", project_id: "project_canonical" }, {
    queryDreams: async () => { throw new Error("Dream Memory Query Network Error: ECONNREFUSED"); },
    fetcher: async () => new Response(JSON.stringify({ success: true, retrieval_status: "empty", checkpoint: null }), { status: 200 }),
  });
  assert.equal(result.retrievalStatus, "transport_error");
  assert.equal(result.componentStatuses?.dreams, "transport_error");
  assert.doesNotMatch(formatBrainContext(result), /No Second Brain context/);
});
