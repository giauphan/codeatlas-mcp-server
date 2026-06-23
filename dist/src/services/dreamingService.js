import * as https from "https";
import * as http from "http";
import { getResolvedApiKey } from "./projectService.js";
const CHROME_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
function getDreamApiKey() {
    const envKey = process.env.CODEATLAS_API_KEY;
    if (envKey)
        return envKey;
    return getResolvedApiKey();
}
export async function saveDreamMemory(params) {
    const apiKey = getDreamApiKey();
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
                path: "/api/dreams/save?apiKey=" + encodeURIComponent(apiKey),
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "User-Agent": CHROME_UA,
                    "Content-Length": Buffer.byteLength(payload),
                },
            };
            const protocol = serverUrl.protocol === "https:" ? https : http;
            const req = protocol.request(options, (res) => {
                let data = "";
                res.on("data", (chunk) => { data += chunk; });
                res.on("end", () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const responseObj = JSON.parse(data);
                            resolve({ success: true, id: responseObj.id || responseObj.dreamId || "unknown" });
                        }
                        catch {
                            resolve({ success: true, id: "unknown" });
                        }
                    }
                    else {
                        reject(new Error("Failed to save dream memory: status " + res.statusCode + ": " + data));
                    }
                });
            });
            req.on("error", (e) => {
                reject(new Error("Dream Memory Save Network Error: " + e.message));
            });
            req.write(payload);
            req.end();
        }
        catch (err) {
            reject(new Error("Dream Memory Save Init Error: " + (err instanceof Error ? err.message : String(err))));
        }
    });
}
export async function queryDreamMemories(params) {
    const apiKey = getDreamApiKey();
    if (!apiKey) {
        throw new Error("CODEATLAS_API_KEY is not set. Cannot query dream memories.");
    }
    return new Promise((resolve, reject) => {
        try {
            const serverUrlStr = process.env.CODEATLAS_API_URL || "https://atlas.genrostore.com";
            const serverUrl = new URL(serverUrlStr);
            const queryParams = new URLSearchParams();
            queryParams.set("apiKey", apiKey);
            queryParams.set("query", params.query);
            if (params.project)
                queryParams.set("project", params.project);
            if (params.limit)
                queryParams.set("limit", String(params.limit));
            const options = {
                hostname: serverUrl.hostname,
                port: serverUrl.port || (serverUrl.protocol === "https:" ? 443 : 80),
                path: "/api/dreams/query?" + queryParams.toString(),
                method: "GET",
                headers: {
                    "x-api-key": apiKey,
                    "User-Agent": CHROME_UA,
                    "Accept": "application/json",
                },
            };
            const protocol = serverUrl.protocol === "https:" ? https : http;
            const req = protocol.request(options, (res) => {
                let data = "";
                res.on("data", (chunk) => { data += chunk; });
                res.on("end", () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const responseObj = JSON.parse(data);
                            const memories = responseObj.memories || responseObj.results || [];
                            resolve(memories);
                        }
                        catch {
                            reject(new Error("Failed to parse dream memory query response: " + data));
                        }
                    }
                    else {
                        reject(new Error("Failed to query dream memories: status " + res.statusCode + ": " + data));
                    }
                });
            });
            req.on("error", (e) => {
                reject(new Error("Dream Memory Query Network Error: " + e.message));
            });
            req.end();
        }
        catch (err) {
            reject(new Error("Dream Memory Query Init Error: " + (err instanceof Error ? err.message : String(err))));
        }
    });
}
//# sourceMappingURL=dreamingService.js.map