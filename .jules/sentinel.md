## 2024-07-29 - [Authentication Bypass via Mock Fallback]
**Vulnerability:** The `checkAuth` function used for authorization fell back to granting full privileges via a mock local user if no authentication context was found and `CODEATLAS_MULTI_TENANT` was not explicitly enabled.
**Learning:** Returning mock authentication credentials as a default fallback allows attackers to easily bypass authentication simply by not providing any credentials.
**Prevention:** Never use mock objects or fallback roles when authentication fails or is missing. Always throw an explicit unauthorized error.

## 2025-02-14 - Indirect Command Injection via CWD
**Vulnerability:** The `run_script` tool passed user-influenced directory paths directly as the `cwd` argument in `child_process.spawnSync()`. While `shell: false` was used for the execution, the target binary (e.g. `npm run`) internally spawns a shell to execute the script in the `package.json`. A malicious directory path containing shell metacharacters (e.g., `&`, `;`) could escape the directory path context and lead to command injection if the spawned binary itself (or a downstream child process) constructs shell commands using the `cwd` unsafely. The vulnerability depends on the specific binary internals, not Node.js `spawnSync` itself.
**Learning:** Even when using `shell: false`, child processes that subsequently invoke their own shells (like `npm` or `sh`) may be vulnerable to command injection if the current working directory (`cwd`) is attacker-controlled and unsanitized.
**Prevention:** Always sanitize user-influenced directory paths using strict pattern matching (like `SHELL_METACHAR_RE`) before passing them as the `cwd` in child process executions.

## 2025-02-23 - Prevent String Replacement Injection in String.prototype.replace()
**Vulnerability:** The configuration string replacement in `mcpServer.ts` passed dynamic content (`mcpEntry`, which contains an environment variable) as a string to `String.prototype.replace()`.
**Learning:** If the dynamic content includes special replacement patterns (like `$&`, `$1`, or `$'`), the `replace` function interpolates the matches instead of treating it as literal text, which can cause data corruption or structural injection in generated configuration files.
**Prevention:** Always use a replacer function (e.g., `() => replacement`) instead of a string argument when using `String.prototype.replace()` with dynamic or external input.

## 2024-08-02 - Indirect Command Injection via Unsanitized `cwd` in `spawnSync`
**Vulnerability:** Indirect command injection vulnerability in `run_script` tool where an unvalidated `projectDir` was passed as `cwd` to `child_process.spawnSync` despite `shell: false` being used.
**Learning:** Target binaries like `npm` or `sh` may internally spawn their own shells. If the `cwd` parameter is attacker-controlled and contains shell metacharacters, it can become an indirect command injection vector even when `spawnSync` is explicitly configured with `shell: false`.
**Prevention:** Always sanitize user-influenced directory paths (e.g., using `SHELL_METACHAR_RE` regex) before passing them as the `cwd` option in child process executions.