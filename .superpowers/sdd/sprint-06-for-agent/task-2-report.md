# Sprint 6 Task 2 — Protocol/config telemetry contract

Status: implemented and reviewer findings addressed; fix commit recorded in the session response.

## Contract

- Added `safetyMarginFactor` to `ContextPolicy` and its persisted `ContextPolicySchema`; configs now record this result-affecting value in their canonical run snapshot digest.
- Existing allocations remain parseable. `PrepareTelemetrySchema` accepts optional request digest, requested output estimate, provider `actualUsage` (nullable), and estimate-to-actual `usageDelta` (nullable). Digest format is constrained to the SHA-256 envelope; strict telemetry rejects unknown fields, including prompt/tool text.
- Token estimates, actual usage counts, saved/remaining counts, and transformation before/after counts require nonnegative integers; window must be positive and usage delta may be signed integer or null.
- Added `tool_output_truncated` as a transformation action.
- Updated in-repo policy fixtures with the selected factor `1.2`; policy objects supplied to snapshot construction include selected Sprint 6 settings. No tokenizer dependency or production context behavior was introduced.
- Legacy run snapshots omitted the new factor. The first full events-suite failure was the table case `run.started accepts its documented payload`: its fixture used the pre-Sprint-6 `snapshot()` without `safetyMarginFactor`, so `RunConfigSnapshotSchema` rejected it. `ContextPolicySchema` now defaults that field to the selected historical-compatible `1.2`; a direct legacy `run.started` fixture and config test protect this behavior.

## Tests and checks

- Added tests for all `PrepareResultSchema` outcomes, transformation action/count validation, nullable and provided actual usage/delta, raw prompt/tool telemetry rejection, allocation compatibility, and legacy run snapshot parsing.
- Added a run-config assertion that policy values are captured and change the snapshot digest.
- `bun test packages/core/test/runner/run-config.test.ts`: pass (32 tests).
- `bun test packages/protocol/test/context.test.ts`: pass (17 tests).
- `bun run --cwd packages/protocol typecheck`: pass.
- `bun run --cwd packages/protocol build:browser-smoke`: pass.
- `bun test packages/protocol/test/events.test.ts`: pass (68 tests, 133 assertions).
- `bun run --cwd packages/protocol test`: pass (146 tests, 322 assertions).
- `bun test packages/protocol/test/context.test.ts`: pass (20 tests, 51 assertions).
- `bun test packages/core/test/runner/run-config.test.ts`: pass (33 tests, 59 assertions).
- `bun run --cwd packages/core typecheck`: blocked by existing `packages/core/src/tool/handlers/grep.ts` Worker `.once` type errors, plus initially noted optionality mismatch which was resolved by making factor required in the TypeScript contract and fixtures. Re-run's remaining grep errors are unrelated.
- `bun run --cwd packages/protocol typecheck`: pass.
- `bun run --cwd packages/protocol build:browser-smoke`: pass (79 modules bundled).
- `git diff --check`: pass.
- TDD evidence: missing-factor event regression initially failed; telemetry integer/raw-field regression tests initially failed; the legacy default assertion was deliberately checked against wrong expected `1.1` and failed before restoring expected `1.2`. All now pass.

## Scope/concerns

- No database/provider/runtime behavior, tokenizer, dependency, or compaction implementation added.
- `PrepareTelemetrySchema` retains legacy-required fields and only adds optional fields for wire compatibility. Missing usage must be encoded as `null`, not zero.
- No unresolved protocol-suite failures. Core package typecheck remains blocked by unrelated Worker typing errors noted above.
