# Proposal

## Why
While individual components for Sprint 2 (CLI entrypoint, SingleTurnRunner, PostgreSQL persistence, and Real LLM Gateway) have been developed, the end-to-end pipeline is currently disconnected at the integration boundary. Specifically, `@harness/cli` lacks a dependency on `@harness/schema`, `cli:run` unconditionally falls back to an ephemeral `InMemoryRunStore`, `cli:view` queries an empty in-memory store that prevents inspecting past runs across process restarts, and `SingleTurnRunner` fails to await asynchronous `seedRun` invocations, leading to race conditions with PostgreSQL. This change bridges these integration gaps to fulfill Sprint 2's core acceptance criterion: executing a prompt against a model, persisting state and telemetry to PostgreSQL, and inspecting the completed run record after restarting the application.

## What Changes
- Add `@harness/schema: "workspace:*"` to `packages/cli/package.json` dependencies.
- Fix race condition in `SingleTurnRunner` (`packages/core/src/runner/single-turn-runner.ts`) by properly awaiting asynchronous `seedRun` executions.
- Enhance `SingleTurnRunner` and `PostgresRunStore` to record execution outcomes (prompt, model content, error details, token usage, cost USD, latency) into persistent run records and model attempt tables.
- Update `packages/cli/src/index.ts` to instantiate and manage the lifecycle of `PostgresRunStore` (including connection closure) whenever `DATABASE_URL` is provided.
- Stop silently swallowing configuration errors in CLI `index.ts`: fail fast with clear validation errors when required configuration is missing or malformed, preserving mock mode only when explicitly requested.
- Update `cli:view` output formatting to display run-level summary metrics (prompt, model response/error, tokens, cost, latency) in addition to the sequence of trajectory events.
- Add an integration test covering the complete cycle: executing a run, storing it in PostgreSQL via `PostgresRunStore`, restarting the runner context, and retrieving the run and its trajectory events by `runId`.

## Code Provenance & OpenCode Reuse
- **Prioritize OpenCode Reference Implementation**: All integration wiring, CLI store lifecycle handling, error normalization, and run inspection formatting MUST prioritize adapting verified patterns directly from the OpenCode upstream reference repository (`@ 3f393d78bf`, MIT License).
- **License & Attribution Headers**: All adapted code must carry the standard repository attribution header: `// Adapted from OpenCode <path> @ 3f393d78bf (MIT License). See NOTICE.`
- Avoid introducing novel, speculative abstractions where OpenCode already provides tested solutions.

## Execution Strategy: Spec-Driven Development (SDD) & Review Workflow
- **Spec-Driven Development (SDD)**: Execution is governed strictly by the OpenSpec schema and delta specifications (`specs/cli-run-entrypoint/spec.md`, `specs/single-turn-runner/spec.md`). Code changes must strictly fulfill the testable scenarios specified in the delta contracts.
- **Subagent Delegation & Primary Review Architecture**:
  - **1 Subagent Executor**: Implementation tasks will be delegated to a dedicated subagent to carry out the surgical code and test edits.
  - **Main Agent Reviewer & Integrator**: The primary agent remains in active orchestration, performing code reviews on all subagent output, verifying that research constraints and ground-truth isolation invariants are upheld, running the full verification suite (`typecheck` and `test`), and marking tasks complete only when reproducible evidence is confirmed.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `cli-run-entrypoint`: Update requirements to enforce PostgreSQL persistence when configured, require explicit configuration validation error surfacing rather than silent mock fallback, and expand `view` output to show run-level outcomes.
- `single-turn-runner`: Require asynchronous await of run registration before claim acquisition, and require persisting and querying complete run outcome attributes (prompt, result/error, tokens, cost, latency) through `RunStorePort` and query helpers.

## Impact
- **Dependencies**: Adds workspace dependency `@harness/schema` to `@harness/cli`.
- **Runtime**: CLI commands will connect to PostgreSQL via `drizzle-orm` and `postgres`, releasing connections cleanly upon command completion.
- **Breaking Changes**: None. Existing interfaces remain backward-compatible with in-memory test fakes.
- **Research Question Served**: RQ1 (Direct-model baseline measurement). Accurate persistence of prompts, model outputs, token usage, and latency across process boundaries is required to establish reproducible baseline evaluations against smart-contract findings.
- **Scope & Non-Goals**:
  - Scope: Single-turn runner integration, PostgreSQL persistence wiring, CLI error surfacing, and historical run inspection.
  - Non-goals: Multi-turn agent loop / Judge orchestration (deferred to later sprints), PoC sandbox execution, adversarial context compaction, Audit mode.
