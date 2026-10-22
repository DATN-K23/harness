# Live provider follow-up — 2026-10-22

The prior manual run printed only `{providerStatus:"failed",category:"execution",runId:...}`. That category was a generic catch fallback, not evidence identifying the failure. The runner previously asserted completion before loading and reporting run events, hiding the terminal state and provider-attempt categories.

The manual script now emits a sanitized observation before success assertions: state, optional terminal reason/category, provider-attempt count, event types, and per-attempt normalized error categories. It excludes error messages, prompts, response content, headers, and event payloads. A unit test confirms sensitive payload fields do not appear in the summary.

This follow-up did **not** repeat the live run. In this checkout, `Bun.file(".env").exists()` was false and a direct root `.env` read returned `ENOENT`; the required model configuration therefore was not available to the script's loader. No disposable database was created, no provider was contacted, and the original application DB was not accessed. The prior output remains undiagnosed; do not infer a provider cause from its generic `execution` label.

Verification: sanitized summary and script safeguard tests passed (2 tests); `bun run --cwd packages/server typecheck` passed. Live provider outcome and event reachability remain unverified until the operator runs the updated script in the configured checkout with a fresh disposable database/snapshot.
