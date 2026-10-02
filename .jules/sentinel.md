## 2025-02-20 - Centralize Secure API Key Retrieval
**Vulnerability:** Direct unmanaged access to environment variables (`process.env.CODEATLAS_API_KEY`) was scattered across various tools in `src/presentation/mcpServer.ts`.
**Learning:** Hardcoded environment variables bypass the designed centralized resolution logic (e.g. `getResolvedApiKey`), which handles fallbacks, overrides, and multi-tenant constraints. This could lead to a scenario where API keys are improperly exposed, logged, or inadvertently bypassed if environment mechanisms change.
**Prevention:** Always use the centralized `getResolvedApiKey()` function for retrieving the CodeAtlas API key. Avoid direct `process.env` lookups within business or presentation logic.
