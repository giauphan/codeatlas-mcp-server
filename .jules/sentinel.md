## 2024-06-25 - [Command Injection]
**Vulnerability:** Command injection vulnerability in run_script tool
**Learning:** Input args to script was directly appended to command executed by shell via `execSync`
**Prevention:** Sanitise input or do not run in shell.
## 2026-07-13 - Command Injection Risk in execSync\n**Vulnerability:** Use of `child_process.execSync` for git commands allowed potential command injection via the `commits` parameter.\n**Learning:** Even if a parameter seems safe (like a number), using shell execution (`exec`, `execSync`) is inherently risky and can interpret shell metacharacters.\n**Prevention:** Always use `child_process.execFileSync` or `child_process.spawnSync` (with `shell: false`) for executing external binaries. Pass arguments as an array instead of a single string.
