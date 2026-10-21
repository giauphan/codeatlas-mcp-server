import { createHash } from "node:crypto";

export type ClaudeHookEventName = "PostToolUse" | "PostToolUseFailure";
export type ClaudeHookLifecycleName = "Stop" | "PreCompact";
export type CapturedMemoryType = "KNOWLEDGE" | "MISTAKE";

export type ClaudeHookDecodeResult =
  | {
      status: "capture";
      eventName: ClaudeHookEventName;
      eventId?: string;
      idempotencyKey?: string;
      sessionId?: string;
      cwd?: string;
      toolName: string;
      content: string;
      memoryType: CapturedMemoryType;
    }
  | { status: "filtered"; reason: "tool_blacklisted" | "tool_not_whitelisted" | "sensitive_source" }
  | {
      status: "lifecycle";
      eventName: ClaudeHookLifecycleName;
      sessionId: string;
      cwd: string;
      transcriptPath: string;
    }
  | { status: "skipped_empty" }
  | { status: "invalid_payload"; reason: "invalid_json" | "invalid_object" | "missing_session_context" }
  | { status: "unsupported_event"; reason: string };

export interface DecodeClaudeHookOptions {
  maxContentLength?: number;
}
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  const normalized = nonEmptyString(value);
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function extractText(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((part) => extractText(part, depth + 1)).filter(Boolean).join("\n");
  if (!isObject(value)) return "";

  const keys = ["text", "stdout", "stderr", "content", "message", "error"];
  return keys.map((key) => extractText(value[key], depth + 1)).filter(Boolean).join("\n");
}

export function redactSensitiveContent(content: string): string {
  const credentialField = "api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|password|passwd|secret|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key|aws[_-]?session[_-]?token";
  return content
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+(@)/gi, "$1[REDACTED_SECRET]$2")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|api_test_[A-Za-z0-9_-]+|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g, "[REDACTED_SECRET]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED_SECRET]")
    .replace(new RegExp(`(["']?(?:${credentialField})["']?\\s*:\\s*)(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s,;}&]+)`, "gi"), "$1\"[REDACTED_SECRET]\"")
    .replace(new RegExp(`\\b(${credentialField})\\s*[:=]\\s*["']?[^\\s,;}'"]+["']?`, "gi"), "$1=[REDACTED_SECRET]");
}

const DEFAULT_DENIED_TOOLS = new Set(["read", "grep", "glob", "find", "webfetch", "websearch", "todowrite", "listagents", "taskoutput"]);
const SENSITIVE_SOURCE = /(?:^|[\s"'=:/\\])(?:\.env(?:\.[A-Za-z0-9_-]+)?|\.npmrc|\.pypirc|\.ssh|id_(?:rsa|ed25519)|authorized_keys|credentials(?:\.json)?|secrets?(?:\.json)?|[^/\\\s]+\.(?:pem|key))(?=$|[\s"'=:/\\])/i;

function csvSet(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean));
}

const PATH_LIKE_INPUT_KEYS = new Set(["file_path", "path", "notebook_path"]);

function hasSensitivePath(value: unknown, depth = 0): boolean {
  if (depth > 6 || value == null) return false;
  if (typeof value === "string") return SENSITIVE_SOURCE.test(value);
  if (Array.isArray(value)) return value.some((item) => hasSensitivePath(item, depth + 1));
  if (isObject(value)) return Object.values(value).some((item) => hasSensitivePath(item, depth + 1));
  return false;
}

function commandHasSensitivePath(command: unknown): boolean {
  if (typeof command !== "string") return false;
  return command.split(/[\s"'`]+/).some((token) => {
    const normalized = token.replace(/^[([{]+/, "").replace(/[\])},;:.]+$/, "");
    const pathLike = normalized.includes("/") || normalized.includes("\\") || normalized.startsWith(".") || /\.(?:pem|key|json)$/i.test(normalized);
    return pathLike && SENSITIVE_SOURCE.test(normalized);
  });
}

function hasSensitiveSource(value: unknown, depth = 0): boolean {
  if (depth > 6 || value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasSensitiveSource(item, depth + 1));
  return Object.entries(value).some(([key, item]) =>
    (PATH_LIKE_INPUT_KEYS.has(key.toLowerCase()) && hasSensitivePath(item)) ||
    (key.toLowerCase() === "command" && commandHasSensitivePath(item)) ||
    (isObject(item) && hasSensitiveSource(item, depth + 1)) ||
    (Array.isArray(item) && hasSensitiveSource(item, depth + 1)),
  );
}

function boundedEvidence(value: string, limit: number): string {
  const requestedLength = Number.isFinite(limit) ? Math.trunc(limit) : 1_800;
  const maxLength = Math.max(1, Math.min(requestedLength, 1_800));
  if (value.length <= maxLength) return value;
  const marker = "\n[… output truncated …]\n";
  if (maxLength <= marker.length + 2) return value.slice(-maxLength);
  const remaining = maxLength - marker.length;
  const headLength = Math.ceil(remaining * 0.58);
  return `${value.slice(0, headLength)}${marker}${value.slice(-(remaining - headLength))}`;
}

export function decodeClaudeHookEvent(
  input: unknown,
  options: DecodeClaudeHookOptions = {},
): ClaudeHookDecodeResult {
  let payload: unknown = input;
  if (typeof input === "string") {
    try {
      payload = JSON.parse(input);
    } catch {
      return { status: "invalid_payload", reason: "invalid_json" };
    }
  }
  if (!isObject(payload)) return { status: "invalid_payload", reason: "invalid_object" };

  const eventName = payload.hook_event_name;
  if (eventName === "Stop" || eventName === "PreCompact") {
    const sessionId = boundedString(payload.session_id, 255);
    const cwd = boundedString(payload.cwd, 2_048);
    const transcriptPath = boundedString(payload.transcript_path, 4_096);
    if (!sessionId || !cwd || !transcriptPath) return { status: "invalid_payload", reason: "missing_session_context" };
    return { status: "lifecycle", eventName, sessionId, cwd, transcriptPath };
  }
  if (eventName !== "PostToolUse" && eventName !== "PostToolUseFailure") {
    return { status: "unsupported_event", reason: "unsupported_event" };
  }

  const rawToolName = boundedString(payload.tool_name, 80) ?? "unknown";
  const toolName = /^[A-Za-z0-9_.:-]{1,80}$/.test(rawToolName) ? rawToolName : "unknown";
  const normalizedTool = toolName.toLowerCase();
  const deniedTools = new Set([...DEFAULT_DENIED_TOOLS, ...csvSet(process.env.CODEATLAS_HOOK_TOOLS_DENYLIST)]);
  if (deniedTools.has(normalizedTool) || deniedTools.has("*")) return { status: "filtered", reason: "tool_blacklisted" };
  const allowlist = csvSet(process.env.CODEATLAS_HOOK_TOOLS_ALLOWLIST);
  if (allowlist.size > 0 && !allowlist.has("*") && !allowlist.has(normalizedTool)) return { status: "filtered", reason: "tool_not_whitelisted" };
  const toolInput = isObject(payload.tool_input) ? payload.tool_input : {};
  if (hasSensitiveSource(toolInput)) return { status: "filtered", reason: "sensitive_source" };
  const toolEvidence = ["command", "file_path", "path", "pattern", "query"]
    .map((key) => boundedString(toolInput[key], 500) ? `${key}=${boundedString(toolInput[key], 500)}` : "")
    .filter(Boolean)
    .join(" ");
  const toolResponse = isObject(payload.tool_response) ? payload.tool_response : {};
  const exitCode = toolResponse.exitCode ?? toolResponse.exit_code;
  const outcome = typeof exitCode === "number" || typeof exitCode === "string" ? `exit_code=${String(exitCode)}` : "";
  const responseText = eventName === "PostToolUseFailure" ? extractText(payload.error) : extractText(payload.tool_response);
  if (eventName === "PostToolUseFailure" && !responseText) return { status: "skipped_empty" };
  if (eventName === "PostToolUse" && !responseText && !outcome) return { status: "skipped_empty" };
  const rawContent = [
    `[${toolName}]`,
    toolEvidence ? `input: ${toolEvidence}` : "",
    eventName === "PostToolUseFailure" ? "outcome: failed" : outcome ? `outcome: ${outcome}` : "",
    responseText ? `${eventName === "PostToolUseFailure" ? "error" : "result"}: ${responseText}` : "",
  ].filter(Boolean).join("\n");
  const content = boundedEvidence(redactSensitiveContent(rawContent), options.maxContentLength ?? 1_800).trim();
  if (!content) return { status: "skipped_empty" };

  const sessionId = boundedString(payload.session_id, 255) ?? boundedString(payload.sessionId, 255);
  const rawEventId = boundedString(payload.tool_use_id, 255) ?? boundedString(payload.event_id, 255);
  const eventId = rawEventId && /^[A-Za-z0-9._:-]+$/.test(rawEventId) ? rawEventId : undefined;
  const idempotencyKey = eventId ?? (sessionId
    ? `hook_${createHash("sha256").update(JSON.stringify({ eventName, sessionId, cwd: boundedString(payload.cwd, 2_048), toolName, content })).digest("hex")}`
    : undefined);

  return {
    status: "capture",
    eventName,
    ...((eventId ?? idempotencyKey) ? { eventId: eventId ?? idempotencyKey } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(boundedString(payload.cwd, 2_048) ? { cwd: boundedString(payload.cwd, 2_048) } : {}),
    toolName,
    content,
    memoryType: eventName === "PostToolUseFailure" ? "MISTAKE" : "KNOWLEDGE",
  };
}
