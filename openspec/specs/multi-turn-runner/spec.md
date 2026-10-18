# multi-turn-runner Specification

## Purpose

Provides a bounded multi-turn model→tool→model execution path over an immutable source
snapshot, so an agent run can read and search real source through the read-only tool
registry, record every model call and tool result in order, and be reviewed again after
the process restarts.

## Requirements

### Requirement: Bounded multi-turn runner
The system SHALL provide a multi-turn runner that executes a run bound to an immutable
snapshot by repeating, within one run, the sequence: assemble and send exactly one
provider attempt through `ModelGatewayPort`; when the response requests tools, dispatch
them through the read-only tool registry; append the requests and results to the run
history; and send the history back for the next attempt. The runner SHALL stop when the
model returns without tool calls or when a limit is reached. The runner SHALL NOT
modify, replace, or repurpose the single-turn baseline, and it SHALL NOT depend on Judge
verdict, adjudication, compaction, or security-filter logic.

#### Scenario: Model reads a file and then answers
- **GIVEN** a run bound to a snapshot and a model that first requests `read_file` and then answers with text and no tool call
- **WHEN** the runner executes the run
- **THEN** the run reaches a terminal completed state whose history contains the provider attempts, the tool request, the tool result, and the final answer in order

#### Scenario: Answer without tool calls behaves like the baseline
- **GIVEN** a model that answers on the first attempt with no tool call
- **WHEN** the runner executes the run
- **THEN** exactly one provider attempt is made, the tool registry is not invoked, and the terminal state matches the single-turn baseline outcome for the same input

### Requirement: Run input contract
The multi-turn run action SHALL accept, as its inputs, the run prompt, the immutable
snapshot identity, the allowed tool set, and the explicit limits (model turns, tool calls,
wall clock, and output tokens), and SHALL expose a run identity and the terminal outcome so
a caller or CLI can start a run and read it later. The output-token limit SHALL be carried
into every provider attempt of the chain, not only the first, and the run SHALL NOT start
any provider attempt when the snapshot identity does not resolve to a readable snapshot.

#### Scenario: Run starts from prompt, snapshot, and limits
- **GIVEN** a prompt, a resolvable snapshot identity, and explicit limits
- **WHEN** the run action is invoked
- **THEN** it returns a run identity, every attempt in the chain carries the output-token limit, and the run is readable by that identity

#### Scenario: Unresolvable snapshot is rejected before any provider call
- **GIVEN** a run action invoked with a snapshot identity that does not resolve to a readable snapshot
- **WHEN** input validation runs
- **THEN** the run fails with a clear reason and no provider attempt is made

### Requirement: Minimal per-turn request assembly
Each attempt SHALL send a request containing system/instruction content, the run prompt,
bounded initial source information that identifies the readable scope, the ordered
model/tool history, and the allowed tool definitions taken from the read-only tool
registry. The assembled request SHALL NOT contain host file-system paths, credentials,
ground-truth labels, adjudication reports, or scoring metadata.

#### Scenario: Allowed tools are present in the request
- **GIVEN** a run whose registry advertises the read-only source tools
- **WHEN** the runner assembles an attempt request
- **THEN** the request carries those tool definitions and the per-run tool-call cap

#### Scenario: Prohibited content is absent from the request
- **GIVEN** a run whose inputs include an absolute host path and a ground-truth key
- **WHEN** the attempt request is assembled and later persisted
- **THEN** neither the request sent to the model nor the persisted history contains the host path, ground-truth label, adjudication report, or scoring metadata

### Requirement: Tool call and result linkage
For each tool call the runner SHALL execute the tool with the model-supplied arguments,
associate the result with the originating tool-call identifier, and persist the request
and the result together in call order regardless of completion order. A tool failure —
an unknown tool, invalid arguments, a missing file, an unauthorized or denied path, or a
timeout — SHALL be persisted as a structured error result and SHALL NOT, by itself,
terminate the run.

#### Scenario: Out-of-order completion preserves call order
- **GIVEN** a model that requests several tool calls and the calls complete in a different order
- **WHEN** the requests and results are persisted
- **THEN** they appear in the history ordered by call index with each result bound to its own call identifier

#### Scenario: A tool failure becomes an error result and the loop continues
- **GIVEN** a model that requests a tool for a file that does not exist
- **WHEN** the tool fails
- **THEN** the history records a structured error result for that call and the runner sends the error back to the model instead of failing the run

### Requirement: Enforced limits with an explicit stop reason
Before starting any next provider attempt or tool dispatch the runner SHALL evaluate the
model-turn count, the tool-call count, the wall-clock budget, and the cost and token
budgets. When one or more limits are exhausted the runner SHALL stop with the
highest-precedence exhausted reason, record the exhausted limit in telemetry, and start
no further provider or tool work.

#### Scenario: Tool-call cap is reached
- **GIVEN** a run whose tool-call cap is reached by the current tool requests
- **WHEN** the runner evaluates the next action
- **THEN** it dispatches no further tool calls and ends the run with the tool-call exhaustion reason

#### Scenario: Highest precedence wins
- **GIVEN** a run that has simultaneously reached its wall-clock limit and its tool-call cap
- **WHEN** the stop reason is resolved
- **THEN** the recorded reason is the higher-precedence one and every exhausted limit is recorded in telemetry

### Requirement: Attempt and history persistence
Every provider attempt in the chain SHALL be persisted exactly once with its position in
the turn sequence, and the run SHALL be linked to the snapshot it analyzed. Each model turn
SHALL emit a `provider.attempted` event and, on success, a `model.responded` event, so
history can be read one model turn at a time. After a process restart, reading the run
SHALL return, in order, each model attempt, each tool request, each tool result or error,
and the terminal stop reason.

#### Scenario: Redelivery does not duplicate an attempt
- **GIVEN** a run whose attempt has already been persisted
- **WHEN** the same attempt is recorded again because of a retry or worker redelivery
- **THEN** exactly one durable record exists for that attempt position

#### Scenario: History is readable after restart
- **GIVEN** a completed multi-turn run
- **WHEN** a new process reads the run and its events
- **THEN** it reconstructs the ordered chain of model turns, tool requests, tool results/errors, and the terminal reason without relying on in-memory state

### Requirement: Untrusted source content and secret boundary
The runner SHALL treat source and tool output as untrusted data, keep it delimited from
instructions, and redact credentials before persistence. The runner MUST NOT accept,
process, or persist ground-truth labels, adjudication reports, or scoring metadata, and
MUST NOT place host paths in provider requests or persisted events.

#### Scenario: Secret in tool output is redacted
- **GIVEN** a tool result that contains an API key pattern
- **WHEN** the result is persisted
- **THEN** the stored result contains a redacted form and no raw credential

#### Scenario: Ground-truth content is rejected
- **GIVEN** an input or tool result carrying a ground-truth label or scoring metadata
- **WHEN** it reaches the runner boundary
- **THEN** it is rejected or removed and never reaches the provider request or the trajectory

### Requirement: Snapshot binding and resume identity
The runner SHALL refuse to start, before any provider attempt, when its tool registry is bound to a snapshot ID different from the run's snapshot ID. When resuming an existing run it SHALL verify that the stored snapshot ID and prompt equal the supplied input, and SHALL fail with `invalid_input` otherwise.

#### Scenario: Registry bound to another snapshot
- **GIVEN** a run input for snapshot `S1` and a registry bound to snapshot `S2`
- **WHEN** the run is executed
- **THEN** it ends `failed` with reason `invalid_input` and the gateway is never called

#### Scenario: Resume with a different snapshot is rejected
- **GIVEN** a stored run created for snapshot `S1`
- **WHEN** it is resumed with input snapshot `S2`
- **THEN** it ends `failed` with reason `invalid_input` and no provider attempt is made

### Requirement: Two-tier model-visible sanitizer
The runner SHALL sanitize all model-visible text in two tiers before persisting it or assembling a provider request. In both tiers, URLs such as GitHub permalinks SHALL stay intact.

- **Full tier:** applies to the prompt, every string value inside model-supplied tool arguments, tool error messages and generated initial source information. It SHALL remove Windows drive paths, UNC paths, POSIX absolute paths, credential patterns, and ground-truth or scoring markers.
- **Credential tier:** applies to content read from the snapshot (successful `read_file`, `grep`, `glob` and `list_dir` results). It SHALL remove only credential patterns and SHALL otherwise keep the content exactly as stored.

#### Scenario: Snapshot content keeps its path-like comments
- **GIVEN** a snapshot file containing the line `// see /docs/spec.md for details`
- **WHEN** the model reads it with `read_file`
- **THEN** the tool result given to the model contains that line unchanged

#### Scenario: Credential in snapshot content is redacted
- **GIVEN** a snapshot file containing an `sk-` style API key
- **WHEN** the model reads it with `read_file`
- **THEN** the result and the persisted history contain a redacted form and not the raw key

#### Scenario: Windows path in tool arguments never persists
- **GIVEN** a model tool call whose `path` argument is `D:\repo\Vault.sol`
- **WHEN** the call is dispatched and the run's events and next request are inspected
- **THEN** the string `D:\repo` appears in no event payload and no later provider request

#### Scenario: Permalink in the prompt survives
- **GIVEN** a prompt containing `https://github.com/org/repo/blob/abc/src/Vault.sol#L10`
- **WHEN** the request is assembled
- **THEN** the permalink appears unchanged in the request

### Requirement: Post-response and resumed budget enforcement
The runner SHALL enforce its limits at these points:

- **After every model response:** before tool approval or dispatch, it SHALL evaluate the wall-clock, token, cost, model-turn and tool-call limits again, and SHALL dispatch no tool when a limit is exhausted.
- **Before every provider attempt:** it SHALL stop with the total-token reason when the remaining token budget is smaller than the configured maximum output tokens.
- **On a final text answer:** a final answer that exhausted a limit SHALL complete the run. Every exhausted limit SHALL be returned in the run result (`observedLimits`) and SHALL be derivable from the persisted `provider.attempted` events together with the limits recorded in `run.started`.
- **On resume:** it SHALL restore the run start time from the persisted `run.started` event and the completed tool-call count from history.
- **On input:** it SHALL enforce the configured maximum prompt length before any snapshot access.

#### Scenario: Remaining budget cannot cover the output reserve
- **GIVEN** a total-token budget of 10,000 with 9,500 tokens already used and a maximum of 1,024 output tokens
- **WHEN** the runner prepares the next provider attempt
- **THEN** no attempt is made and the run ends `budget_exhausted` with the total-token reason

#### Scenario: Cost ceiling crossed by a tool-calling response
- **GIVEN** a cost ceiling of 0.01 USD and a model response costing 0.02 USD that requests a tool
- **WHEN** the response is processed
- **THEN** no tool is dispatched and the run ends `budget_exhausted` with the cost reason

#### Scenario: Resumed run keeps its tool-call count
- **GIVEN** a run with a tool-call cap of 3 that completed 3 tool calls before the worker stopped
- **WHEN** a new worker resumes it and the model requests another tool
- **THEN** the tool is not dispatched and the run ends with the tool-call exhaustion reason

### Requirement: Initial source information reports unreadable files and run tool limits
The runner's initial source information SHALL list, bounded to at most 20 entries plus a total count, the snapshot files that were skipped as `too_large` or `binary`, and SHALL state that those files exist but cannot be read. It SHALL NOT list paths skipped as `denied` or `symlink`. The `run.started` event SHALL record the effective tool limits reported by the tool registry.

#### Scenario: Oversized file is announced, denied file is not
- **GIVEN** a snapshot whose manifest skipped `src/Flattened.sol` as `too_large` and `.env.local` as `denied`
- **WHEN** the first request is assembled
- **THEN** the request mentions `src/Flattened.sol` as present but unreadable and does not mention `.env.local`

#### Scenario: Tool limits are recorded per run
- **GIVEN** a registry configured with a grep timeout of 1,500 ms
- **WHEN** a run starts
- **THEN** the `run.started` event records a grep timeout of 1,500 ms

### Requirement: Crash-consistent tool and attempt persistence
For each tool call the runner SHALL persist the request item and the result item before the `tool.completed` or `tool.failed` event that references them. It SHALL write the attempt record before the corresponding `provider.attempted` event. When resumed history cannot be hydrated, the run SHALL end `failed` with `persistence_failure` without a provider attempt. Run-history reconstruction SHALL identify tool calls by step and call ID.

#### Scenario: Crash after a tool result keeps the result
- **GIVEN** a worker that stops right after a tool result is persisted
- **WHEN** a new worker resumes the run
- **THEN** the history contains the real result for that call, not an interruption error

#### Scenario: Reused call ID across steps
- **GIVEN** a provider that returns call ID `c1` in step 1 and again in step 2
- **WHEN** the execution summary is reconstructed
- **THEN** both calls and both results appear, each bound to its own step

### Requirement: Provider error classification and never-reject execution
Provider failures with category `rate_limit` or `transport` SHALL end the run with `provider_transient_primary`, and those with category `authentication` or `invalid_request` with `provider_permanent`. The run action SHALL never reject: an unexpected error from any port SHALL be converted into a terminal failure result, attempting a `failed` transition with `persistence_failure`.

#### Scenario: Rate limit is classified as transient
- **GIVEN** a gateway that returns a `rate_limit` error
- **WHEN** the run processes it
- **THEN** the run ends `failed` with terminal reason `provider_transient_primary`

#### Scenario: Store failure does not reject
- **GIVEN** a run store whose `claim` throws
- **WHEN** the run is executed
- **THEN** the returned promise resolves with a `failed` result and does not reject

### Requirement: Prompt- and cost-aware pre-call guards
Before each provider attempt, the runner SHALL estimate the request's prompt tokens. It SHALL stop with the total-token reason when the remaining token budget is smaller than the estimated prompt tokens plus the maximum output tokens. When a cost estimator is supplied and returns a value, the runner SHALL stop with the cost reason when the estimated cost of the attempt exceeds the remaining cost budget. An estimator that cannot price the model SHALL disable only the cost check.

#### Scenario: Large prompt cannot fit the remaining budget
- **GIVEN** a remaining token budget of 1,000, no output-token limit, and a next request whose estimated prompt is 1,500 tokens
- **WHEN** the runner prepares the attempt
- **THEN** no attempt is made and the run ends `budget_exhausted` with the total-token reason

#### Scenario: Estimated cost exceeds the remaining cost budget
- **GIVEN** a remaining cost budget of 0.001 USD and a cost estimator that prices the next attempt at 0.01 USD
- **WHEN** the runner prepares the attempt
- **THEN** no attempt is made and the run ends `budget_exhausted` with the cost reason

#### Scenario: Unknown pricing disables only the cost check
- **GIVEN** a cost estimator that returns `undefined` for the run's model
- **WHEN** the runner prepares an attempt that fits the token budget
- **THEN** the attempt is made
