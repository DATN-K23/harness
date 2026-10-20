# Sprint 6 Task 5 — Context telemetry readback

Status: complete.

## Changes

- `getMultiTurnExecutionSummary` now reconstructs bounded context telemetry from ordered allocation/transformation events, preserving legacy runs with no allocation events.
- Summaries include policy/tokenizer, estimates, reserve/safety, nullable provider usage, usage delta, request digest, and ordered transformation savings. Raw context is not added.
- Human multi-turn view displays the telemetry summary; JSON inherits the same bounded summary fields. Existing single-turn output is unchanged.

## Verification

- `bun test packages/core/test/runner/run-queries.test.ts packages/cli/test/cli-view.test.ts` — 11 pass, 0 fail.
- No DB suite or live test run.

## Limitations

- Focused tests cover existing query/view behavior; no database-backed readback was run.
