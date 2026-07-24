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
## 2026-07-22 - [Indirect Command Injection]
**Vulnerability:** Indirect command injection vulnerability in `run_script` tool via arguments passed to `npm run` which executes the target script in a shell environment.
**Learning:** Even when `spawnSync` is used with `shell: false`, passing untrusted arguments to commands like `npm run` (which in turn launch subshells) can lead to command injection if the arguments are appended directly to the target script and contain shell metacharacters.
**Prevention:** Strictly validate or sanitize untrusted input destined for command-line arguments by blocking shell metacharacters (`&|;<>$`\n\r`) before passing them to process executors.
## 2024-07-25 - [DoS Risk in MCP Zod Schemas]
**Vulnerability:** MCP tools allowed unbounded string lengths in Zod schemas (`z.string()`).
**Learning:** Missing input length validation allows attackers to submit extremely large strings causing excessive memory usage and parsing overhead (CWE-400), leading to Denial of Service (DoS).
**Prevention:** Always explicitly set maximum string lengths (e.g., `.max(255)`) on all `z.string()` schemas.
## 2026-07-28 - [Path Traversal in Workspace Validation]
**Vulnerability:** Path traversal in `git_changes` allowed attackers to execute git commands on unauthorized directories by bypassing the `isPathInAuthorizedProjects` check using unresolved paths containing `../`.
**Learning:** Resolving a user-provided path via `fs.realpathSync()` *after* a security authorization check has already executed is ineffective. The boundary verification (`startsWith`) must evaluate the final, fully-resolved canonical path.
**Prevention:** Always resolve file system paths fully using `fs.realpathSync()` **before** performing any authorization or boundary validation checks.

## 2024-05-18 - Missing Authorization Check in Tool
**Vulnerability:** The `project_context` tool in `src/presentation/mcpServer.ts` was missing an authorization validation check (`isPathInAuthorizedProjects`) before reading configuration files, reading the README, and fetching git status from the provided project directory.
**Learning:** Even tools that only read data (like `project_context`) and seem harmless can still be exploited if they take a `project` path as an argument and construct arbitrary paths without validating against authorized workspace boundaries. An attacker might provide an absolute path like `/etc` as the project directory to read the file structure or specific configuration files.
**Prevention:** Always use the `isPathInAuthorizedProjects` check in any tool that accepts a user-provided project directory or path before proceeding with any file system operations.
