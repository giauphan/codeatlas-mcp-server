## 2024-06-25 - [Command Injection]
**Vulnerability:** Command injection vulnerability in run_script tool
**Learning:** Input args to script was directly appended to command executed by shell via `execSync`
**Prevention:** Sanitise input or do not run in shell.
## 2026-07-07 - [Authentication Bypass via Missing Auth Parameter]
**Vulnerability:** dreamingService API calls did not include the apiKey in the query parameter despite the tests demanding it.
**Learning:** The implementation for appending apiKey query parameter was missing.
**Prevention:** Ensure tests comprehensively cover all authentication logic and that API parameters are consistently added.
## 2024-07-09 - [Code Injection via Unvalidated Input]
**Vulnerability:** Code injection/RCE vulnerability in setup_second_brain tool
**Learning:** Input apiKey from the user was directly embedded into a python script without validation.
**Prevention:** Validate input format (using a restrictive regex) before embedding it into configuration files or scripts.
