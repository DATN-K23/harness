# Tasks

<!--
Execution Governance:
- Methodology: Spec-Driven Development (SDD) based on specs/cli-run-entrypoint/spec.md and specs/single-turn-runner/spec.md.
- Code Provenance: Prioritize adapting verified patterns from OpenCode reference repository (@ 3f393d78bf, MIT License) with attribution headers.
- Roles: 1 Subagent executes implementation edits; Main Agent conducts code review against research invariants and verifies acceptance.
-->

## 1. Protocol & Store Contracts (TV1 / TV6)

- [x] 1.1 Expand `RunRecord` in `@harness/protocol/src/ports.ts` with optional outcome fields (`prompt`, `modelProfile`, `resultContent`, `errorMessage`, `errorCategory`, `promptTokens`, `completionTokens`, `totalTokens`, `costUsd`, `latencyMs`) preserving strict backward compatibility.
  - Subagent task: Edit `ports.ts` with OpenCode attribution.
  - Main Agent review: Verify backward compatibility and type checking across core.
  - Verification: `bun run --cwd packages/protocol typecheck` succeeds without errors.
- [x] 1.2 Update `PostgresRunStore` (`packages/schema/src/store/postgres-run-store.ts`) to persist execution outcome columns in the `runs` table and map them in `loadRun`, adapting OpenCode's query projection patterns.
  - Subagent task: Implement outcome persistence and retrieval in `PostgresRunStore`.
  - Main Agent review: Check secret sanitization and Drizzle SQL escaping.
  - Verification: `bun run --cwd packages/schema test` passes, confirming conformance and field extraction.

## 2. Core Single-Turn Runner Fixes (TV1)

- [x] 2.1 Await asynchronous `seedRun` execution in `SingleTurnRunner.execute()` (`packages/core/src/runner/single-turn-runner.ts`) prior to acquiring the initial run claim.
  - Subagent task: Fix missing `await` on `seedRun` with `Promise.resolve` for dual sync/async compatibility.
  - Main Agent review: Ensure race condition against relational DB is eliminated without breaking `InMemoryRunStore`.
  - Verification: Unit test verifies that async `seedRun` completes before `claim` is invoked.
- [x] 2.2 Update `SingleTurnRunner` terminal transition logic to record terminal output, error details, token usage, cost, and latency into the store, updating `InMemoryRunStore` to mirror these fields based on OpenCode runner patterns.
  - Subagent task: Update runner terminal handling and `InMemoryRunStore` outcome retention.
  - Main Agent review: Verify that ground-truth labels and scorer data are never accepted or stored.
  - Verification: `bun run --cwd packages/core test` passes across all 575+ tests with new assertions for persisted outcome metrics.

## 3. CLI Workspace Dependencies & Runtime Lifecycle (TV6)

- [x] 3.1 Add `@harness/schema: "workspace:*"` dependency to `packages/cli/package.json` and export client cleanup utilities from `@harness/schema`.
  - Subagent task: Update `packages/cli/package.json` and workspace linkage.
  - Main Agent review: Verify Turborepo dependency graph and package isolation.
  - Verification: `bun install` links `@harness/schema` into `@harness/cli` cleanly with zero workspace dependency errors.
- [x] 3.2 Update `packages/cli/src/index.ts` to surface `ConfigValidationError` directly to `stderr` with exit code 1 when required configuration is missing or invalid, allowing mock fallback only when an explicit `--mock` flag is provided (adapting OpenCode CLI error reporting).
  - Subagent task: Replace silent catch block with structured error printing and exit code 1.
  - Main Agent review: Confirm actionable remediation hints are printed and credentials are not leaked.
  - Verification: `packages/cli/test/config.test.ts` and CLI error tests pass.
- [x] 3.3 Wire `packages/cli/src/index.ts` to instantiate `PostgresRunStore` when `DATABASE_URL` is configured, wrapping both `run` and `view` command execution in `try ... finally` blocks to ensure `store.close()` is invoked (adapting OpenCode CLI lifecycle management).
  - Subagent task: Wire store instantiation and teardown.
  - Main Agent review: Ensure no open sockets or dangling database connections remain after execution.
  - Verification: CLI tests confirm `PostgresRunStore` is selected when `config.databaseUrl` is provided and connections are closed upon exit.
- [x] 3.4 Enhance `packages/cli/src/commands/view.ts` to format and print the initial prompt, model response or error summary, token metrics, cost USD, latency, and chronological trajectory events (adapting OpenCode view command formatting).
  - Subagent task: Update view formatter to display run summary alongside event stream.
  - Main Agent review: Verify secret redaction on all displayed output lines.
  - Verification: `packages/cli/test/cli-view.test.ts` asserts on prompt, outcome summary, and event stream formatting.

## 4. End-to-End Integration & Verification (TV4 / TV6)

- [x] 4.1 Create an end-to-end integration test (`packages/cli/test/cli-e2e-persistence.test.ts`) that runs a single-turn prompt execution through the CLI with PostgreSQL persistence, simulates process restart by creating a new CLI view command instance, and verifies that the run and its trajectory events are completely recovered.
  - Subagent task: Write end-to-end integration test exercising the full prompt-to-view cycle.
  - Main Agent review: Verify test independence, determinism, and graceful skip when local DB is unavailable.
  - Verification: Test passes when PostgreSQL is active, or conditionally skips gracefully when PostgreSQL is unreachable.
- [x] 4.2 Run workspace-wide typechecking and test suite (`bun run typecheck && bun run test`) to prove zero regressions across `@harness/protocol`, `@harness/core`, `@harness/schema`, `@harness/llm`, and `@harness/cli`.
  - Main Agent review: Execute full test and typecheck pipeline across all workspaces and review git diff against project standards.
  - Verification: `bun turbo typecheck` and `bun turbo test` report all packages green.
