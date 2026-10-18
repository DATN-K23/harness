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
