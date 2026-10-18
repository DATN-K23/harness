# Design

## Context

See `proposal.md` for motivation. The current state that shapes the approach:

- `SingleTurnRunner` (`packages/core/src/runner/single-turn-runner.ts`) performs exactly
  one gateway call, ignores `response.toolCalls`, and hardcodes `stepIndex: 1,
  attemptIndex: 1`. It is the RQ1 direct-model baseline (X) and must stay unchanged.
- `JudgeRunner`/`JudgeStep` already implement a model→tool→model loop, but it is coupled
  to adjudication: verdict synthesis, schema repair, compaction, no-progress detection,
  and security filtering (see the `judge-step-execution` spec).
- `ModelAttemptRequest` (`packages/protocol/src/model-gateway.ts`) has no field for tool
  definitions; tool schemas reach the model only as `tool_description` context items.
- `packages/llm/src/gateway/message-converter.ts` is already adapted from OpenCode and
  maps `tool_request`→assistant `tool_calls` and `tool_result`→`role:"tool"`, but only
  for the happy path.
- `ToolRegistry` already implements the read-only `ToolRegistryPort` with `read_file`,
  `grep`, `glob`, `list_dir` over `SourceSnapshotPort`; `SnapshotManager`/`DiskSourceSnapshot`
  provide immutable disk-backed snapshots (Track A).
- `recordModelAttempt` is a duck-typed optional store hook called only by
  `SingleTurnRunner`; `model_attempts` has no per-turn identity, and `runs` has no
  snapshot link.
- `ParallelToolDispatcher` (`packages/core/src/tool/dispatcher.ts`), `history-hydrator.ts`
  (`hydrateHistory`/`interruptedToolItems`), and `stop-conditions.ts`
  (`evaluateStop`/`observeToolCalls`) already exist and are tested; the Judge path already
  uses them, so the multi-turn runner can reuse them rather than re-implement.
- Constraints: append-only events with CAS/lease (`RunStorePort`); zero internal gateway
  retries; the ground-truth isolation and secret-redaction controls; Rule R1 (every
  optional result-affecting behavior gets a flag, telemetry, run-snapshot value, and
  enabled/disabled tests); and the OpenCode attribution requirement (ADR-008).

## Goals / Non-Goals

**Goals:**
- Add a bounded multi-turn loop that reuses existing ports and core components and leaves
  `SingleTurnRunner` and `JudgeRunner` behaviorally untouched.
- Make the protocol and persistence extensions additive, so the baseline and Judge paths
  keep working unchanged.
- Port only the small, testable OpenCode logic core still lacks (loop stop conditions,
  truncation markers, output budget math) into plain TypeScript with attribution, and
  reuse the core dispatcher/hydrator for the rest.
- Leave a cheap, single insertion point for a future interactive mode without building it.

**Non-Goals:**
- Extracting a shared context engine, compaction, or long-term memory (next stage).
- Refactoring `JudgeStep` into a generic loop or unifying the two loops now.
- Changing CLI commands or provider request/response conversion (Track D).
- Implementing interactive/pair mode, approval gates, or a paused/waiting run state.

## Decisions

### Decision 1: New `MultiTurnRunner` beside `SingleTurnRunner`, not a Judge mode branch
- **Choice**: add a separate runner in `packages/core/src/runner/` that owns its own
  bounded loop and reuses the existing `ToolRegistryPort`, `ModelGatewayPort`, context
  items, and `RunStorePort`.
- **Rationale**: `JudgeStep`'s seven gates are adjudication-specific; forcing the chain
  through them would require fabricating findings and context policy, and relaxing them
  into flags would create config bloat. The `judge-run-orchestration` spec already
  requires future modes to use "declared capability/port seams rather than mode branches
  spread across Judge code", which this follows.
- **Consequence to confirm**: `judge-step-execution` states that only the Judge
  orchestrator owns continuation. This change adds a second, explicitly-declared
  orchestrator; each run is still served by exactly one orchestrator, and no hidden loop
  is introduced. This reading needs team acknowledgement (see Open Questions / gates).
- **Alternatives considered**: (a) add a single/multi-turn mode flag to `JudgeRunner` —
  rejected (branch complexity, two lifecycles); (b) generalize `JudgeStep` — rejected
  (signature-breaking risk to a passing suite, larger scope than the sprint).

### Decision 2: Tool definitions and the tool-call cap travel in `ModelAttemptRequest`
- **Choice**: add additive fields so a request can carry the allowed tool definitions and
  a per-run tool-call cap; keep them out of prompt text.
- **Rationale**: contract tests and `ScriptedModelGateway` must observe the tool set, and
  Track D cannot map prose `tool_description` items to a provider's native `tools` array.
- **Alternatives considered**: a gateway-only field (invisible to protocol tests);
  keeping `tool_description` items (status quo, blocks real tool calling).

### Decision 3: Extend existing tables; keep tool call/result data in the event stream
- **Choice**: add `runs.snapshot_id`, and per-turn identity on `model_attempts`
  (`step_index`, `attempt_purpose`, unique by `(run_id, step_index, attempt_purpose,
  attempt_number)`). Tool requests/results stay in ordered trajectory events
  (`tool.requested`/`tool.completed`/`tool.failed`, keyed by `callId`/`callIndex`).
- **Rationale**: events are already the append-only source of truth and are replayable;
  a separate `tool_calls` table would duplicate that and add contract-test burden. The
  `trajectory-persistence` rule that each table has exactly one capability owner is kept
  by editing that capability's own schema requirement.
- **Alternatives considered**: a new `tool_calls` table (duplicate truth); an
  OpenCode-style part-per-row store — rejected, because OpenCode's model exists for
  interactive sessions and this repository deliberately diverges from it
  (`single-turn-runner/design.md`, "PostgreSQL/CAS authority instead of local SQLite").

### Decision 4: Reuse the existing attempt-recording hook, made idempotent per attempt
- **Choice**: the multi-turn runner records each attempt through the same optional store
  hook `SingleTurnRunner` already uses, keyed by the per-turn identity
  `(runId, stepIndex, attemptPurpose, attemptNumber)`, where `attemptPurpose` is one of the
  protocol's `AttemptPurposes` (`reasoning` | `compaction`). `PostgresRunStore.recordModelAttempt`
  changes from a plain `insert` to an idempotent upsert
  (`ON CONFLICT (run_id, step_index, attempt_purpose, attempt_number) DO NOTHING`), so a
  retry or worker redelivery cannot create a duplicate row. Each turn also emits the
  standard `provider.attempted` event and, on success, `model.responded`, so history reads
  one model turn at a time.
- **Rationale**: the "attempts" addition is already merged and must be reused, not rebuilt;
  the database conflict key is what makes "redelivery does not duplicate an attempt" true,
  and the per-turn event emission is what makes "each model turn" readable.
- **Alternatives considered**: promoting `recordModelAttempt` into `RunStorePort` as a
  first-class method — larger contract change and new conformance tests; deferred.
  Detecting duplicates in the application layer instead of a database constraint — racy
  across workers.
- **Known gap**: the Judge path records attempts only as `provider.attempted` events and
  does not write `model_attempts`. This change does not retrofit Judge; the gap is
  recorded as a follow-up rather than silently fixed.

### Decision 5: Limits — reuse step/wall-clock reasons, add a tool-call reason
- **Choice**: model turns reuse `max_steps_exceeded`; add `max_tool_calls_exceeded`
  (`max_tool_calls` terminal reason); wall clock reuses `wall_clock_timeout`. `maxToolCalls`
  is an OPTIONAL `BudgetLimits` field with a runner-side default; when absent the default
  cap applies. Output-token truncation is a request parameter plus a recorded
  `finishReason` and is not, by itself, a budget stop.
- **Rationale**: a distinct tool-call reason is what the sprint's "dừng với lý do rõ ràng"
  requires; overloading `max_steps` would make history unreadable. Optional keeps every
  already-frozen `run.started` snapshot parseable and its digest unchanged, because
  `canonicalize` skips `undefined` values; a required field would break existing fixtures
  and force an experiment-drift review, since `RunConfigSnapshotSchema.budget` is required
  and digested.
- **Consequences**:
  - `blueprint/vocabulary.md` needs the new `max_tool_calls` budget reason (a documentation
    edit coordinated with the team).
  - `packages/core/src/runner/stop-conditions.ts` must extend `StopState` with a tool-call
    counter and add the new key to the `Record<StopReason, boolean>` in `evaluateStop`;
    without it a new `StopReason` fails typecheck.
  - The default is applied where the multi-turn run config is built and its resolved value
    is recorded in the run snapshot, so the digest still captures the effective cap.
- **Alternatives considered**: required `maxToolCalls` plus a `RunConfigSnapshotSchema`
  version bump and re-frozen fixtures (heavier, triggers experiment-drift review for no
  behavior gain); reusing `max_steps_exceeded` for tool-call exhaustion (rejected:
  unreadable history).

### Decision 6: Reuse existing core components first; port only what core lacks
- **Reuse already in `@harness/core` (do not rewrite or re-port)**:
  - `ParallelToolDispatcher` (`packages/core/src/tool/dispatcher.ts`; the
    `step/parallel-tool-dispatcher.ts` path is a compatibility re-export shim) already
    assigns `callIndex` in response order, persists `tool.requested` before anything
    executes, runs calls under `Promise.allSettled` (or sequentially when parallel dispatch
    is off), binds each result to its `callId`, settles results in `callIndex` order,
    normalizes `unknown_tool`/`invalid_arguments`/`denied`/`missing_file`/`thrown`/
    `tool_error`/`malformed` into non-throwing error results with a `Suggested next step:`,
    and persists `security.blocked`. It exposes an `onResult` hook for the caller to persist
    `tool.completed`/`tool.failed` after the security filter.
  - `history-hydrator.ts` already provides the interrupted-tool behavior: `hydrateHistory`
    yields `pendingToolCalls`, and `interruptedToolItems` emits the missing `tool_request`
    items plus one error `tool_result` per interrupted call (`InterruptedToolMessage`), so a
    dangling tool call still gets a matching result. This is exactly the edge case an earlier
    draft planned to port from OpenCode; it is already present and tested.
  - `stop-conditions.ts` already provides `evaluateStop`, `observeToolCalls`, `isForcedStep`,
    and `StopPrecedence` with telemetry for observed-but-not-selected limits.
- **Port from OpenCode only what core lacks (plain TS, attribution headers + root `NOTICE`)**:
  - Loop continuation/stop conditions from `packages/opencode/src/session/prompt.ts`
    (`runLoop`): keep looping while the response has tool calls; stop when the assistant has
    no pending tool calls and a non-`tool-calls` finish reason.
  - Output-truncation markers/limits from `packages/opencode/src/tool/truncate.ts` and
    `tool/read.ts` (≈2000 lines / 50 KB read, ≈100 grep/glob results) to bound per-turn tool
    output and the initial source-info bound.
  - Output-budget math from `packages/opencode/src/session/overflow.ts` to size the initial
    source-info bound.
- **Do not port**: the Effect-based `processor.ts`/`session/tools.ts`/`provider/transform.ts`
  and the AI-SDK tool registry. Their control flow informs the design, but their code is
  entangled with interactive UI, plugins, and per-provider quirks the harness does not need.
- **Rationale**: the sprint directs the team to reuse "phần code phù hợp đã có"; the
  dispatcher and hydrator are already adapted and tested, so a second implementation would
  duplicate behavior and risk divergence. The multi-turn runner supplies the outer loop and
  reuses them, the same way `JudgeStep` does.
- **Alternatives considered**: a fresh dispatcher/loop (duplicates tested behavior and adds
  a divergent tool-error contract); re-porting the message edge cases (already in core).

### Decision 7: Defer interactive mode but fix its insertion point now
- **Choice**: keep the loop headless, but define the tool-dispatch decision as a single
  call site behind a port (`ToolApprovalPort`) with a headless auto-allow default. Do not
  implement any waiting/approval behavior in this change.
- **Rationale**: the loop-refactor cost of retrofitting a gate later is small but real,
  while the expensive parts of interactive mode (a paused/waiting run state, lease
  renewal, decision API, desktop UI) are independent and belong to a later change that
  must also add a config flag, telemetry, and run-snapshot value per Rule R1.
- **Result validity**: interactive runs are not reproducible; they must never be the RQ1
  baseline (X) or harness (Y) measurement and are out of scope here.

## Risks / Trade-offs

- [A second loop diverges from the Judge loop] → keep the runner small; extract only
  trivially-shared helpers (e.g. a tool-branch helper) and revisit unification in a later
  change rather than pre-abstracting.
- [The multi-turn runner re-implements tool dispatch or the interrupted-tool path] →
  Decision 6 requires reusing `ParallelToolDispatcher` and `history-hydrator`; the runner
  supplies only the outer loop and the `onResult` hook.
- [Adding `maxToolCalls` breaks existing snapshots, fixtures, or code] → Decision 5 makes
  it optional with a runner default (old snapshots parse and keep their digest), and task
  2.3 extends `StopState`/`evaluateStop` so the new `StopReason` compiles before anything
  consumes it.
- [Program-level: the sprint's "chạy được và xem lại sau restart" needs Track D] → this
  change completes the core (Track C) only; the CLI and real gateway conversion require a
  Track D change that does not exist yet. Tasks 6.2/6.3 are gated on it and must not be
  marked complete until that track lands; the gap is stated, not hidden.
- [A tool field could carry non-read-only tools] → validate requests refuse write/shell/
  network definitions, and the registry advertises only read-only tools.
- [Uniqueness migration on existing `model_attempts` rows] → backfill `step_index`/
  `attempt_purpose` defaults before adding the constraint; rollback drops the new columns.
- [Judge attempts remain absent from `model_attempts`] → recorded as an explicit
  follow-up; events still hold the attempt telemetry.
- [Tool-call cap vs redelivery] → the cap counts dispatches; idempotency by attempt
  identity prevents re-dispatch on redelivery.
- [Optional behaviors without Rule R1 artifacts] → the flag, telemetry, run-snapshot
  value, and enabled/disabled tests land in the same task as each optional behavior.
- [Result validity] → the multi-turn run is a harness arm (Y); the baseline arm (X) is
  unchanged, so the measured delta stays interpretable.

## Migration Plan

- Additive SQL migration: add `runs.snapshot_id` (nullable); add `model_attempts.step_index`
  and `model_attempts.attempt_purpose` (backfilled), then the uniqueness constraint.
  Reproducible via `bun run --cwd packages/schema db:migrate`; rollback drops the added
  columns/constraint.
- Protocol changes are additive optional Zod fields; no existing contract breaks, and the
  `runStoreContractTests` suite must keep passing.

## Open Questions

- Which real provider/model with tool calling is used for the integration run, and the
  concrete budget numbers (turns, tool calls, wall clock, output tokens) — owned by the
  team's provider decision (Track D); it does not change the specs or approach.
- Whether `recordModelAttempt` should later become a first-class `RunStorePort` method —
  deferrable without changing this plan.

## Team decisions required before implementation (approval gate)

Per the sprint's "cả nhóm thống nhất" section, the decisions have been confirmed and recorded as follows:

1. **Track C ↔ TV owner mapping & shared edit ownership**:
   - Track C owner: **TV1** (owns `@harness/core` runner, run execution, and trajectory persistence contracts).
   - Track C is authorized to edit shared protocol contracts (`@harness/protocol`) and the Drizzle persistence schema/migrations (`@harness/schema`).
   - Track D (CLI & Gateway) is owned by **TV6/TV4**; Track A (Snapshot) and Track B (Tools) are already archived.
2. **Linkage identifier scheme**:
   - `runId`: prefix `run_` (monotonic/sortable, e.g. `createIdGenerator("run_")`).
   - `snapshotId`: opaque text string (e.g. `snap_...`), stored in `runs.snapshot_id`, carried in request/event boundaries without host paths.
   - `attemptIdentifier`: composite tuple `(run_id, step_index, attempt_purpose, attempt_number)` where `step_index` is 1-indexed, `attempt_purpose` in `["reasoning", "compaction"]`, and `attempt_number` is 1-indexed per step/purpose.
   - `toolCallId`: generated by the model (e.g. `call_...`), paired with sequential 0-indexed `callIndex` per turn, matching `ContextItem.toolMeta.callId`.
3. **Second orchestrator confirmation**:
   - `MultiTurnRunner` is accepted as the second explicitly declared orchestrator alongside `SingleTurnRunner` (baseline) and `JudgeRunner` (adjudication). Each run is dispatched through exactly one orchestrator.
4. **Integration references**:
   - Provider/model: OpenAI-compatible tool-calling model (e.g. `gpt-4o-mini` or deterministic scripted gateway).
   - Default limits: `maxSteps: 10`, `maxToolCalls: 20`, `wallClockTimeoutMs: 60000`, `maxOutputTokens: 2048`.
   - Test repository: `test/fixtures/solidity-small` or snapshot mock fixture.
