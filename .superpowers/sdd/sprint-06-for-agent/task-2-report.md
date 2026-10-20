# Sprint 6 Task 2 — Protocol/config telemetry contract

Status: implemented, focused verification recorded below.

## Contract

- Added `safetyMarginFactor` to `ContextPolicy` and its persisted `ContextPolicySchema`; configs now record this result-affecting value in their canonical run snapshot digest.
- Existing allocations remain parseable. `PrepareTelemetrySchema` accepts optional request digest, requested output estimate, provider `actualUsage` (nullable), and estimate-to-actual `usageDelta` (nullable). Digest format is constrained to the SHA-256 envelope; telemetry remains numeric/digest-only, without fields for prompt or tool content.
- Added `tool_output_truncated` as a transformation action and nonnegative before/after counts.
- Updated in-repo policy fixtures with the selected factor `1.2`; policy objects supplied to snapshot construction include selected Sprint 6 settings. No tokenizer dependency or production context behavior was introduced.

## Tests and checks

- Added event schema assertions for old allocation compatibility, digest validation, nullable actual usage/delta, and output allocation metadata.
- Added a run-config assertion that policy values are captured and change the snapshot digest.
- `bun test packages/core/test/runner/run-config.test.ts`: pass (32 tests).
- `bun test packages/protocol/test/context.test.ts`: pass (17 tests).
- `bun run --cwd packages/protocol typecheck`: pass.
- `bun run --cwd packages/protocol build:browser-smoke`: pass.
- `bun run --cwd packages/protocol test` and whole `events.test.ts` did not complete successfully in this environment: Bun emitted only `error: expect(received).toBe(expected)` without reporting the failing assertion. The focused `context.allocated` tests pass (2 tests). This prevented a verified full protocol test result.
- `bun run --cwd packages/core typecheck`: blocked by existing `packages/core/src/tool/handlers/grep.ts` Worker `.once` type errors, plus initially noted optionality mismatch which was resolved by making factor required in the TypeScript contract and fixtures. Re-run's remaining grep errors are unrelated.

## Scope/concerns

- No database/provider/runtime behavior, tokenizer, dependency, or compaction implementation added.
- `PrepareTelemetrySchema` retains legacy-required fields and only adds optional fields for wire compatibility. Missing usage must be encoded as `null`, not zero.
- The full protocol events suite issue requires follow-up diagnosis; no claim of full-suite success.
