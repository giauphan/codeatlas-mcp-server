import { authStorage } from "../context.js";

/**
 * Security: Returns mock local authentication details
 */
export async function checkAuth(apiKey?: string): Promise<{ tier: string; uid: string; keyId: string }> {
  const contextAuth = authStorage.getStore();
  if (contextAuth && Object.keys(contextAuth).length > 0) {
    return contextAuth;
  }

  throw new Error("Unauthorized: Missing authentication context.");
}

/**
 * Local-First Logging: Logs activity to console in development
 */
export async function logActivity(auth: { uid: string; keyId: string }, tool: string, params: any, success: boolean = true) {
  if (process.env.DEBUG === "true") {
    console.debug(`[Local-Logger] Tool: ${tool}, Success: ${success}`);
  }
}
