## Why

The repository now has an approved blueprint, an empty ten-package layout and two TV1 design documents (`docs/tv1-agent-loop-design.md`, `docs/tv1-agent-loop-demo-spec.md`), but no executable code. Every other track (TV2 Context Engine, TV3 tools, TV4 SmartPoC pipeline, TV5 evaluation, TV6 persistence/UI) depends on TV1's loop interfaces, and `docs/02-roles.md` requires those interfaces to be frozen early because a later core change makes before/after measurements incomparable. This change turns the TV1 design into a Bun/TypeScript workspace, typed contracts in `@harness/protocol`, and a runnable, deterministic Agent Loop core in `@harness/core` that is proven against fakes, so the other tracks can plug in real parts without changing the loop.

It serves RQ1 (same model, direct versus Harness) and the cost and reproducibility outcomes: the loop is the component whose budgets, stop reasons, retry accounting and trajectory events make a run measurable and repeatable. It is preparation for those measurements, not an experimental result.

## What Changes

- Add the Bun workspace root: `package.json` (workspaces + dependency catalog), `bunfig.toml`, `turbo.json`, `tsconfig.json`, `.editorconfig`, and package manifests for `packages/protocol` and `packages/core` only. Configuration shape is adapted from the OpenCode repository.
- Add `@harness/protocol`: browser-safe types and zod schemas for the TV1 design contracts: `ContextEnginePort` and its item/policy/result types, `JudgeVerdict`, `ModelGateway` request/response, `StepOutcome`, stop conditions and precedence, the trajectory event vocabulary, and the ports the loop needs from other tracks (tool registry, security filter, run store, stage ports for ingestion, sanitizer and sandbox, clock, cancellation).
- Add `@harness/core` Agent Loop: `JudgeRunner` (5-stage lifecycle, fast-reject, compaction handling, cooperative cancellation, CAS terminal transitions), `JudgeStep` (the seven-gate single-attempt step), `RetryPolicy` (infrastructure error classification, capped exponential backoff with jitter, timeout cap), deterministic parallel tool dispatch, state hydration from persisted events, stop-reason precedence, and independent verdict validation with bounded schema repair.
- Add deterministic fakes used only for tests and demo: scripted model gateway, pass-through/threshold-based context engine, in-memory tool registry, in-memory run store with the same CAS and unique-sequence rules as the PostgreSQL design, fake stage adapters, injectable clock and random.
- Add a runnable demo and automated scenario suite: the four judge scenarios from the demo spec, the 7-pillar output bundle, stop-precedence matrix, worker-crash recovery, tool-failure recovery, retry classification, and a 100-run crash-free stress run.
- Reuse OpenCode code by adapting it with attribution (see design): `MAX_STEPS_PROMPT`, the retryable-message patterns and backoff structure of `session/retry.ts`, context-overflow patterns, the sortable identifier generator, and workspace configuration. No OpenCode code is copied verbatim into a package without a source-file attribution header and a `NOTICE` entry.
- **BREAKING (documentation only):** none to code. The TV1 verdict contract diverges from the currently normative `structured-judge-verdict` and `judge-run-orchestration` blueprint specs; the divergence is recorded as an approval gate in design, not silently resolved.

## Capabilities

### New Capabilities

- `monorepo-workspace-bootstrap`: Bun/TypeScript workspace root, package manifests for `protocol` and `core`, shared scripts, and the import-direction rule between them.
- `agent-loop-protocol-contracts`: the typed interfaces and schemas the loop exchanges with TV2, TV3, TV4, TV6 and the model gateway, with stable names and versioned digests.
- `judge-run-lifecycle`: `JudgeRunner` stage pipeline, fast-reject outcomes, run state machine with CAS, compaction handling, cooperative cancellation, and crash recovery by state hydration.
- `judge-step-execution`: `JudgeStep` seven-gate attempt, `StepOutcome`, max-step forcing, deterministic parallel tool dispatch, tool-error normalization, verdict validation and bounded repair, stop-reason precedence.
- `provider-retry-policy`: infrastructure error classification, retry limits, backoff with jitter, and per-attempt accounting.
- `agent-loop-demo-evidence`: deterministic fakes, runnable demo, scenario suite and 100-run crash-free evidence covering the seven output pillars.

### Modified Capabilities

None at spec level. The existing `openspec/specs/*` capabilities are blueprint-document requirements; this change adds implementation-level capabilities beside them. Conflicts with `structured-judge-verdict` (verification status, severity vocabulary, confidence type) and `judge-run-orchestration` (Judge execution authority) are listed as approval gates in `design.md` and must be reconciled by the team before archive.

## Impact

- New paths: root `package.json`, `bunfig.toml`, `turbo.json`, `tsconfig.json`, `.editorconfig`, `NOTICE`; `packages/protocol/**` and `packages/core/**` (replacing the `.gitkeep` markers); one `docs/` note recording the corrected OpenCode references.
- Dependencies: `zod`, `typescript`, `@types/bun`, `@tsconfig/bun`, `turbo`. No provider SDK, no database driver, no Docker client.
- Prerequisite: Bun is not installed in the current development environment; installing it is the first task.
- Interfaces consumed by other tracks: TV2 implements `ContextEnginePort`, TV3 implements the tool registry port, TV4 implements the stage ports and security filter, TV6 implements the run store port over PostgreSQL/Drizzle.
- Research controls are preserved: no code path reads ground truth or scorer data, every optional result-affecting behavior carries a flag whose resolved value is recorded in the run snapshot, and terminal states are immutable. Verification (PoC execution), ablation, trace view and offline demo remain full-project obligations; this change only provides loop hooks and fakes for them.
- Non-goals: real provider adapters (`packages/llm`), PostgreSQL/Drizzle persistence, Docker/Foundry execution, the real Context Engine, real source tools, HTTP server/client, UI, Audit mode, and evaluation scoring.
