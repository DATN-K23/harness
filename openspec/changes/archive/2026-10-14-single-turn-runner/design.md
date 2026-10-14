# Design

## Context

Sprint 2 establishes the minimal end-to-end real execution path for prompt execution, model gateway dispatch, and persistent storage retrieval. Currently, `@harness/core` contains `JudgeRunner`, which is designed for multi-stage smart contract security auditing (with finding parsing, sanitizer, sandbox, and multi-step tool reasoning). Meanwhile, `packages/cli` inlined its own makeshift runner directly in `commands/run.ts` to coordinate `RunStorePort` and `ModelGatewayPort`.

Per **ADR-008** (adopting OpenCode's module structure and technology stack as the architectural model), the project strongly prioritizes reusing and adapting proven code patterns, structures, and utility routines from the OpenCode codebase (`3f393d78bf`, MIT License) rather than inventing redundant mechanisms. 

To fulfill Track B (Dev B) in `docs/sprint-02-gap-analysis.md` §4.2 and `docs/sprint-02.md`, this design introduces a dedicated, standalone `SingleTurnRunner` and run inspection query helpers (`getRun`, `getRunHistory`) in `@harness/core`, adapting OpenCode's turn execution, error classification, and identification patterns while maintaining strict boundary contracts between orchestration (B), persistence storage (C), and provider adapters (D).

See `proposal.md` for background motivation and `specs/single-turn-runner/spec.md` for requirement contracts.

## Goals / Non-Goals

**Goals:**
- **Prioritize OpenCode Code Reuse**: Adapt established OpenCode session runner, turn attempt, error classification, redaction, and CLI patterns with full attribution.
- Provide a modular, robust `SingleTurnRunner` in `@harness/core` coordinating run lifecycle (`pending`/`queued` → `running` → `completed` | `failed`).
- Enforce strict pre-flight validation on prompt inputs, token limits, and timeouts before initiating provider calls.
- Guarantee that ambiguous provider failures or timeouts are recorded with explicit failure events rather than triggering silent or duplicate retries.
- Provide clean, typed query functions (`getRun`, `getRunHistory`) on top of `RunStorePort` that guarantee chronological trajectory event ordering.
- Refactor `packages/cli/src/commands/run.ts` and `view.ts` to delegate to the new core runner and query helpers without changing their external CLI interface.
- Maintain strict ground-truth isolation and secret sanitization across all persisted events and return values.

**Non-Goals:**
- Multi-step Judge reasoning loops, tool dispatching, context compaction, or PoC execution (reserved for Judge mode in Sprint 7–8).
- Database table definitions, Drizzle migrations, or SQL drivers (owned by Track C in `packages/schema`).
- Concrete provider HTTP SDK integration (owned by Track D in `packages/llm`).
- CLI argument parsing, environment variable validation, or `.env` configuration (owned by Track A in `packages/cli`).
- Ground-truth evaluation, contest splits, or scoring metrics (owned by TV5 / Scorer).

## Decisions

### Decision 1: Prioritize Reusing OpenCode Architecture and Code Patterns (ADR-008)
- **Choice**: Systematically adapt proven patterns and implementations from OpenCode (`3f393d78bf`, MIT License), porting them to plain TypeScript with explicit attribution headers and root `NOTICE` entries.
- **OpenCode Provenance & Reuse Mapping**:

| Reusable Concern | OpenCode Source (`3f393d78bf`) | Harness Adaptation (`@harness/core`, `@harness/cli`) |
|---|---|---|
| **Turn Execution Lifecycle** | `packages/core/src/session/runner/llm.ts` (`runTurnAttempt`) | Adapt the attempt lifecycle into `SingleTurnRunner.execute()`: step/attempt indexing, start/end timing, duration measurement, token usage aggregation, and structured event emission. |
| **Error Classification** | `packages/opencode/src/session/retry.ts`<br>`packages/llm/src/provider-error.ts` | Reuse classification logic already ported into `packages/core/src/runner/retry-policy.ts` (`classifyError`, `isContextOverflow`) for consistent error categories (`transport`, `rate_limit`, `authentication`, `invalid_request`). |
| **Secret Redaction** | `packages/core/src/redaction.ts`<br>`packages/cli/src/redaction.ts` | Reuse string redaction patterns to scrub credentials from prompt traces, error strings, and persisted events before committing to `RunStorePort`. |
| **ID & Sequence Generation** | `packages/schema/src/identifier.ts` | Reuse `createIdGenerator` from `packages/core/src/util/id.ts` for monotonic, sortable `run_` and `evt_` identifiers. |
| **CLI Command & Trajectory View** | `packages/cli/src/commands/run.ts`<br>`packages/cli/src/commands/view.ts` | Retain OpenCode CLI UX patterns (summary tables, secret masking, chronological event streams) while refactoring execution internals to call `SingleTurnRunner`. |

- **Attribution & Conformance**:
  - Every adapted file must begin with:
    `// Adapted from OpenCode <source path> @ 3f393d78bf (MIT License, Copyright (c) 2025 opencode). See NOTICE.`
  - All adapted files are listed in root `NOTICE`.
  - Conformance is verified by `packages/core/test/architecture.test.ts`.
- **Adaptation Rules (Differences from Upstream OpenCode)**:
  - *No Effect runtime dependency*: OpenCode V2 is written with Effect (`Effect.gen`, `Layer`, `Stream`). The harness ports logic to standard TypeScript (`async/await`, `AbortSignal`, Zod schemas, injected ports) per ADR-008.
  - *PostgreSQL/CAS authority instead of local SQLite*: OpenCode uses process-local state/SQLite for interactive sessions. Harness runs execute against `RunStorePort` with Compare-and-Set concurrency and unique contiguous sequence ordering.
  - *No blind automatic retry*: OpenCode retries transient network errors automatically. For the Sprint 2 direct-model baseline (RQ1), automated retries are disabled to guarantee cost predictability and reproducibility; interruptions are recorded explicitly.

### Decision 2: Dedicated `SingleTurnRunner` class in `@harness/core` vs overloading `JudgeRunner`
- **Choice**: Implement a standalone `SingleTurnRunner` class alongside query helpers in `packages/core/src/runner/single-turn-runner.ts` and `run-queries.ts`.
- **Rationale**: `JudgeRunner` is tightly coupled with multi-stage audits (`IngestionPort`, `SanitizerPort`, `SandboxPort`, `ToolRegistryPort`, `ContextEnginePort`, `JudgeVerdict`). Forcing single-turn prompt execution through `JudgeRunner` would require fabricating mock finding markdown, fake snapshots, and empty tool registries. A dedicated `SingleTurnRunner` cleanly models the direct-model baseline required for RQ1 without altering `JudgeRunner`.
- **Alternatives Considered**: Adding a "single-turn mode" flag to `JudgeRunner`. Rejected because it introduces branch complexity and violates single responsibility across two fundamentally different lifecycles.

### Decision 3: Separation of Execution and Query APIs
- **Choice**: Expose `SingleTurnRunner` for execution and separate standalone functions `getRun(runId, store)` and `getRunHistory(runId, store)` for read queries.
- **Rationale**: Execution requires gateway dependencies, timer handling, and state mutation privileges. Querying completed runs only requires read access to `RunStorePort`. Decoupling them allows read-only callers (like `cli:view` or future web viewers) to query runs without instantiating execution dependencies.
- **Alternatives Considered**: Putting `getRun` as a method on `SingleTurnRunner`. Rejected because read operations do not need a model gateway or runner instance.

### Decision 4: Atomic State Transitions and Compare-and-Set (CAS)
- **Choice**: Follow the protocol's CAS semantics via `store.claim` and `store.transition`.
- **Flow**:
  1. Input validation (prompt length, timeout, limits).
  2. Run registration & claim: `seedRun` (if available) → `claim({ runId, workerId })`.
  3. Emit `run.queued` event.
  4. Transition to `running`.
  5. Invoke `gateway.executeAttempt(request, signal)`.
  6. On success: emit completion event (`model.responded` / `provider.attempted`), transition to `completed`.
  7. On error/timeout: emit failure event (`provider.failed` / `run.failed`), transition to `failed`.
- **Rationale**: Ensures resilience against duplicate workers and aligns with the Conformance Test Suite defined in `@harness/core/testing/run-store-contract.ts`.

### Decision 5: Non-Retry Guarantee on Ambiguous Disruption
- **Choice**: When a provider call encounters a timeout (`AbortSignal.timeout`), network disconnect, or rate-limit error, the single-turn runner records the exact error category, persists the failure event, and terminates the run with `state: "failed"`.
- **Rationale**: In benchmark evaluation (RQ1), automated retries on ambiguous timeouts can duplicate token expenditure or cause silent nondeterminism. All retries, if any in future sprints, must be explicit and observable.
- **Alternatives Considered**: Implementing exponential backoff retry in `SingleTurnRunner`. Rejected for Sprint 2 direct-model baseline per Gap Analysis §4.2 ("Không tự ý retry khi kết quả provider trả về là timeout/chưa rõ ràng mà không ghi nhận dấu vết gián đoạn").

### Decision 6: Secret Sanitization at the Runner Boundary
- **Choice**: The runner accepts a list of `secrets` (e.g. API keys) and ensures that all output text, error messages, and event payloads passed to `store.appendEvent` or returned to callers are scrubbed via redaction prior to storage, adapting OpenCode's redaction helpers.
- **Rationale**: Prevents accidental leakage of authorization tokens into PostgreSQL database records or log files.

## Module Ownership & Trust Boundaries

- **Ownership (Track B / Dev B / TV1)**:
  - `packages/core/src/runner/single-turn-runner.ts`
  - `packages/core/src/runner/run-queries.ts`
  - `packages/core/test/runner/single-turn-runner.test.ts`
  - `packages/core/test/runner/run-queries.test.ts`
- **Consumer (Track A / Dev A / TV6)**:
  - `packages/cli/src/commands/run.ts` delegates execution to `SingleTurnRunner`.
  - `packages/cli/src/commands/view.ts` delegates inspection to `getRun` and `getRunHistory`.
- **Storage Port (Track C / Dev C / TV6)**:
  - Runner interacts exclusively through `RunStorePort` (`claim`, `appendEvent`, `transition`, `loadRun`, `loadEvents`).
- **Provider Port (Track D / Dev D / TV1)**:
  - Runner interacts exclusively through `ModelGatewayPort` (`executeAttempt`).
- **Trust Boundary & Ground-Truth Isolation**:
  - `SingleTurnRunner` operates only on user prompts and candidate findings. It has no access to ground-truth labels, test annotations, or scoring databases.

## Risks / Trade-offs

- **[Risk] Over-relying on OpenCode dragging in Effect or SQLite assumptions**  
  → *Mitigation*: Port only clean algorithmic patterns (turn lifecycle, error classification, redaction) into plain TypeScript with `async/await`, standard `AbortSignal`, and project Zod schemas. Strictly prohibit importing `@opencode-ai/*`.
- **[Risk] Store implementation variations (InMemoryRunStore vs PostgresRunStore)**  
  → *Mitigation*: The runner relies strictly on `RunStorePort` interface methods. If `seedRun` is missing (as in a raw SQL store without pre-seeding), the runner handles initial registration gracefully through `claim` or initial state creation.
- **[Risk] Provider timeouts hanging execution**  
  → *Mitigation*: Enforce timeout via `AbortSignal.timeout(timeoutMs)`. If the provider aborts or throws, catch the abort error, classify as `timeout`, record `model.failed` / `run.failed`, and commit terminal state.
- **[Risk] Breaking CLI command contracts during refactoring**  
  → *Mitigation*: Ensure `executeRunCommand` and `executeViewCommand` retain their exact parameter and return signatures, validating against existing `cli-run.test.ts` and `cli-view.test.ts`.

## Migration Plan

1. Implement `SingleTurnRunner` and `run-queries.ts` in `@harness/core` adapting OpenCode patterns with full attribution headers.
2. Update `NOTICE` at the repository root to catalog newly adapted files.
3. Export the new symbols through `packages/core/src/index.ts`.
4. Update `packages/cli/src/commands/run.ts` to use `SingleTurnRunner`.
5. Update `packages/cli/src/commands/view.ts` to use `getRun` and `getRunHistory`.
6. Run `packages/core/test/architecture.test.ts` and `bun test` across the monorepo to confirm compliance with OpenCode attribution and zero test regressions.
