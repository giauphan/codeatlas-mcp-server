import { authStorage } from "../context.js";

/**
 * Local-First Security: Returns mock local authentication details
 */
export async function checkAuth(apiKey?: string): Promise<{ tier: string; uid: string; keyId: string }> {
  const contextAuth = authStorage.getStore();
  if (contextAuth && Object.keys(contextAuth).length > 0) {
    return contextAuth;
  }

  const multiTenant = process.env.CODEATLAS_MULTI_TENANT;
  if (multiTenant === "true" || multiTenant === "1") {
    throw new Error("Unauthorized: Missing tenant authentication context.");
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
export async function logActivity(auth: { uid: string; keyId: string }, tool: string, params: any, success: boolean = true) {
  if (process.env.DEBUG === "true") {
    console.debug(`[Local-Logger] Tool: ${tool}, Success: ${success}`);
  }
}
