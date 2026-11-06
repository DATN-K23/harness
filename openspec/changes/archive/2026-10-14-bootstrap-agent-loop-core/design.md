## Context

See [proposal.md](proposal.md) for motivation. The normative inputs are `docs/tv1-agent-loop-design.md` (architecture, contracts, algorithms) and `docs/tv1-agent-loop-demo-spec.md` (seven output pillars, 100-run crash-free requirement). Those documents are followed as the contract. This design records how they are realized, where they had to be made precise, and where they conflict with other project documents.

Current state: `packages/*` contain only `.gitkeep`; Bun is not installed on the development machine; the blueprint fixes a TypeScript/Bun monorepo (ADR-008) with the dependency law `protocol` ← `schema` ← `llm` ← `core`. This change populates only `protocol` and `core`, so `core` depends on `protocol` alone and does not need `schema` (database models) or `llm` (provider adapters) yet.

Reference code is the OpenCode repository at `D:\DATN\opencode` (MIT, copyright 2025 opencode). Verified against that checkout:

| TV1 document cites | What exists | Consequence |
|---|---|---|
| `session/runner/step.ts` | No such file. `runner/` holds `index, llm, max-steps, model, publish-llm-event, to-llm-message`. The per-turn logic is `runTurnAttempt` in `runner/llm.ts`. | `JudgeStep` is designed from `runTurnAttempt`'s structure, not copied from a file. |
| `session/runner/retry.ts` | No such file. Retry lives in `packages/opencode/src/session/retry.ts` (V1, Effect-based) and `packages/core/src/util/retry.ts` (generic). | `RetryPolicy` adapts the V1 classification patterns into plain TypeScript. |
| `tool/runtime.ts` (tool error normalization) | Not found. Normalization is `ToolRegistry.settleWith` in V2 (`core/src/tool/registry.ts`) and `failToolCall` in V1. | Tool-failure-to-result conversion is written fresh using that behavior as the model. |
| `.opencode_reference/` | Gitignored and absent from this checkout. | The reference path is `D:\DATN\opencode`; a note records the correction. |
| Retry: `min(10000, 2000·2^(n−1)) + random(0,1000)` | OpenCode V1: `2000·2^(n−1)` plus 25% multiplicative jitter, capped at 30 s, up to 5 retries, honors `Retry-After`. | The TV1 formula governs. The difference is recorded so no one assumes OpenCode parity. |

## Goals / Non-Goals

**Goals:**

- A Bun/TypeScript workspace another team member can clone, install and test.
- Frozen, versioned contracts in `@harness/protocol` for every boundary the loop crosses.
- A deterministic Agent Loop in `@harness/core` whose behavior is fully specified by ports, so TV2/TV3/TV4/TV6 replace fakes without modifying the loop.
- Executable evidence for the TV1 definition of done: fast-reject at zero LLM tokens, crash recovery by hydration, stop precedence, tool-failure recovery, and 100 crash-free runs.

**Non-Goals:**

- Real provider adapter, PostgreSQL/Drizzle persistence, Docker/Foundry execution, Slither/AST parsing, the real Context Engine, real source tools, HTTP API, UI, Audit mode, scoring.
- Resolving the blueprint conflicts below. They are surfaced as approval gates.
- Effect-based implementation (see D2).

## Decisions

### D1. Contract-first, ports at every boundary

`@harness/protocol` holds only types, zod schemas and pure helpers (no `node:`/`bun:` imports, so it stays browser-safe as `module-layout.md` requires). `@harness/core` holds all behavior. Every cross-track dependency is a port:

| Port | Owner of the real adapter | Fake in this change |
|---|---|---|
| `ContextEnginePort` (`prepare`, `record`, `shapeToolResult`) | TV2 | scripted and threshold-based fakes |
| `ModelGatewayPort` (`executeAttempt`, one attempt, never throws for provider errors) | TV1 + `packages/llm` | scripted gateway |
| `ToolRegistryPort` (`definitions`, `execute`) | TV3 | in-memory read-only tools |
| `SecurityFilterPort` (`filterSecrets`) | TV4 | regex redactor |
| `IngestionPort`, `SanitizerPort`, `SandboxPort` (stages 1-3, state probe) | TV4 | scripted results |
| `SourceSnapshotPort` (`readLines`, read-only; used for evidence digests) | TV3/TV6 | in-memory files |
| `RunStorePort` (claim, append event, CAS transition, load events) | TV6 | in-memory store |
| `ClockPort`, `RandomPort`, `SleepPort`, `CancellationPort` | TV1 | fake clock, seeded random |

*Alternative considered:* implement stages 1-3 inside `core` per the design document's file list (`judge/report-ingestion.ts`, `verification/sanitizer.ts`, `verification/docker-sandbox.ts`). Rejected for this change: those files are TV4 deliverables, would pull Docker and Slither into the loop's test surface, and sit on the unresolved execution-authority gate (G2). The loop only needs their results.

### D2. Plain TypeScript with zod, not Effect

OpenCode V2 is written in Effect (`Effect.gen`, `Layer`, `Stream`, `FiberSet`). Adopting it would make the other five tracks learn Effect before they can read the loop, and the TV1 document already specifies zod schemas and `Promise.allSettled`. The loop uses `async/await`, `AbortSignal`, and injected ports. OpenCode logic is therefore ported, not imported. Cost: no structured interruption; cancellation is cooperative at three declared boundaries (D9), which is what the design document specifies anyway. Style follows OpenCode's `AGENTS.md` where it does not conflict (no import aliasing, no star imports, early returns, no `any`).

### D3. Reuse of OpenCode code: adapt with attribution

The request is to prefer reusing OpenCode code. ADR-008 states that no OpenCode source is copied. These are reconciled as follows, pending gate G3:

| Reused | Source | Form |
|---|---|---|
| Workspace configuration (`bunfig.toml`, `turbo.json`, `tsconfig.json`, `.editorconfig`, catalog pattern) | repo root | adapted, trimmed to two packages |
| `MAX_STEPS_PROMPT` | `core/src/session/runner/max-steps.ts` | adapted wording for Judge (no edit/user-input language) |
| Retryable-message patterns and backoff structure | `opencode/src/session/retry.ts` | ported to plain TS; formula replaced by the TV1 formula |
| Context-overflow message patterns | `llm/src/provider-error.ts` | copied pattern list, used to classify provider errors that must not be retried |
| Sortable ID generator | `schema/src/identifier.ts` | adapted with injectable clock and random for determinism |
| Behavioral patterns (not code): record the tool call before running it, one provider call per turn, tool failure becomes a model-visible result, step-limit forcing | `core/src/session/runner/llm.ts` | reimplemented |

Every adapted file carries a header naming the OpenCode source path and commit (`3f393d78bf`) and the MIT notice; `NOTICE` at the repository root lists them. Where OpenCode behavior is deliberately not followed it is listed: V2 runs tool calls eagerly with unbounded concurrency and writes results in completion order; the Judge loop dispatches deterministically and writes results in call-index order (D7).

### D4. Run lifecycle and events

States and terminal reasons use the blueprint vocabulary: `accepted → queued → running → completed | failed | cancelled | budget_exhausted`, terminal states immutable, every transition is a compare-and-set on `(expectedState, expectedStateVersion, claimToken)`. A zero-row result means stale, and the caller stops without writing.

Events are append-only with a unique contiguous `(runId, sequence)`. The vocabulary is the blueprint's, extended with the names the TV1 documents already use: `context.item_added`, `context.compacted`, `stage.started`, `stage.finished`, `step.started`. Each event stores `payloadDigest` (SHA-256 over canonical JSON with sorted keys). The tool call is persisted (`tool.requested`) before it executes, so a crash never loses the intent.

The run snapshot recorded in `run.started` holds the resolved flags, `ContextPolicy`, `RetryConfig`, `BudgetLimits`, system prompt digest and verdict schema digest, and the digest of that snapshot.

### D5. Runner and step split

`JudgeRunner.run(claim)` owns the lifecycle and every state transition: stages 1-3 (fast-reject), stage 4 initialization or hydration, the reasoning loop, compaction handling, and terminal commit. `JudgeStep.execute(input)` is one atomic attempt through the seven gates of the design document and returns a `StepOutcome`; it appends events through an `EventSink` but never changes run state. The runner never throws: any unexpected exception becomes a `failed` terminal with reason `persistence_failure` or `worker_interrupted`, recorded as an event (the crash-free guarantee).

### D6. Stop conditions

`evaluateStop` takes the run state and `BudgetLimits` and returns the highest-precedence exhausted reason plus the list of all observed exhausted limits (telemetry). Precedence follows the design document and the blueprint: wall clock, cost, total tokens, max steps, context budget, no progress. It runs before each provider attempt and after each tool boundary. Name mapping to blueprint terminal reasons: `wall_clock_timeout→wall_clock`, `cost_budget_exhausted→cost_budget`, `total_tokens_exhausted→total_tokens`, `max_steps_exceeded→max_steps`, `context_budget_exhausted→context_budget`, `no_progress_detected→no_progress`.

Max-step forcing: steps are 1-indexed. For every step with `stepIndex ≥ maxSteps − 1` the gateway receives `toolsDisabled: true` and the forcing prompt is appended. The design document calls this the penultimate step; applying it to the penultimate and last step gives the model two chances to emit a verdict before `max_steps_exceeded`. A tool call returned while tools are disabled is converted to an error result and does not execute.

No-progress: `noProgressMaxRepeats` consecutive tool calls with identical tool name and canonical-JSON arguments trigger `no_progress_detected`.

Wall clock is measured by the injected clock and includes retry backoff. The deadline is checked at safe boundaries; an `AbortSignal` derived from the deadline and the cancel flag is passed to ports as best effort. An aborted in-flight attempt is recorded as outcome-unknown and is never silently repeated.

### D7. Deterministic parallel tool dispatch

Calls from one model response are assigned `callIndex` in response order; `tool.requested` events are persisted in that order; calls run under `Promise.allSettled`; results are re-sorted by `callIndex` before being turned into context items and events. A rejected promise becomes an error `ToolExecutionResult` (message states what failed, the relevant arguments and a suggested next action). Result content passes the security filter first and `shapeToolResult` second (TV2 contract: filter before truncate). `enableParallelToolDispatch=false` runs the same calls sequentially in index order and must produce identical events and digests.

### D8. Context handling

Context is a `ContextItem[]` list, never a joined string. The loop passes `{items, policy, modelLimits, budget}` to `prepare`; it sends exactly `preparedItems` (it never edits them); it persists each returned transformation as `context.transformed`. `needs_compaction` follows the design document's algorithm: bounded by `maxCompactions`, the summary request is a normal provider attempt with full accounting and `record()`, the old items are replaced by one `compaction_summary` item (`context.compacted`), then `prepare` runs again. If compaction is exhausted and the context still does not fit, the run ends `budget_exhausted/context_budget`. `stop` from `prepare` ends the run with the returned reason. TV1 is the execution authority; TV2 only signals.

Hydration rebuilds the raw `ContextItem[]` from `context.item_added` and `context.compacted` events and re-derives the transformation records from `context.transformed`. It is verified rather than trusted: after hydration the next `prepare()` output digest must equal the `contentDigest` recorded in the last `context.allocated` event, otherwise the run fails with `persistence_failure` and a clear event. Item order follows the seven-layer cache order from the design document.

### D9. Cancellation

`CancellationPort.isRequested(runId)` is polled at three boundaries: before stage 1 and before the sandbox stage; before `prepare`/provider call; before tool dispatch. Cancellation commits `cancelled` by CAS, keeps all prior events, and never starts new provider or tool work. A terminal CAS that already won is left untouched.

### D10. Retry policy

`RetryPolicy` classifies a gateway error into `retryable` (transport timeout or disconnect, HTTP 429, 500, 503), `permanent` (401, 400, unsupported feature), or `context_overflow` (never retried; matched with the adapted overflow patterns and handled as `budget_exhausted/context_budget`). Limits: 5 retries in general and 3 for timeouts (`MAX_TIMEOUT_RETRIES`). Delay for retry `a ≥ 1` is `min(10000, 2000·2^(a−1)) + random(0, 1000)` ms, using the injected random and sleep. Every attempt, including failed ones, produces a `provider.attempted` event with `attemptIndex`, `retryDecision` and `backoffMs`, and counts toward token, cost and wall-clock budgets. `Retry-After` is recorded but not used to extend the wait. `enableInfraRetry=false` makes the first provider error terminal.

### D11. Verdict validation and repair

The model's final text is parsed and validated by `JudgeVerdictSchema` plus cross-field rules: `valid` requires `verificationStatus=PASS`, severity in `CRITICAL|HIGH|MEDIUM` and at least one evidence item; `invalid` requires `FAIL`; `UNVERIFIED` is accepted by the schema but never produced by this change. The runner independently resolves every evidence span through `SourceSnapshotPort`: path must be a relative snapshot path, lines must exist, and the runner computes the SHA-256 of the span (the model never supplies hashes). Failures emit `verdict.validation_failed` with safe validation paths and, when `enableSchemaRepair` is on and attempts remain (max 2), the error is appended as a user item for the next step; exhaustion ends `failed/schema_repair_exhausted`.

The demo specification requires fields the design document's schema does not have (vulnerability class and standard identifier, evidence line contents, report sections for root cause, attack path, impact, remediation). They are added as optional fields (`classification`, `report`, and computed `snippet`/`contentDigest` on evidence) so the document's required shape is unchanged (gate G5).

### D12. Fast-reject and stage 4 entry

Stage ports return a tagged result. Any reject yields a schema-valid verdict with the fixed reason (`MISSING_POC`, `NON_FAITHFUL_OVERRIDE`, `EXECUTION_FAILED`), commits `completed`, and makes zero `ModelGatewayPort` calls; the test asserts the gateway call count and token totals are zero. Stage 4 starts by shaping the execution trace through `shapeToolResult` (recorded as `context.transformed`), then builds the initial pinned items (system prompt, tool descriptions, candidate finding, submitter PoC, BCE slices, trace). Tier selection comes from `SanitizerPort`'s `hasSubmitterAssertions`. For Tier 2 the loop exposes one loop-owned tool, `run_state_probe`, which calls `SanitizerPort.injectStateProbes` then `SandboxPort.runStateProbe` (bounded by `maxProbeRuns`, default 2); it is not a model attempt and not part of TV3's registry.

### D13. Flags (working rule R1)

Result-affecting behavior has a flag, a telemetry value, a run-snapshot value and enabled/disabled tests. The six TV2 flags are passed through unchanged into `ContextPolicy.flags`. TV1 adds `enableSchemaRepair`, `enableMaxStepsForcing`, `enableNoProgressDetection`, `enableInfraRetry`, and `enableParallelToolDispatch`. Safety boundaries (source-only reads, stale-claim rejection, terminal immutability) have no flag.

### D14. Testing approach

`bun test` runs from `packages/core` (and `packages/protocol`), mirroring OpenCode's rule against running tests at the root. Fakes are small classes implementing the ports; no mocking library or `globalThis` patching. Time, randomness and sleeping are injected, so retry and wall-clock tests are instant and exact. The stress test uses seeded scenario generation and asserts invariants per run (single terminal, contiguous sequence, no unhandled rejection, token total equals the sum of attempts).

## Approval gates (decisions that are the team's, not this change's)

| # | Conflict | Treatment in this change | Needed before archive |
|---|---|---|---|
| G1 | TV1 `JudgeVerdict` (`PASS/FAIL`, upper-case severity, `HIGH/MEDIUM/LOW` confidence, reason codes) versus `structured-judge-verdict` spec (`verification_status` fixed `unverified`, lower-case severity with `none`, numeric confidence 0-1). | Protocol follows the TV1 document. No existing spec is modified. | Team decision on the canonical verdict, then a spec update or a mapping layer. |
| G2 | The TV1/TV4 SmartPoC pipeline executes PoCs inside the Judge run; blueprint invariant 8, `judge-run-orchestration` and the roadmap say Judge has no execution authority and PoC execution belongs to a separate `VerificationRunner`. | Stages 1-3 are ports with fakes only; no Docker, shell or process code exists in this change. | Owner decision on where execution authority lives and whether stages 1-3 sit inside the Judge run. |
| G3 | ADR-008 states no OpenCode source is copied; this request prefers reuse. | Adapt with attribution, MIT notice, and a `NOTICE` file. | ADR-008 amendment approved by the project owner. |
| G4 | ADR-002 and the blueprint disable project retry for the primary arms; TV1 specifies infrastructure retry. | Retry is implemented, flagged, and its config is part of the run snapshot so both arms can use the same setting. | Decision whether the primary RQ1 arms enable retry. |
| G5 | Demo-spec fields missing from the document schema (D11). | Additive optional fields. | Confirmation from TV4/TV5/TV6 as schema consumers. |
| G6 | Event vocabulary additions (`context.item_added`, `context.compacted`, `stage.*`, `step.started`). | Defined in protocol. | `blueprint/vocabulary.md` update. |

## Risks / Trade-offs

- [Contracts frozen on documents that disagree with the blueprint] → Gates G1-G6 are explicit; protocol types live in separate files so a verdict mapping can be added without touching the loop.
- [Fakes pass while real adapters misbehave] → Ports have conformance tests written against the contract (e.g. a store must reject a stale claim, a gateway must return rather than throw); each owning track re-runs them on its adapter.
- [Hydration trusts events that were written incorrectly] → The digest check after hydration fails closed.
- [Deterministic ordering costs latency] → Results are ordered after all calls settle; wall-clock difference is accepted for reproducibility.
- [Plain TypeScript loses Effect's interruption guarantees] → Cooperative boundaries plus a never-throws top-level wrapper; stress test covers cancellation and crash paths.
- [Step-forcing interpretation differs from the author's intent] → Documented in D6 and listed as an open question; it is a one-line policy constant.
- [Bun not installed] → First task; no source depends on Bun-only APIs other than `bun:test` and the digest helper, which uses `node:crypto` available in Bun.
- [Over-reuse of OpenCode drags Effect or SQLite assumptions in] → Only logic that is free of Effect, SQLite and AI SDK types is adapted.

## Migration Plan

Additive only: new root configuration files and two populated packages; the `.gitkeep` markers in `packages/protocol` and `packages/core` are removed when real files land. Rollback is reverting the commit; no data or external system changes. Follow-up changes: `llm` provider adapter (AI SDK with `maxRetries: 0`, non-streaming), Drizzle/PostgreSQL `RunStorePort`, real Context Engine, real tools, TV4 stage adapters.

## Open Questions

1. Should `Retry-After` extend the wait beyond the 10 s cap, as OpenCode does? Default here: no (G4 dependent).
2. Should 502/504 be retryable? OpenCode treats all 5xx as retryable; the TV1 document names 500 and 503. Default here: `retryableStatuses = [429, 500, 503]`, configurable.
3. Is the max-step forcing window (last two steps) what TV1 intended by "penultimate step"?
4. Default numeric limits (`maxSteps`, wall clock, token and cost ceilings, `maxProbeRuns`) are placeholders for the demo; real values depend on TV5's budget plan and TV2's `W_exp`.
5. Where does the Judge system prompt live and who versions it (TV3 asks tool descriptions in `.txt` files)? A minimal `judge-system.v1.txt` is included with a digest.
