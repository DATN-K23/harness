# Design

## Context
See `proposal.md` for motivation. Currently, the monorepo workspace contains `@harness/protocol`, `@harness/core`, `@harness/schema`, `@harness/llm`, and `@harness/cli`. While unit tests for each package pass in isolation using in-memory test doubles, the CLI is disconnected from PostgreSQL persistence because:
1. `packages/cli/package.json` does not list `@harness/schema` as a dependency.
2. `packages/cli/src/index.ts` silences `loadRuntimeConfig()` exceptions and unconditionally uses `InMemoryRunStore`, preventing persistence.
3. `packages/cli/src/index.ts` creates a fresh, empty `InMemoryRunStore` for every `view` command execution.
4. `SingleTurnRunner` invokes `deps.store.seedRun(runId, "queued")` without awaiting the returned promise, causing a race condition where `claim()` queries the database before `seedRun` completes the insert.
5. In `PostgresRunStore`, `transition()` only updates `state`, `stateVersion`, and `terminalReason`, leaving `resultContent`, `errorMessage`, `promptTokens`, `completionTokens`, `costUsd`, and `latencyMs` `NULL` in the `runs` table, while `loadRun` does not extract these columns.

## Goals / Non-Goals

**Goals:**
- Provide a robust end-to-end flow: `cli:run` submits prompt $\rightarrow$ persists run in PostgreSQL $\rightarrow$ calls model gateway $\rightarrow$ updates run and records events $\rightarrow$ terminates cleanly with closed DB connections.
- Ensure `cli:view` retrieves and displays the full run record and chronological trajectory events across process restarts.
- Ensure `SingleTurnRunner` safely awaits asynchronous `seedRun` calls and writes terminal execution metrics (prompt, result/error, tokens, cost, latency) to the store.
- Fail fast with descriptive diagnostics when required configuration (`DATABASE_URL`, `MODEL_API_KEY`, etc.) is missing, retaining mock mode only when explicitly requested.
- Prioritize reusing verified code patterns from OpenCode reference implementation (`@ 3f393d78bf`).

**Non-Goals:**
- Multi-turn Judge agent loop or context engine compaction (Sprint 7–8).
- Daemon/background worker processes or HTTP server integrations (Sprint 3–4).
- Modifying `JudgeRunner` (which maintains separate adjudication step lifecycles).

## Decisions

### 1. Code Provenance: Prioritizing OpenCode Reference Patterns
All implementation updates will adapt battle-tested code patterns directly from OpenCode (`opencode` upstream repository at `@ 3f393d78bf`, MIT License):
- CLI execution lifecycle, database pool teardown, and argument parsing adapted from OpenCode `packages/cli/src/index.ts`.
- Runner outcome synchronization adapted from OpenCode `packages/core/src/session/runner/llm.ts`.
- All adapted files must include proper provenance comments: `// Adapted from OpenCode <file> @ 3f393d78bf (MIT License). See NOTICE.`

### 2. Dependency and Connection Lifecycle Management in CLI
Add `@harness/schema: "workspace:*"` to `packages/cli/package.json`. In `packages/cli/src/index.ts`:
- Validate configuration with `loadRuntimeConfig()`. If validation fails, report the error with missing keys and exit with code 1.
- If `--mock` flag is present, explicitly instantiate `InMemoryRunStore` and `ScriptedModelGateway`.
- When valid configuration is present, instantiate `PostgresRunStore({ url: config.databaseUrl })` and `RealModelGateway`.
- Wrap execution in a `try ... finally` block to call `await store.close()` on `PostgresRunStore`, ensuring no lingering client sockets prevent the Bun process from exiting promptly.

### 3. Eliminating the Race Condition in `SingleTurnRunner`
In `packages/core/src/runner/single-turn-runner.ts`:
- Change:
  ```typescript
  if ("seedRun" in this.deps.store && typeof this.deps.store.seedRun === "function") {
    await Promise.resolve(this.deps.store.seedRun(runId, "queued", input.prompt))
  }
  ```
- This ensures that for asynchronous stores (`PostgresRunStore`), the `INSERT INTO runs` transaction finishes and commits before `store.claim({ runId, workerId })` attempts to select and lock the record.

### 4. Persisting Run Outcomes in PostgreSQL and Protocol Contract
- Extend `RunRecord` in `@harness/protocol/src/ports.ts` with optional outcome fields:
  ```typescript
  export interface RunRecord {
    runId: string
    state: RunState
    stateVersion: number
    terminalReason?: TerminalReason
    prompt?: string
    modelProfile?: string
    resultContent?: string
    errorMessage?: string
    errorCategory?: string
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    costUsd?: string | number
    latencyMs?: number
  }
  ```
- Update `PostgresRunStore.transition()` or provide an outcome update mechanism to persist `resultContent`, `errorMessage`, `errorCategory`, `promptTokens`, `completionTokens`, `totalTokens`, `costUsd`, and `latencyMs` upon reaching a terminal state.
- Update `PostgresRunStore.loadRun()` to map these columns from the database record into the returned `RunRecord`.
- Update `InMemoryRunStore` to mirror these outcome fields for test fidelity.

### 5. Rich Formatted Output in CLI `view`
Update `packages/cli/src/commands/view.ts`:
- In addition to `runId`, `state`, and `terminalReason`, print:
  - Original prompt
  - Model result or sanitized error category/message
  - Token metrics (prompt, completion, total)
  - Estimated cost USD and latency in ms
  - Chronological trajectory events with timestamp and sanitized payloads

### 6. Spec-Driven Execution & Review Governance
- The change execution will follow SDD (Spec-Driven Development) conventions.
- Implementation will be performed by 1 delegated subagent executing tasks sequentially against the delta specifications.
- The main agent will act as reviewer, auditing code diffs, verifying OpenCode attribution, verifying ground-truth isolation invariants, and checking test runs before marking tasks complete.

## Risks / Trade-offs

- **Dangling Database Connections**: PostgreSQL connection pools left open prevent Node/Bun CLI processes from exiting.
  *Mitigation*: Implement and invoke `store.close()` inside `finally` blocks for both `run` and `view` commands.
- **Protocol Contract Expansion**: Adding optional fields to `RunRecord` touches `@harness/protocol`.
  *Trade-off*: All added fields are strictly optional (`?`), maintaining 100% backward compatibility across all 575 existing unit tests.
- **Local Database Dependency in CI**: CI runs may not have PostgreSQL active.
  *Mitigation*: Follow the established pattern in `postgres-run-store.test.ts` where tests requiring live PostgreSQL conditionally run if `DATABASE_URL` is reachable, while unit tests with mock stores continue running in all environments.
