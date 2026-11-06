## ADDED Requirements

### Requirement: Run state machine with compare-and-set
`JudgeRunner` SHALL transition a run only through legal edges of `accepted → queued → running → completed | failed | cancelled | budget_exhausted`. Every transition SHALL be a compare-and-set on expected state, state version and active claim token. Terminal states SHALL be immutable. A stale or rejected compare-and-set SHALL cause the runner to stop writing without raising an unhandled error.

#### Scenario: Stale worker cannot write
- **GIVEN** worker A claimed a run, its lease expired, and worker B claimed it
- **WHEN** worker A attempts to append an event or transition the run
- **THEN** the store rejects the write, the run state is unchanged, and worker A's runner returns without throwing

#### Scenario: Terminal state is immutable
- **GIVEN** a run in `completed`
- **WHEN** any transition is requested
- **THEN** the store rejects it and the run remains `completed`

### Requirement: Event ordering and append-before-act
The runner SHALL append events with a unique contiguous `(runId, sequence)` starting at 1. It SHALL persist `tool.requested` before executing the corresponding tool and `provider.attempted` after each provider attempt. The terminal state, final verdict (when present) and terminal event SHALL be committed together.

#### Scenario: Sequence has no gaps
- **GIVEN** any completed run
- **WHEN** its events are loaded in sequence order
- **THEN** sequences are exactly 1 through N with no duplicates

#### Scenario: Tool intent survives a crash
- **GIVEN** a worker that is stopped immediately after `tool.requested` is persisted and before the tool result
- **WHEN** a new worker hydrates the run
- **THEN** the pending call is visible in the history and is reported as interrupted rather than silently re-executed

### Requirement: Zero-token fast-reject stages
The runner SHALL execute ingestion, sanitization and sandbox stages through their ports before any model call. A reject from any of them SHALL commit a schema-valid `invalid`/`FAIL` verdict with the stage's reason code (`MISSING_POC`, `NON_FAITHFUL_OVERRIDE`, `EXECUTION_FAILED`), transition the run to `completed`, and make no model gateway call. The runner SHALL NOT repair or modify a submitter's PoC.

#### Scenario: Missing PoC
- **GIVEN** a candidate finding for which the ingestion port reports `missing_poc`
- **WHEN** the run executes
- **THEN** the run completes with reason `MISSING_POC`, the model gateway call count is 0, total tokens are 0, and the sanitizer and sandbox ports are not called

#### Scenario: Anti-cheat violation
- **GIVEN** a PoC for which the sanitizer reports `cheat_detected`
- **WHEN** the run executes
- **THEN** the run completes with reason `NON_FAITHFUL_OVERRIDE` and the sandbox port is not called

#### Scenario: Sandbox failure
- **GIVEN** a sandbox result with a non-zero exit code
- **WHEN** the run executes
- **THEN** the run completes with reason `EXECUTION_FAILED` and the model gateway call count is 0

### Requirement: Reasoning loop dispatch
After stage 3 passes, the runner SHALL shape the execution trace through the context engine, record the transformation, build the initial pinned context, and loop on `JudgeStep` outcomes: `completed` commits the verdict and `completed` state; `budget_exhausted` commits `budget_exhausted` with the stop reason; `failed` commits `failed`; `needs_compaction` runs compaction; `continue_turn` appends tool results to the context and increments the step. The runner SHALL record all exhausted limits it observed in telemetry and exactly one terminal reason.

#### Scenario: Multi-step run completes
- **GIVEN** a scripted model that requests two tool calls and then returns a valid verdict
- **WHEN** the run executes
- **THEN** the run is `completed`, three provider attempts are recorded, and the final verdict passes schema validation

### Requirement: Compaction handling
When the context engine returns `needs_compaction` and compaction is enabled and `compactionsCount < maxCompactions`, the runner SHALL send the summary prompt as an ordinary provider attempt with full accounting, call `record` with its usage, replace the summarized items with one `compaction_summary` item, append `context.compacted`, increment the count, and call `prepare` again. When compaction is disabled or exhausted and the context still does not fit, the runner SHALL commit `budget_exhausted` with reason `context_budget`.

#### Scenario: Compaction succeeds
- **GIVEN** an engine that requests compaction once and then reports `ready`
- **WHEN** the run reaches that step
- **THEN** a `context.compacted` event is persisted, the compaction attempt's tokens and cost are included in the run totals, and the run continues

#### Scenario: Compaction disabled
- **GIVEN** `enableLlmCompaction = false` and an engine that requests compaction
- **WHEN** the context cannot otherwise fit
- **THEN** the run ends `budget_exhausted` with reason `context_budget` and no summary attempt is made

### Requirement: Recovery by state hydration
When the runner starts on a run already in `running`, it SHALL rebuild the context item list from persisted events (`context.item_added`, `context.compacted`, `context.transformed`), restore token and cost totals, step index and compaction count, and continue from the next step. After hydration it SHALL verify that the digest of the next prepared context equals the digest recorded in the last `context.allocated` event and SHALL fail the run with a `persistence_failure` event if it does not.

#### Scenario: Worker killed at step 2
- **GIVEN** a run in which worker A completed steps 1 and 2 and was then stopped
- **WHEN** worker B claims the run and executes it
- **THEN** worker B starts at step 3 with the same context items worker A had, the final event sequence is contiguous, and no completed step is repeated

#### Scenario: Hydration mismatch
- **GIVEN** a persisted history whose recomputed context digest differs from the recorded digest
- **WHEN** the runner hydrates
- **THEN** the run is committed `failed` with a `persistence_failure` event and no model call is made

### Requirement: Cooperative cancellation
The runner SHALL poll the cancellation port before the ingestion/sandbox stages, before each context preparation and provider call, and before each tool dispatch. On observing a request it SHALL stop new provider and tool work, commit `cancelled` by compare-and-set, and preserve all prior events. If the run is already terminal it SHALL change nothing.

#### Scenario: Cancel before provider call
- **GIVEN** a cancellation requested while step 2 is preparing context
- **WHEN** the runner reaches the next boundary
- **THEN** no provider attempt is made for step 2, the run is `cancelled`, and earlier events remain

### Requirement: Runner never crashes the worker
`JudgeRunner.run` SHALL return a result for every input and SHALL NOT reject. An unexpected exception SHALL be converted to a terminal `failed` state with an event whose reason is `persistence_failure` or `worker_interrupted`; if even that write is rejected as stale, the runner SHALL return a result describing the stale outcome.

#### Scenario: Port throws unexpectedly
- **GIVEN** a tool registry fake whose `execute` throws a non-Error value
- **WHEN** the model requests that tool
- **THEN** the throw becomes a tool error result visible to the model and the run continues without the runner rejecting

#### Scenario: Store failure during commit
- **GIVEN** a run store that throws on the terminal write
- **WHEN** the verdict is ready
- **THEN** the runner resolves with a failure result instead of rejecting

### Requirement: Agent-visible inputs exclude ground truth
The runner SHALL accept only a candidate finding, a snapshot identifier and run configuration. Context items, events, tool results and verdicts SHALL NOT contain ground-truth labels, adjudication reports or scoring metadata, and the runner SHALL NOT read any path outside the snapshot port.

#### Scenario: Ground-truth field is not representable
- **GIVEN** the run input and context item types
- **WHEN** their fields are enumerated by a type-level test
- **THEN** no field named for a label, adjudication or score exists
