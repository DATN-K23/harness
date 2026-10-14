# Tasks

## 1. Input Validation and Run Query Helpers

- [x] 1.1 [TV1][Sprint 2] Implement input validation functions (`validateSingleTurnInput`) in `packages/core/src/runner/single-turn-runner.ts` enforcing non-empty prompts, character length caps, and positive timeout and token bounds; verify with unit tests in `packages/core/test/runner/single-turn-runner.test.ts`.
- [x] 1.2 [TV1][Sprint 2] Implement run inspection query functions `getRun` and `getRunHistory` in `packages/core/src/runner/run-queries.ts` on top of `RunStorePort`, adapting OpenCode trajectory event ordering patterns and adding the standard OpenCode MIT attribution header; verify with unit tests in `packages/core/test/runner/run-queries.test.ts`.

## 2. SingleTurnRunner Core Orchestration Engine

- [x] 2.1 [TV1][Sprint 2] Implement `SingleTurnRunner` in `packages/core/src/runner/single-turn-runner.ts` adapting OpenCode `runTurnAttempt` lifecycle (`packages/core/src/session/runner/llm.ts`), carrying the OpenCode MIT attribution header, and coordinating run registration (`pending`/`queued`), state transition to `running`, CAS claim validation, provider attempt dispatch via `ModelGatewayPort`, and trajectory event recording; verify with unit tests simulating successful model responses.
- [x] 2.2 [TV1][Sprint 2] Implement error handling, timeout abort classification, and non-retry disruption semantics in `SingleTurnRunner`, adapting OpenCode error classification (`session/retry.ts`) and secret redaction (`packages/core/src/redaction.ts`), ensuring timeout or transport errors record `model.failed` / `run.failed` without triggering automatic blind retries; verify with unit tests in `packages/core/test/runner/single-turn-runner.test.ts`.
- [x] 2.3 [TV1][Sprint 2] Export `SingleTurnRunner`, `SingleTurnRunInput`, `SingleTurnRunResult`, `SingleTurnRunnerDeps`, `getRun`, and `getRunHistory` from `packages/core/src/index.ts`, and catalog newly adapted files in root `NOTICE`; verify exports and NOTICE compliance via `bun test packages/core/test/architecture.test.ts`.

## 3. CLI Integration and Monorepo Conformance

- [x] 3.1 [TV6/TV1][Sprint 2] Refactor `packages/cli/src/commands/run.ts` to delegate prompt execution to `SingleTurnRunner` instead of maintaining duplicated inline store and gateway coordination logic; verify execution behavior with `bun test packages/cli/test/cli-run.test.ts`.
- [x] 3.2 [TV6/TV1][Sprint 2] Refactor `packages/cli/src/commands/view.ts` to delegate run inspection and chronological event retrieval to `getRun` and `getRunHistory`; verify output formatting and event ordering with `bun test packages/cli/test/cli-view.test.ts`.
- [x] 3.3 [TV1][Sprint 2] Run full repository test suite (`bun test`) to confirm zero regressions across `@harness/protocol`, `@harness/core`, and `@harness/cli`, verifying complete acceptance against Sprint 2 Track B requirements in `docs/sprint-02-gap-analysis.md` §4.2.
