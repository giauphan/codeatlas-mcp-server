import * as https from "https";
import { getResolvedApiKey } from "./projectService.js";
/**
 * Save a dream memory to CodeAtlas Cloud via the Oracle CRUD API.
 * Used by the AI to persist insights (mistakes, preferences, knowledge, patterns).
 */
export async function saveDreamMemory(params) {
    const apiKey = getResolvedApiKey();
    if (!apiKey) {
        throw new Error("CODEATLAS_API_KEY is not set. Cannot save dream memory.");
    }
    return new Promise((resolve, reject) => {
        try {
            const payload = JSON.stringify(params);
            const serverUrlStr = process.env.CODEATLAS_API_URL || "https://atlas.genrostore.com";
            const serverUrl = new URL(serverUrlStr);
            const options = {
                hostname: serverUrl.hostname,
                port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
                path: `/api/dreams/save`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "Content-Length": Buffer.byteLength(payload),
                },
            };
            const req = https.request(options, (res) => {
                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const responseObj = JSON.parse(data);
                            resolve({ success: true, id: responseObj.id || responseObj.dreamId || "unknown" });
                        }
                        catch {
                            // If response is not JSON but success, return generic success
                            resolve({ success: true, id: "unknown" });
                        }
                    }
                    else {
                        const errMsg = `Failed to save dream memory: status ${res.statusCode}: ${data}`;
                        reject(new Error(errMsg));
                    }
                });
            });
            req.on("error", (e) => {
                const errMsg = `Dream Memory Save Network Error: ${e.message}`;
                reject(new Error(errMsg));
            });
            req.write(payload);
            req.end();
        }
        catch (err) {
            const errMsg = `Dream Memory Save Initialization Error: ${err instanceof Error ? err.message : String(err)}`;
            reject(new Error(errMsg));
        }
    });
}
/**
 * Query dream memories from CodeAtlas Cloud via the Oracle CRUD API.
 * Returns relevant memories with relevance scores.
 */
export async function queryDreamMemories(params) {
    const apiKey = getResolvedApiKey();
    if (!apiKey) {
        throw new Error("CODEATLAS_API_KEY is not set. Cannot query dream memories.");
    }
    return new Promise((resolve, reject) => {
        try {
            const serverUrlStr = process.env.CODEATLAS_API_URL || "https://atlas.genrostore.com";
            const serverUrl = new URL(serverUrlStr);
            const queryParams = new URLSearchParams();
            queryParams.set("query", params.query);
            if (params.project)
                queryParams.set("project", params.project);
            if (params.limit)
                queryParams.set("limit", String(params.limit));
            const options = {
                hostname: serverUrl.hostname,
                port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
                path: `/api/dreams/query?${queryParams.toString()}`,
                method: "GET",
                headers: {
                    "x-api-key": apiKey,
                },
            };
            const req = https.request(options, (res) => {
                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const responseObj = JSON.parse(data);
                            const memories = responseObj.memories || responseObj.results || [];
                            resolve(memories);
                        }
                        catch {
                            reject(new Error(`Failed to parse dream memory query response: ${data}`));
                        }
                    }
                    else {
                        const errMsg = `Failed to query dream memories: status ${res.statusCode}: ${data}`;
                        reject(new Error(errMsg));
                    }
                });
            });
            req.on("error", (e) => {
                const errMsg = `Dream Memory Query Network Error: ${e.message}`;
                reject(new Error(errMsg));
            });
            req.end();
        }
        catch (err) {
            const errMsg = `Dream Memory Query Initialization Error: ${err instanceof Error ? err.message : String(err)}`;
            reject(new Error(errMsg));
        }
    });
}
//# sourceMappingURL=dreamingService.js.map