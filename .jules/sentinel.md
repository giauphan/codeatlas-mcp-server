## 2025-02-14 - Fix API Key Resolution Sprawl
**Vulnerability:** Direct usage of `process.env.CODEATLAS_API_KEY` across multiple files instead of utilizing the centralized `getResolvedApiKey()` function, potentially leading to inconsistent fallback logic and missing validations for API keys.
**Learning:** Config files like `mcp.json` or `.gemini/settings.json` might define API keys that aren't exposed as top-level environment variables, and the `getResolvedApiKey()` properly resolves these. Directly querying the environment variable bypasses this functionality.
**Prevention:** Always use the centralized getter functions for sensitive configuration and API keys rather than direct environment variable lookups.
