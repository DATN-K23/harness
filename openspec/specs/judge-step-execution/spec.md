# judge-step-execution Specification

## Purpose

Defines the JudgeStep seven-gate execution sequence, step-limit forcing, verdict validation, bounded repair, deterministic parallel tool dispatch, tool-failure normalization, stop-reason precedence, and state probe tiering.

## Requirements

### Requirement: Seven-gate single-attempt step
`JudgeStep.execute` SHALL perform, in order: (1) context preflight through `prepare`, (2) max-step warning handling, (3) one model call through the retry policy, (4) token recording through `record`, (5) verdict branch, (6) tool branch, (7) security filtering followed by context shaping of tool results. It SHALL return a `StepOutcome` and SHALL NOT change run state; it SHALL append events through the event sink only. A step SHALL send to the gateway exactly the items returned in `preparedItems` without modifying them.

#### Scenario: Gate order is observable
- **GIVEN** a step in which the model returns a tool call
- **WHEN** the recorded call log of the fakes is inspected
- **THEN** it shows `prepare` before the gateway call, `record` after it, and tool filtering before `shapeToolResult`

#### Scenario: Prepared items are sent unchanged
- **GIVEN** a context engine that returns a specific `preparedItems` list
- **WHEN** the step calls the gateway
- **THEN** the gateway request items are deep-equal to that list

### Requirement: Context preflight authority
When `prepare` returns `stop`, the step SHALL return `budget_exhausted` with the engine's reason and SHALL NOT call the gateway. When it returns `needs_compaction`, the step SHALL return `needs_compaction` with the summary prompt and items to summarize and SHALL NOT call the gateway. Each returned transformation SHALL be persisted as a `context.transformed` event and the allocation telemetry as `context.allocated`, including the content digest of the prepared items.

#### Scenario: Engine says stop
- **GIVEN** an engine returning `status: "stop"` with `stopReason: "context_budget"`
- **WHEN** the step executes
- **THEN** the outcome is `budget_exhausted(context_budget)` and the gateway call count is 0

#### Scenario: Transformations are persisted
- **GIVEN** an engine returning two transformations
- **WHEN** the step executes
- **THEN** two `context.transformed` events exist, each carrying action, target item id, token counts before and after, and replacement note

### Requirement: Step-limit forcing
With `enableMaxStepsForcing` on and steps counted from 1, every step with index at least `maxSteps − 1` SHALL call the gateway with `toolsDisabled: true` and an appended instruction requiring a text verdict. A tool call returned while tools are disabled SHALL NOT execute and SHALL be reported to the model as an error result. If no valid verdict is produced by step `maxSteps`, the run SHALL end with stop reason `max_steps_exceeded`.

#### Scenario: Model complies when tools are disabled
- **GIVEN** `maxSteps = 4` and a model that would keep calling tools
- **WHEN** step 3 begins
- **THEN** the gateway request has `toolsDisabled: true` and includes the forcing instruction, and a valid verdict returned there completes the run

#### Scenario: Model refuses to conclude
- **GIVEN** `maxSteps = 4` and a model that never returns a valid verdict
- **WHEN** step 4 ends without a verdict
- **THEN** the run ends `budget_exhausted` with reason `max_steps`

#### Scenario: Forcing disabled
- **GIVEN** `enableMaxStepsForcing = false`
- **WHEN** step `maxSteps − 1` begins
- **THEN** `toolsDisabled` is not set

### Requirement: Provider attempt accounting
Every provider attempt, including failed and compaction attempts, SHALL produce a `provider.attempted` event with attempt identity, model profile, usage, cost, latency, retry decision and backoff. Run token and cost totals SHALL equal the sum over all recorded attempts, and `record` SHALL be called with each successful attempt's real usage.

#### Scenario: Totals match attempts
- **GIVEN** a completed run with retries and one compaction
- **WHEN** the sum of tokens and cost over all `provider.attempted` events is compared with the run totals
- **THEN** they are equal

### Requirement: Verdict validation and bounded repair
When the model returns text without tool calls, the step SHALL parse it, validate it against `JudgeVerdictSchema` and cross-field rules, and resolve each evidence span through the source snapshot port, computing the content digest itself. A valid verdict yields `completed`. An invalid one SHALL emit `verdict.validation_failed` with safe validation paths and, when `enableSchemaRepair` is on and fewer than two repairs have been used, SHALL append the error as feedback for the next step. After repair exhaustion, or immediately when repair is disabled, the outcome SHALL be `failed` with reason `schema_repair_exhausted`.

#### Scenario: Repair succeeds
- **GIVEN** a model whose first answer fails schema validation and whose second answer is valid
- **WHEN** the run executes
- **THEN** the run completes after the second answer and one `verdict.validation_failed` event exists

#### Scenario: Repair exhausted
- **GIVEN** a model that returns invalid verdicts three times
- **WHEN** the run executes
- **THEN** the run ends `failed` with reason `schema_repair_exhausted`

#### Scenario: Evidence outside the snapshot
- **GIVEN** a verdict citing a path that the snapshot port cannot resolve
- **WHEN** evidence resolution runs
- **THEN** validation fails, no verdict is committed, and the model is never asked to supply a hash

#### Scenario: Digest computed by the runner
- **GIVEN** a verdict citing lines 10-20 of a snapshot file
- **WHEN** it is accepted
- **THEN** the committed evidence carries the SHA-256 digest of exactly those lines as read from the snapshot

### Requirement: Deterministic parallel tool dispatch
When the model returns several tool calls, the step SHALL assign `callIndex` in response order, persist `tool.requested` events in that order, run the calls concurrently with settlement of all of them, and order results by `callIndex` before persisting them and adding them to the context, regardless of completion order. With `enableParallelToolDispatch` off the calls SHALL run sequentially in index order and produce identical events and digests.

#### Scenario: Out-of-order completion
- **GIVEN** three calls whose fake durations make call 2 finish first
- **WHEN** the step completes
- **THEN** results and events appear in order 0, 1, 2

#### Scenario: Parallel and sequential agree
- **GIVEN** the same scripted run executed with parallel dispatch on and off
- **WHEN** their event payload digests are compared
- **THEN** the digests are identical

### Requirement: Tool failure becomes model-visible data
Any tool failure, including a thrown value, a rejected promise, an unknown tool name, invalid arguments, a denied path, or a missing file, SHALL be converted into a tool result with `isError = true` whose message states what happened, the relevant argument values, and a suggested next action. The step SHALL persist `tool.failed` and continue; a tool failure alone SHALL NOT terminate the run.

#### Scenario: Missing file
- **GIVEN** a model call `read_file` for a path absent from the snapshot
- **WHEN** the tool fake reports not found
- **THEN** the next prepared context contains an error result naming the path and suggesting how to list or search, and the run continues

#### Scenario: Denied path
- **GIVEN** a tool call refused by the registry as outside the allowed snapshot
- **WHEN** the result is processed
- **THEN** a `security.blocked` event with a rule identifier is persisted and the model receives a bounded refusal without any prohibited content

### Requirement: Filter before shape
Tool output SHALL pass through the security filter before the context engine's `shapeToolResult`. If shaping truncates content the result SHALL carry the engine's continuation note.

#### Scenario: Secret is removed before truncation
- **GIVEN** a tool output containing a secret in a region that shaping would remove
- **WHEN** the output is processed
- **THEN** the filter sees the original text first and the secret never reaches the shaping call or the context

### Requirement: Stop-reason evaluation and precedence
The runner SHALL evaluate stop conditions before each provider attempt and after each tool boundary. When more than one limit is exhausted it SHALL select the highest-precedence reason (wall clock, total tokens, max steps, context budget, no progress), record every observed exhausted limit in telemetry, and start no further provider or tool work.

#### Scenario: No work after stop
- **GIVEN** a stop reason selected at a boundary
- **WHEN** the runner commits the terminal state
- **THEN** no provider or tool call is started after that boundary

### Requirement: No-progress detection
With `enableNoProgressDetection` on, the loop SHALL count consecutive tool calls with identical tool name and canonical-JSON arguments and SHALL stop with `no_progress_detected` when the count reaches `noProgressMaxRepeats`. A different call SHALL reset the count.

#### Scenario: Repeated identical calls
- **GIVEN** `noProgressMaxRepeats = 3` and a model repeating the same `read_file` call
- **WHEN** the third identical call completes
- **THEN** the run ends `budget_exhausted` with reason `no_progress`

#### Scenario: Reordered arguments are identical
- **GIVEN** two calls whose arguments differ only in key order
- **WHEN** repeats are counted
- **THEN** they count as identical

### Requirement: Tier selection and state probe
When the sanitizer result reports that the submitter's PoC has assertions, the loop SHALL run Tier 1 adjudication using the trace and snapshot tools only. When it reports none, the loop SHALL additionally expose the loop-owned `run_state_probe` tool, which injects probes through the sanitizer port, runs them through the sandbox port, and returns the state-delta table, limited to `maxProbeRuns` executions per run. A probe execution SHALL NOT be counted as a model attempt and SHALL NOT be offered in Tier 1.

#### Scenario: Probe offered only in Tier 2
- **GIVEN** a PoC without assertions and one with assertions
- **WHEN** tool definitions for each run are listed
- **THEN** `run_state_probe` appears only for the first

#### Scenario: Probe budget enforced
- **GIVEN** `maxProbeRuns = 2` and a model requesting a third probe
- **WHEN** the call is processed
- **THEN** the sandbox port is not invoked and the model receives an error result stating the limit
