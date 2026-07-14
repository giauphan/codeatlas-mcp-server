import * as https from "https";
import * as http from "http";
import { getResolvedApiKey } from "./projectService.js";

export interface DreamMemoryInput {
  memory_type: "MISTAKE" | "PREFERENCE" | "KNOWLEDGE" | "PATTERN";
  content: string;
  importance?: number;
  session_id?: string;
  project?: string;
}

export interface DreamMemoryQuery {
  query: string;
  project?: string;
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
  score?: number;
}

const CHROME_UA: string =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function getDreamApiKey(): string | undefined {
  const envKey: string | undefined = process.env.CODEATLAS_API_KEY;
  if (envKey) return envKey;

  return getResolvedApiKey();
}

export async function saveDreamMemory(params: DreamMemoryInput): Promise<{ success: boolean; id: string }> {
  const apiKey: string | undefined = getDreamApiKey();
  if (!apiKey) {
    throw new Error("CODEATLAS_API_KEY is not set. Cannot save dream memory.");
  }

  return new Promise<{ success: boolean; id: string }>((resolve, reject) => {
    try {
      const payload: string = JSON.stringify(params);
      const serverUrlStr: string = process.env.CODEATLAS_API_URL || "https://your-server.com/api";
      const serverUrl: URL = new URL(serverUrlStr);

      const options: https.RequestOptions = {
        hostname: serverUrl.hostname,
        port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
        path: `/api/dreams/save`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "User-Agent": CHROME_UA,
          "Content-Length": Buffer.byteLength(payload),
        },
      };

      const protocol: typeof https | typeof http = serverUrl.protocol === "https:" ? https : http;
      const req = protocol.request(options, (res) => {
        let data: string = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const responseObj: any = JSON.parse(data);
              resolve({ success: true, id: responseObj.id || responseObj.dreamId || "unknown" });
            } catch {
              resolve({ success: true, id: "unknown" });
            }
          } else {
            reject(new Error("Failed to save dream memory: status " + res.statusCode + ": " + data));
          }
        });
      });

      req.on("error", (e: Error) => {
        reject(new Error("Dream Memory Save Network Error: " + e.message));
      });

      req.write(payload);
      req.end();
    } catch (err: unknown) {
      reject(new Error("Dream Memory Save Init Error: " + (err instanceof Error ? err.message : String(err))));
    }
  });
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

export async function queryDreamMemories(params: DreamMemoryQuery): Promise<DreamMemoryResult[]> {
  const apiKey: string | undefined = getDreamApiKey();
  if (!apiKey) {
    throw new Error("CODEATLAS_API_KEY is not set. Cannot query dream memories.");
  }

  return new Promise<DreamMemoryResult[]>((resolve, reject) => {
    try {
      const serverUrlStr: string = process.env.CODEATLAS_API_URL || "https://your-server.com/api";
      const serverUrl: URL = new URL(serverUrlStr);

      const queryParams: URLSearchParams = new URLSearchParams();
      queryParams.set("query", params.query);
      if (params.project) queryParams.set("project", params.project);
      if (params.limit) queryParams.set("limit", String(params.limit));
      if (params.offset) queryParams.set("offset", String(params.offset));

      const options: https.RequestOptions = {
        hostname: serverUrl.hostname,
        port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
        path: queryParams.toString() ? "/api/dreams/query?" + queryParams.toString() : "/api/dreams/query",
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "User-Agent": CHROME_UA,
          "Accept": "application/json",
        },
      };

      const protocol: typeof https | typeof http = serverUrl.protocol === "https:" ? https : http;
      const req = protocol.request(options, (res) => {
        let data: string = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const responseObj: any = JSON.parse(data);
              const memories: DreamMemoryResult[] = responseObj.memories || responseObj.results || [];
              resolve(memories);
            } catch {
              reject(new Error("Failed to parse dream memory query response: " + data));
            }
          } else {
            reject(new Error("Failed to query dream memories: status " + res.statusCode + ": " + data));
          }
        });
      });

      req.on("error", (e: Error) => {
        reject(new Error("Dream Memory Query Network Error: " + e.message));
      });

      req.end();
    } catch (err: unknown) {
      reject(new Error("Dream Memory Query Init Error: " + (err instanceof Error ? err.message : String(err))));
    }
  });
}
