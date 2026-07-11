## 2024-06-25 - [Command Injection]
**Vulnerability:** Command injection vulnerability in run_script tool
**Learning:** Input args to script was directly appended to command executed by shell via `execSync`
**Prevention:** Sanitise input or do not run in shell.
## 2025-02-14 - Replace execSync with execFileSync to prevent Command Injection
**Vulnerability:** Use of `child_process.execSync` to run `git` commands leaves the codebase vulnerable to shell command injection if the current working directory path or tool arguments inadvertently contain untrusted characters.
**Learning:** `execSync` relies on the system shell to execute commands, exposing any interpolation to shell features like `;` or `|`.
**Prevention:** Use `child_process.execFileSync` (or `spawnSync`) instead of `execSync`, bypassing the shell by explicitly invoking the executable ("git") and passing arguments as an array.
