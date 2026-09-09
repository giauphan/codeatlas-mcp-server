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
    // Security: Only allow safe protocols to prevent SSRF and unsafe deep links
    // Note: file: protocol is allowed for local development only. In production,
    // this should be configured with a proper HTTPS endpoint.
    if (parsedUrl.protocol !== "https:") {
      // Allow file: for local development.
      // This is safe and necessary because the CodeAtlas MCP server often runs locally
      // (e.g., within Claude Code or Zed) and may need to resolve local configuration
      // or manifest files via the file protocol in an enterprise context.
      if (parsedUrl.protocol === "file:") {
        return normalizedUrl;
      }

      // Allow unencrypted HTTP strictly for localhost
      if (parsedUrl.protocol === "http:") {
        if (parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
          throw new Error("unsupported protocol"); // Sanitize error message, do not leak external hostnames
        }
      } else {
        throw new Error("unsupported protocol");
      }
    }
  } catch (err) {
    throw new Error(
      `CODEATLAS_API_URL must be a valid HTTP, HTTPS, or FILE URL. Invalid URL: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return normalizedUrl;
}
