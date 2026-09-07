## 2024-09-07 - Fix Command Injection in Setup Hooks
**Vulnerability:** Found `execSync` being used to run bash shell commands with unsanitized arguments, risking command injection if path variables contained shell metacharacters.
**Learning:** `execSync` launches a shell by default. While seemingly innocuous, using variables in the shell invocation opens the door for injection.
**Prevention:** Replaced `execSync` with `execFileSync` using explicit array-based arguments and setting `shell: false`. Also, replaced a bash pipe string with the `input` option of `execFileSync`.
