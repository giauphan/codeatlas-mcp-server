🧹 [code health improvement description]

🎯 **What:** Removed explicit `any` type assertions in `src/services/projectService.test.ts` test stubs by strictly typing `readFileSync` and `readdirSync` with standard node fs module mock signatures (specifically, making `encoding: "utf8"` explicit rather than `any`).

💡 **Why:** Reduces unsafe TypeScript fallback types in test files, standardizing test mocks closer to their real API signatures and mitigating test-time type suppression logic.

✅ **Verification:** Verified via `npm run test` which completed cleanly without typing errors in the stub implementations. `tsc` passed under `npm run build`.

✨ **Result:** Enhanced test file type hygiene and removed `as any` casting in fs-related mock functions.
