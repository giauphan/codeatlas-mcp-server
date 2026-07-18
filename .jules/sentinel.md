## 2024-06-25 - [Command Injection]
**Vulnerability:** Command injection vulnerability in run_script tool
**Learning:** Input args to script was directly appended to command executed by shell via `execSync`
**Prevention:** Sanitise input or do not run in shell.
## 2026-07-13 - Command Injection Risk in execSync
**Vulnerability:** Use of `child_process.execSync` for git commands allowed potential command injection via the `commits` parameter.
**Learning:** Even if a parameter seems safe (like a number), using shell execution (`exec`, `execSync`) is inherently risky and can interpret shell metacharacters.
**Prevention:** Always use `child_process.execFileSync` or `child_process.spawnSync` (with `shell: false`) for executing external binaries. Pass arguments as an array instead of a single string.
## 2026-07-14 - Sensitive Data Exposure in URL Parameters
**Vulnerability:** The API key `CODEATLAS_API_KEY` was being redundantly sent as a query parameter (alongside the `x-api-key` header) in URLs within `src/services/dreamingService.ts` when making requests to CodeAtlas Cloud.
**Learning:** Passing sensitive data like API keys in URL query parameters exposes them to server logs, browser history, and proxy servers (CWE-598).
**Prevention:** Always transmit API keys and other sensitive credentials securely via HTTP headers (e.g., `x-api-key`, `Authorization: Bearer`), ensuring they are omitted from the request path.
## 2026-07-15 - Authorization Bypass Risk in Local Mock Fallbacks
**Vulnerability:** The `checkAuth` function used for multi-tenant authorization fell back to granting full 'enterprise' privileges via a mock local user if no authentication context was found.
**Learning:** When software supports both single-tenant (local) and multi-tenant (cloud) deployment modes, mock security fallbacks designed for local development can inadvertently bypass authentication in production if they are not conditionally gated.
**Prevention:** Always check deployment/configuration flags (e.g., `CODEATLAS_MULTI_TENANT`) before returning mock credentials or bypassing security checks. Throw an explicit unauthorized error when running in a multi-tenant environment.
## 2024-07-18 - [YAML Injection Risk in Configuration Generator]
**Vulnerability:** The `CODEATLAS_API_KEY` was directly interpolated into a YAML string using string interpolation and double quotes (`"${key}"`).
**Learning:** Directly embedding strings into structured data formats like YAML or JSON can lead to injection vulnerabilities if the string contains quotes or newlines.
**Prevention:** Always use `JSON.stringify(value)` to securely escape variables when generating YAML or JSON configuration strings programmatically.
