## 2024-07-29 - [Authentication Bypass via Mock Fallback]
**Vulnerability:** The `checkAuth` function used for authorization fell back to granting full privileges via a mock local user if no authentication context was found and `CODEATLAS_MULTI_TENANT` was not explicitly enabled.
**Learning:** Returning mock authentication credentials as a default fallback allows attackers to easily bypass authentication simply by not providing any credentials.
**Prevention:** Never use mock objects or fallback roles when authentication fails or is missing. Always throw an explicit unauthorized error.
## 2026-08-02 - [Authorization Bypass in Export Tool]
**Vulnerability:** The `export_team_artifact` tool lacked authorization checks, potentially allowing arbitrary file creation inside unauthorized directories due to unvalidated `projectDir`.
**Learning:** Any tool that performs file system operations (like writing export files) must validate the target directory against authorized workspace bounds, even if the directory appears to be loaded from internal state (`loadAnalysisAsync`), to prevent authorization bypasses.
**Prevention:** Consistently apply `fs.realpathSync` followed by `isPathInAuthorizedProjects` to all tools before performing any file I/O operations, regardless of whether the path is directly user-provided or retrieved from internal state.

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

## 2024-08-07 - Prevention of API Key Exposure in Config Files
**Vulnerability:** The MCP server setup tool (`setup_second_brain`) wrote the `CODEATLAS_API_KEY` in plaintext directly into configuration files for clients like Hermes and Claude Desktop. This exposed sensitive credentials if the configuration files were shared or accessed by unauthorized users/scripts.
**Learning:** Hardcoding secrets inside tool-generated application configurations introduces high risk of credential leakage. For local applications or MCP servers, secrets should be managed through standard, secure environment variable pipelines (like `.env` files) rather than injected as static strings into application configurations.
**Prevention:** Instead of injecting credentials into client configurations, the tool should securely write the credentials to an application-specific configuration file (e.g. `~/.codeatlas/.env`) with restricted permissions (`0o600`), and the main application entrypoint (`index.ts`) should be updated to load this secure configuration file dynamically using `dotenv`.

## 2025-02-28 - Indirect Command Injection Risk via git arguments
**Vulnerability:** Git commands invoked via `child_process.spawnSync` can be susceptible to argument injection if arguments are not fully trusted, even when `shell: false` is used. Git accepts global flags like `-c`, `--exec-path`, `--pager`, `--config-env`, and others that can lead to arbitrary code execution if an attacker manages to inject them.
**Learning:** Always validate and explicitly allowlist or denylist arguments passed to external binaries like `git`, particularly those that might be influenced by external input. Explicit sanitization ensures that no unexpected or dangerous flags are processed.
**Prevention:** Implement an explicit sanitization step (e.g., filtering out strings starting with `-c`, `--exec-path`, `--pager`, etc.) before passing the argument array to `spawnSync` when wrapping tools like `git`.

## 2024-10-25 - [Fix TOCTOU Symlink Write Vulnerability in Artifact Export]
**Vulnerability:** The `export_team_artifact` tool used `fs.writeFileSync` to write `artifact-summary.json` and `artifact.json`. Despite comments indicating an intention to "Prevent symlink following on the output file itself", `fs.writeFileSync` intrinsically follows symlinks, leaving the application vulnerable to symlink-based TOCTOU (Time-of-Check to Time-of-Use) attacks where an attacker could overwrite arbitrary system files by pre-creating symlinks.
**Learning:** Comments indicating security intent are not sufficient if the underlying API does not support the required semantics. `fs.writeFileSync` cannot be instructed to ignore symlinks via string flags like `"w"`.
**Prevention:** To prevent TOCTOU and symlink following vulnerabilities when writing files, avoid `fs.writeFileSync(..., { flag: "w" })`. Instead, obtain a secure file descriptor using `fs.openSync` with the explicit `fs.constants.O_NOFOLLOW` flag alongside `O_CREAT | O_WRONLY | O_TRUNC`, write to the descriptor, and ensure it is reliably closed (e.g., using a `try...finally` block).
