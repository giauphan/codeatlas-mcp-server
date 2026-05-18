import { authStorage } from "../context.js";
/**
 * Local-First Security: Returns mock local authentication details
 */
export async function checkAuth(apiKey) {
    const contextAuth = authStorage.getStore();
    if (contextAuth) {
        return contextAuth;
    }
    return {
        tier: "enterprise",
        uid: "local-user",
        keyId: "local-key"
    };
}
/**
 * Local-First Logging: Logs activity to console in development
 */
export async function logActivity(auth, tool, params, success = true) {
    if (process.env.DEBUG === "true") {
        console.error(`[Local-Logger] Tool: ${tool}, Success: ${success}`);
    }
}
//# sourceMappingURL=authService.js.map