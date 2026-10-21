import * as https from "https";
import * as http from "http";
import { getResolvedApiKey } from "./projectService.js";
import { getApiUrl } from "../utils/envUtils.js";

export interface DreamMemoryInput {
  memory_type: "MISTAKE" | "PREFERENCE" | "KNOWLEDGE" | "PATTERN" | "SESSION_SUMMARY";
  content: string;
  importance?: number;
  session_id?: string;
  project?: string;
  project_id?: string;
  display_name?: string;
  workspace_path?: string;
  scope?: string;
  tags?: string[];
  related_ids?: string[];
  idempotency_key?: string;
}

export type DreamMemorySaveStatus = "stored" | "duplicate" | "filtered" | "rejected" | "error";

export interface DreamMemorySaveAck {
  success: boolean;
  status: DreamMemorySaveStatus;
  persisted: boolean;
  id?: string;
  memory_id?: string;
}

export interface SessionIngestInput {
  event_id: string;
  session_id: string;
  project_id?: string;
  project?: string;
  display_name?: string;
  workspace_path?: string;
  content: string;
  actor_role?: "USER" | "ASSISTANT" | "TOOL";
  memory_type_hint?: "KNOWLEDGE" | "MISTAKE";
  tool_name?: string;
  checkpoint?: unknown;
  occurred_at?: string;
  source_spans?: Array<{ start: number; end: number }>;
  source_metadata?: { source: "claude_transcript_jsonl"; offset_unit: "byte" };
}

export type SessionIngestStatus = "stored" | "duplicate" | "filtered" | "rejected" | "error";
export interface SessionIngestAck {
  success: boolean;
  status: SessionIngestStatus;
  persisted: boolean;
  acknowledged: boolean;
  event_id: string;
  memory_ids: string[];
  reason_code?: string;
}

export class SessionIngestError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly failureCode: string) {
    super(message);
    this.name = "SessionIngestError";
  }
}

export interface DreamMemoryQuery {
  query: string;
  project_id?: string;
  request_id?: string;
  project?: string;
  display_name?: string;
  workspace_path?: string;
  scope?: string;
  tags?: string[];
  memory_type?: string;
  limit?: number;
  offset?: number;
}

export interface DreamMemoryResult {
  id: string;
  memory_type: string;
  content: string;
  importance: number;
  session_id: string | null;
  project: string | null;
  created_at: string;
  scope?: string | null;
  tags?: string[];
  related_ids?: string[];
  score?: number;
}

const CHROME_UA: string =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function getDreamApiKey(): string | undefined {
  const envKey: string | undefined = process.env.CODEATLAS_API_KEY;
  if (envKey) return envKey;

  return getResolvedApiKey();
}

function parseSaveAck(data: string): DreamMemorySaveAck {
  let response: unknown;
  try {
    response = JSON.parse(data);
  } catch {
    throw new Error("Invalid save acknowledgment: response was not valid JSON");
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Invalid save acknowledgment: response must be an object");
  }
  const ack = response as Record<string, unknown>;

  // Compatibility for older platform versions, accepted only with a real ID.
  // Early platform versions returned only an ID, before receipt fields existed.
  if (ack.status === undefined && (ack.success === true || ack.success === undefined)) {
    const legacyId = typeof ack.id === "string" ? ack.id : typeof ack.dreamId === "string" ? ack.dreamId : "";
    if (legacyId === "__noise_blocked__") {
      return { success: true, status: "filtered", persisted: false };
    }
    if (!legacyId || legacyId === "unknown") {
      throw new Error("Invalid save acknowledgment: legacy success response has no persisted ID");
    }
    return { success: true, status: "stored", persisted: true, id: legacyId, memory_id: legacyId };
  }
  if (ack.status === undefined && ack.success === false) {
    if (ack.id || ack.memory_id || ack.persisted === true) {
      throw new Error("Invalid save acknowledgment: rejected outcome includes persisted data");
    }
    return { success: false, status: "rejected", persisted: false };
  }

  const statuses = new Set<DreamMemorySaveStatus>(["stored", "duplicate", "filtered", "rejected", "error"]);
  if (typeof ack.status !== "string" || !statuses.has(ack.status as DreamMemorySaveStatus) || typeof ack.persisted !== "boolean") {
    throw new Error("Invalid save acknowledgment: status and persisted fields are required");
  }
  const status = ack.status as DreamMemorySaveStatus;
  const id = typeof ack.memory_id === "string" ? ack.memory_id : typeof ack.id === "string" ? ack.id : undefined;
  const successfulStatus = status === "stored" || status === "duplicate" || status === "filtered";
  if (typeof ack.success === "boolean" && ack.success !== successfulStatus) {
    throw new Error("Invalid save acknowledgment: success contradicts status");
  }
  if ((status === "stored" || status === "duplicate") && (!ack.persisted || !id || id === "unknown" || id === "__noise_blocked__")) {
    throw new Error("Invalid save acknowledgment: persisted outcome requires a real memory ID");
  }
  if (status !== "stored" && status !== "duplicate" && (ack.persisted || id)) {
    throw new Error("Invalid save acknowledgment: non-persisted outcome cannot include a memory ID");
  }
  return {
    success: status === "stored" || status === "duplicate" || status === "filtered",
    status,
    persisted: ack.persisted,
    ...(id ? { id, memory_id: id } : {}),
  };
}

function getRequestTimeoutMs(): number {
  const configured = Number(process.env.CODEATLAS_API_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 100 && configured <= 30_000 ? configured : 10_000;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function saveDreamMemory(params: DreamMemoryInput): Promise<DreamMemorySaveAck> {
  const apiKey: string | undefined = getDreamApiKey();
  if (!apiKey) {
    throw new Error("CODEATLAS_API_KEY is not set. Cannot save dream memory.");
  }

  const serverUrl: URL = new URL(getApiUrl());
  const payload: string = JSON.stringify(params);
  const options: https.RequestOptions = {
    hostname: serverUrl.hostname.replace(/^\[|\]$/g, ""),
    port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
    path: "/api/dreams/save",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "User-Agent": CHROME_UA,
      "Content-Length": Buffer.byteLength(payload),
      ...(params.idempotency_key ? { "Idempotency-Key": params.idempotency_key, "X-Request-Id": params.idempotency_key } : {}),
    },
  };
  const protocol: typeof https | typeof http = serverUrl.protocol === "https:" ? https : http;
  const maxAttempts = params.idempotency_key ? 2 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: { statusCode: number; data: string };
    try {
      response = await new Promise<{ statusCode: number; data: string }>((resolve, reject) => {
      try {
        const req = protocol.request(options, (res) => {
          let data = "";
          res.on("data", (chunk: string) => { data += chunk; });
          res.on("end", () => {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            resolve({ statusCode: res.statusCode ?? 0, data });
          });
        });
        let timeoutTimer: NodeJS.Timeout | undefined;
        req.on("error", (error: Error) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          reject(new Error("Dream Memory Save Network Error: " + error.message));
        });
        timeoutTimer = setTimeout(() => {
          req.destroy(new Error("Dream Memory Save request timed out"));
        }, getRequestTimeoutMs());
        req.write(payload);
        req.end();
      } catch (err: unknown) {
        reject(new Error("Dream Memory Save Init Error: " + (err instanceof Error ? err.message : String(err))));
      }
      });
    } catch (error) {
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(250 * (2 ** (attempt - 1)), 1_000)));
        continue;
      }
      throw error;
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return parseSaveAck(response.data);
    }
    if (!(attempt < maxAttempts && isTransientStatus(response.statusCode))) {
      throw new Error("Failed to save dream memory: status " + response.statusCode);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(250 * (2 ** (attempt - 1)), 1_000)));
  }
  throw new Error("Failed to save dream memory after retries");
}

function parseIngestAck(data: string): SessionIngestAck {
  let response: unknown;
  try { response = JSON.parse(data); } catch { throw new Error("Invalid ingest acknowledgment: response was not valid JSON"); }
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("Invalid ingest acknowledgment: response must be an object");
  const ack = response as Record<string, unknown>;
  const statuses = new Set<SessionIngestStatus>(["stored", "duplicate", "filtered", "rejected", "error"]);
  if (typeof ack.status !== "string" || !statuses.has(ack.status as SessionIngestStatus) || typeof ack.persisted !== "boolean" ||
      typeof ack.acknowledged !== "boolean" || typeof ack.event_id !== "string" || !Array.isArray(ack.memory_ids) ||
      !ack.memory_ids.every((id) => typeof id === "string" && id.length > 0)) {
    throw new Error("Invalid ingest acknowledgment: required receipt fields are missing or invalid");
  }
  const status = ack.status as SessionIngestStatus;
  const accounted = status === "stored" || status === "duplicate" || status === "filtered";
  if (typeof ack.success === "boolean" && ack.success !== accounted) throw new Error("Invalid ingest acknowledgment: success contradicts status");
  if ((status === "stored" || status === "duplicate") && (!ack.persisted || !ack.acknowledged)) throw new Error("Invalid ingest acknowledgment: event is not durably acknowledged");
  if (status === "filtered" && (ack.persisted || !ack.acknowledged || ack.memory_ids.length !== 0)) throw new Error("Invalid ingest acknowledgment: filtered event is not durably accounted");
  if ((status === "rejected" || status === "error") && (ack.persisted || ack.acknowledged || ack.memory_ids.length !== 0)) throw new Error("Invalid ingest acknowledgment: failed event includes receipt data");
  return {
    success: accounted, status, persisted: ack.persisted, acknowledged: ack.acknowledged,
    event_id: ack.event_id, memory_ids: ack.memory_ids as string[],
    ...(typeof ack.reason_code === "string" ? { reason_code: ack.reason_code.slice(0, 80) } : {}),
  };
}

export async function ingestSessionEvent(params: SessionIngestInput): Promise<SessionIngestAck> {
  if (!params.event_id || !params.session_id || !params.content || (!params.project_id && !params.project)) {
    throw new SessionIngestError("Session ingest requires event_id, session_id, project identity, and content", false, "invalid_event");
  }
  const apiKey = getDreamApiKey();
  if (!apiKey) throw new SessionIngestError("CODEATLAS_API_KEY is not set. Cannot ingest session event.", true, "configuration_unavailable");
  let serverUrl: URL;
  try { serverUrl = new URL(getApiUrl()); }
  catch (error) { throw new SessionIngestError(error instanceof Error ? error.message : "CODEATLAS_API_URL not set", true, "configuration_unavailable"); }
  const payload = JSON.stringify(params);
  const options: https.RequestOptions = {
    hostname: serverUrl.hostname.replace(/^\[|\]$/g, ""),
    port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
    path: "/api/dreams/ingest-session",
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "User-Agent": CHROME_UA,
      "Content-Length": Buffer.byteLength(payload), "Idempotency-Key": params.event_id, "X-Request-Id": params.event_id },
  };
  const protocol: typeof https | typeof http = serverUrl.protocol === "https:" ? https : http;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: { statusCode: number; data: string };
    try {
      response = await new Promise((resolve, reject) => {
        const req = protocol.request(options, (res) => {
          let data = "";
          res.on("data", (chunk: string) => { data += chunk; });
          res.on("end", () => { if (timer) clearTimeout(timer); resolve({ statusCode: res.statusCode ?? 0, data }); });
        });
        let timer: NodeJS.Timeout | undefined;
        req.on("error", (error: Error) => { if (timer) clearTimeout(timer); reject(error); });
        timer = setTimeout(() => req.destroy(new Error("Session ingest request timed out")), getRequestTimeoutMs());
        req.write(payload); req.end();
      });
    } catch (error) {
      if (attempt === 1) { await new Promise((resolve) => setTimeout(resolve, 250)); continue; }
      throw new SessionIngestError(`Session ingest network error: ${error instanceof Error ? error.message : "request failed"}`, true, "transport_error");
    }
    if (response.statusCode >= 200 && response.statusCode < 300) return parseIngestAck(response.data);
    if (attempt === 1 && isTransientStatus(response.statusCode)) { await new Promise((resolve) => setTimeout(resolve, 250)); continue; }
    const permanentEventFailure = response.statusCode === 400 || response.statusCode === 409;
    throw new SessionIngestError(`Failed to ingest session event: status ${response.statusCode}`, !permanentEventFailure, `http_${response.statusCode}`);
  }
  throw new Error("Failed to ingest session event after retries");
}

// ── One-shot sync: check cloud dream status ──
export async function syncDreams(): Promise<{ success: boolean; count: number; message: string }> {
  try {
    const memories = await queryDreamMemories({ query: "", limit: 100 });
    const count = memories?.length ?? 0;
    return {
      success: true,
      count,
      message: `✅ ${count} dreams synced in CodeAtlas Cloud`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      count: -1,
      message: `❌ Sync failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export type DreamRetrievalStatus = "ok" | "empty" | "no_match" | "filtered" | "auth_error" | "transport_error" | "backend_error";
export interface DreamMemoryQueryResult {
  memories: DreamMemoryResult[];
  retrieval_status: DreamRetrievalStatus;
  candidate_count: number;
  returned_count: number;
}

export class DreamRetrievalError extends Error {
  constructor(readonly retrieval_status: DreamRetrievalStatus, message: string) { super(message); }
}

export function classifyRetrievalError(error: unknown): DreamRetrievalStatus {
  if (error instanceof DreamRetrievalError) return error.retrieval_status;
  const message = error instanceof Error ? error.message : "";
  if (/status (?:401|403)\b|API_KEY is not set/i.test(message)) return "auth_error";
  if (/network|fetch failed|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message) ||
      (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) return "transport_error";
  return "backend_error";
}

/** Typed outcome for host adapters; never interprets a request failure as empty memory. */
export async function queryDreamMemoriesWithStatus(params: DreamMemoryQuery): Promise<DreamMemoryQueryResult> {
  try { return await requestDreamMemories(params); }
  catch (error) { return { memories: [], retrieval_status: classifyRetrievalError(error), candidate_count: 0, returned_count: 0 }; }
}

/** Backward-compatible array API: failures continue to reject. */
export async function queryDreamMemories(params: DreamMemoryQuery): Promise<DreamMemoryResult[]> {
  return (await requestDreamMemories(params)).memories;
}

async function requestDreamMemories(params: DreamMemoryQuery): Promise<DreamMemoryQueryResult> {
  const apiKey = getDreamApiKey();
  if (!apiKey) throw new DreamRetrievalError("auth_error", "CODEATLAS_API_KEY is not set. Cannot query dream memories.");
  let serverUrl: URL;
  try { serverUrl = new URL(getApiUrl()); }
  catch (error) { throw new DreamRetrievalError("backend_error", error instanceof Error ? error.message : "CODEATLAS_API_URL not set"); }
  const queryParams = new URLSearchParams({ query: params.query });
  for (const field of ["project_id", "project", "display_name", "workspace_path", "scope", "memory_type"] as const) {
    if (params[field]) queryParams.set(field, params[field]);
  }
  if (params.tags?.length) queryParams.set("tags", JSON.stringify(params.tags));
  if (params.limit) queryParams.set("limit", String(params.limit));
  if (params.offset) queryParams.set("offset", String(params.offset));
  const urlPath = "/api/dreams/query?" + queryParams.toString();
  if (urlPath.length > 8_000) throw new DreamRetrievalError("backend_error", "Query URL too long. Reduce query filters.");
  const options: https.RequestOptions = {
    hostname: serverUrl.hostname.replace(/^\[|\]$/g, ""),
    port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
    path: urlPath,
    method: "GET",
    headers: { "x-api-key": apiKey, "User-Agent": CHROME_UA, Accept: "application/json", ...(params.request_id ? { "X-Request-Id": params.request_id } : {}) },
  };
  const protocol = serverUrl.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (error?: Error, result?: DreamMemoryQueryResult) => {
      if (timer) clearTimeout(timer);
      if (error) reject(error); else if (result) resolve(result);
    };
    const req = protocol.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: string) => {
        data += chunk;
        if (data.length > 2_000_000) req.destroy(new DreamRetrievalError("backend_error", "Dream query response exceeds limit"));
      });
      res.on("end", () => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          finish(new DreamRetrievalError([401, 403].includes(statusCode) ? "auth_error" : "backend_error", `Failed to query dream memories: status ${statusCode}`));
          return;
        }
        try {
          const response: unknown = JSON.parse(data);
          if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("invalid response");
          const body = response as Record<string, unknown>;
          const memories = body.memories ?? body.results;
          if (body.success === false || !Array.isArray(memories) || !memories.every((item: unknown) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return false;
            const memory = item as Record<string, unknown>;
            return typeof memory.id === "string" && memory.id.length > 0 && typeof memory.content === "string" && typeof memory.memory_type === "string";
          })) throw new Error("invalid memories");
          const statuses = new Set<DreamRetrievalStatus>(["ok", "empty", "no_match", "filtered", "auth_error", "transport_error", "backend_error"]);
          const retrievalStatus = body.retrieval_status === undefined
            ? memories.length ? "ok" : params.query.trim() ? "no_match" : "empty"
            : typeof body.retrieval_status === "string" && statuses.has(body.retrieval_status as DreamRetrievalStatus)
              ? body.retrieval_status as DreamRetrievalStatus : null;
          if (!retrievalStatus || (memories.length > 0 && retrievalStatus !== "ok") || (retrievalStatus === "ok" && memories.length === 0)) throw new Error("contradictory status");
          if (["auth_error", "transport_error", "backend_error"].includes(retrievalStatus)) {
            finish(new DreamRetrievalError(retrievalStatus, `Dream query failed: ${retrievalStatus}`)); return;
          }
          finish(undefined, {
            memories: memories as DreamMemoryResult[], retrieval_status: retrievalStatus,
            candidate_count: typeof body.candidate_count === "number" && Number.isInteger(body.candidate_count) && body.candidate_count >= memories.length ? body.candidate_count : memories.length,
            returned_count: memories.length,
          });
        } catch {
          finish(new DreamRetrievalError("backend_error", "Failed to parse dream memory query response: invalid acknowledgment"));
        }
      });
      res.on("error", () => finish(new DreamRetrievalError("transport_error", "Dream Memory Query Network Error: response interrupted")));
    });
    req.on("error", (error: Error) => {
      const reason = /^E[A-Z_]{3,}$/.test(error.message) ? error.message : /timed out/.test(error.message) ? "timed out" : "request failed";
      finish(error instanceof DreamRetrievalError ? error : new DreamRetrievalError("transport_error", `Dream Memory Query Network Error: ${reason}`));
    });
    timer = setTimeout(() => req.destroy(new DreamRetrievalError("transport_error", "Dream Memory Query request timed out")), getRequestTimeoutMs());
    req.end();
  });
}
