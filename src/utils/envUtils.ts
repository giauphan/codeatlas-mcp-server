/* global process */
/**
 * Centralized environment variable access.
 * Avoids hardcoded URL fallbacks that trigger supply-chain security scanners.
 */

/**
 * Returns the configured API base URL from CODEATLAS_API_URL.
 * Throws a descriptive error when the variable is not set,
 * instead of silently falling back to a hardcoded URL.
 */
export function getApiUrl(): string {
  const url = process.env.CODEATLAS_API_URL;
  if (!url?.trim()) {
    throw new Error(
      "CODEATLAS_API_URL environment variable is not set. " +
      "Please configure it before using cloud features."
    );
  }

  const normalizedUrl = url.trim().replace(/\/+$/, "");
  try {
    const parsedUrl = new URL(normalizedUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    // 🛡️ Ensure destination matches the intended CodeAtlas brand or local testing environment
    const allowedHosts = ["localhost", "127.0.0.1", "::1", "api.codeatlas.ai", "opencode.ai"];
    if (
      !allowedHosts.includes(parsedUrl.hostname) &&
      !parsedUrl.hostname.endsWith(".codeatlas.ai") &&
      !parsedUrl.hostname.endsWith(".codeatlas-local.dev")
    ) {
      if (process.env.CODEATLAS_ALLOW_CUSTOM_URL !== "true") {
        throw new Error(
          `Security Notice: The destination URL (${parsedUrl.hostname}) is not recognized as a trusted CodeAtlas destination. ` +
          `Set CODEATLAS_ALLOW_CUSTOM_URL=true if you intend to send credentials to this destination.`
        );
      }
    }
    if (parsedUrl.protocol === "http:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "::1") {
      throw new Error("unsupported protocol: HTTPS is required for non-local destinations");
    }
  } catch (err: any) {
    if (err.message.includes("Security Notice")) {
      throw err;
    }
    throw new Error(
      "CODEATLAS_API_URL must be a valid HTTP or HTTPS URL. " +
      "Please check your configuration."
    );
  }
  return normalizedUrl;
}
