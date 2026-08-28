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
  } catch {
    throw new Error(
      "CODEATLAS_API_URL must be a valid HTTP or HTTPS URL. " +
      "Please check your configuration."
    );
  }
  return normalizedUrl;
}
