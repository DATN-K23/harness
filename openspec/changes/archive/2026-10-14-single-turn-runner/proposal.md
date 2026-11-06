# Proposal

## Why

Sprint 2 establishes the core real-execution foundation: submitting a prompt, executing a model call, persisting the run and trajectory events, and inspecting the record across restarts. Currently, the repository contains a multi-stage, finding-oriented `JudgeRunner` in `@harness/core`, while the CLI in `packages/cli` directly inlines raw store calls and mock gateways. 

To satisfy Track B (Dev B) of Sprint 2 (`docs/sprint-02-gap-analysis.md` §4.2 and `docs/sprint-02.md`), we need a dedicated, decoupled `SingleTurnRunner` and run inspection query API in `@harness/core`. This serves research question RQ1 by establishing the canonical direct-model baseline execution harness, enforcing clean boundary contracts between orchestration (B), storage (C), and provider adapters (D).

## What Changes

- **Prioritize OpenCode code and pattern reuse (ADR-008)**: Systematically adapt proven patterns from OpenCode (`3f393d78bf`, MIT License), specifically the turn execution attempt lifecycle (`packages/core/src/session/runner/llm.ts`), error classification (`session/retry.ts`, `provider-error.ts`), string redaction (`packages/core/src/redaction.ts`), and sortable ID generation (`identifier.ts`). Every adapted file carries an OpenCode attribution header and is cataloged in `NOTICE`.
- **Add `SingleTurnRunner` orchestrator**: Introduce a focused, robust single-turn runner in `packages/core` that coordinates run initialization (`pending`/`queued`), execution state progression (`running`), provider invocation through `ModelGatewayPort`, event emission (`run.queued`, `run.started`, `model.completed`, `model.failed`), and terminal compare-and-set state transitions (`completed` or `failed`).
- **Input validation & pre-flight boundary checks**: Enforce strict pre-flight validation on prompt length, token limits, and execution timeouts prior to dispatching provider calls.
- **Interruption and non-retry guarantees**: Ensure ambiguous provider failures or timeouts are recorded with explicit disruption events rather than triggering unrecorded or duplicate provider invocations.
- **Run inspection query APIs**: Expose canonical query functions (`getRun`, `getRunHistory`) leveraging `RunStorePort` to retrieve run summaries and chronologically ordered trajectory events.
- **Refactor CLI entrypoints**: Update `packages/cli/src/commands/run.ts` and `view.ts` to delegate execution and inspection to the core `SingleTurnRunner` and query APIs, eliminating duplicated inline coordination logic.
- **Research controls & scope discipline**:
  - *Research Question Served*: RQ1 (direct-model baseline vs harness evaluation, providing clean latency, token usage, cost, and output measurements).
  - *Explicit Non-Goals*: Multi-turn Judge reasoning loops, tool dispatch, context compaction, and PoC execution (deferred to Sprint 7–8 / Judge phase); PostgreSQL Drizzle schema and migrations (Track C); real provider SDK adapters (Track D); CLI argument parsing and environment config (Track A); ground-truth scoring or contamination data (strictly excluded).
  - *Non-negotiable Controls*: Ground-truth isolation, zero secret leakage in persisted events, immutable sequence-ordered trajectory events, and compare-and-set concurrency protection.

## Capabilities

### New Capabilities
- `single-turn-runner`: Bounded single-turn prompt execution, input constraint validation, event recording, state transition coordination, and run history retrieval.

### Modified Capabilities
<!-- None. Existing specs (judge-run-lifecycle, cli-run-entrypoint) retain their broader multi-step and CLI requirement contracts. -->

## Impact

- **Affected Packages**:
  - `packages/core`: Add `SingleTurnRunner`, input validators, query helpers in `src/runner/single-turn-runner.ts` and `src/runner/run-queries.ts`, exported from `packages/core/src/index.ts`. Add comprehensive unit and integration tests under `packages/core/test/runner/`.
  - `packages/cli`: Refactor `packages/cli/src/commands/run.ts` and `packages/cli/src/commands/view.ts` to consume the new `SingleTurnRunner` and query APIs instead of inlining orchestration.
  - `packages/protocol`: Ensure `RunState`, `RunRecord`, `ModelAttemptRequest`, and event schemas cleanly accommodate single-turn prompt metadata without breaking `JudgeRunner`.
  - Root `NOTICE`: Add adapted file entries for `packages/core/src/runner/single-turn-runner.ts` and `packages/core/src/runner/run-queries.ts`.
- **APIs & Dependencies**: No external runtime dependencies added. Uses existing `@harness/protocol` interfaces (`RunStorePort`, `ModelGatewayPort`, `ClockPort`, `IdGenerator`).
