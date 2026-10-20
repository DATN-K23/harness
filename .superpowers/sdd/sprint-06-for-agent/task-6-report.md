# Sprint 6 Task 6 — Disk → context → tool → model verification

Status: offline verification complete; no product-code changes required.

## Changes

- Extended `packages/core/test/runner/disk-chain-e2e.test.ts` to use `ProductionContextEngine(createO200kTokenizer())` for the disk-backed tool round trip.
- Verified tool schemas and request/result history, sequential event numbering, and that every `context.allocated.telemetry.requestDigest` equals `digestOf` the corresponding captured gateway request. `getMultiTurnExecutionSummary` returns matching telemetry/digests.
- Added mandatory oversized-context coverage: terminal state `budget_exhausted`, reason `context_budget`, and zero gateway calls.
- Added a tool-output secret regression with a synthetic secret in a temporary local source fixture. The sanitized/shaped request, events, and readback contain no raw secret; the digest is checked against the sanitized captured gateway request.

## Verification

- Disk-chain cases: 3 pass, 0 fail, 27 assertions.
- Focused core context/multi-turn group (including disk-chain): 51 pass, 0 fail.
- Protocol suite: 146 pass, 0 fail.
- CLI view tests: 5 pass, 0 fail.
- `bun run --cwd packages/protocol typecheck`: passes.
- Core and CLI typechecks plus `bun turbo typecheck`: fail only on the known pre-existing `packages/core/src/tool/handlers/grep.ts` Worker `.once` typings (TS2339 ×3 and TS7006). No Task 6 test-file type errors remain.
- No DB suite or live provider test run.

## Live verification decision

Offline Task 6 is complete. A bounded live run remains unperformed because it may incur provider cost and needs separate authorization. No run ID, provider usage, or cost is available.
