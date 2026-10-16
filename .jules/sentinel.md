## 2024-10-24 - SSRF and Config Injection via unvalidated API URL

**Vulnerability:**
Multiple network service endpoints (`projectService.ts`, `dreamingService.ts`) read `process.env.CODEATLAS_API_URL` directly and constructed requests based on it without any host or protocol validation.

**Learning:**
Even if a central utility (`envUtils.getApiUrl`) exists to validate and parse environment-provided URLs securely (enforcing HTTPS and authorized hosts), developers may bypass it if they read `process.env` directly. This creates a critical gap where a maliciously injected environment variable could route sensitive data (like `x-api-key`) to an attacker-controlled server (SSRF/Credential exfiltration).

**Prevention:**
Always use centralized configuration accessors (like `getApiUrl()`) instead of raw `process.env` reads for any variable that influences network routing or execution context. Ensure that test files are also updated to comply with the stricter security policies (e.g., setting `CODEATLAS_ALLOW_CUSTOM_URL="true"` in tests when mocking local servers).
