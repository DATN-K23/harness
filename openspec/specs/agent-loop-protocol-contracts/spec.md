# agent-loop-protocol-contracts Specification

## Purpose

Defines the typed interfaces, domain schemas, ports, events, and configuration contracts that the Agent Loop exchanges with the context engine, model gateway, tool registry, stage pipelines, persistence store, and other subsystem tracks.

## Requirements

### Requirement: Context engine port contract
`@harness/protocol` SHALL define `ContextItem`, `ContextItemType`, `ContextPolicy`, `ModelLimits`, `RunBudget`, `PrepareResult`, `RecordResult`, `ShapeToolResultOutcome` and `ContextEnginePort` with the shapes in `docs/tv1-agent-loop-design.md` section 5.1. `prepare` SHALL return exactly one of `ready`, `needs_compaction` or `stop`; `stop` SHALL carry a `stopReason` of `context_budget` or `total_tokens`. Items SHALL be passed as a list, never as concatenated text, and each item SHALL carry `id`, `turn`, `type`, `isPinned`, and tool metadata when applicable.

#### Scenario: Unknown prepare status is rejected
- **GIVEN** a context engine response whose `status` is not one of the three allowed values
- **WHEN** it is parsed by the protocol schema
- **THEN** parsing fails and the loop treats the response as an engine contract violation

#### Scenario: Pinned items are identifiable
- **GIVEN** a list containing a `candidate_finding` item and an `assistant_reasoning` item
- **WHEN** items with `isPinned = true` are selected
- **THEN** only the `candidate_finding` item is returned

### Requirement: Model gateway port contract
The protocol SHALL define `ModelAttemptRequest`, `ModelAttemptResponse` and `ModelGatewayPort.executeAttempt`. One call SHALL represent exactly one provider attempt. A provider failure SHALL be returned in the response `error` field with `isRetryable` and a `category`; the port SHALL NOT throw for provider failures. The response SHALL include `finishReason`, optional `content`, optional `toolCalls`, `usage` (prompt, completion, total tokens and `costUsd`), and `latencyMs`.

#### Scenario: Provider error is data
- **GIVEN** a gateway implementation receiving a rate-limited response
- **WHEN** `executeAttempt` completes
- **THEN** it resolves with `finishReason: "error"` and an `error` object whose `category` is `rate_limit`

### Requirement: Normative judge verdict schema
The protocol SHALL define `JudgeVerdictSchema` with the fields of `docs/tv1-agent-loop-design.md` section 5.2 and the optional additions `classification` (name and optional standard identifier), `report` (executive summary, root cause, attack path, impact, remediation), and per-evidence `snippet` and `contentDigest`. A verdict SHALL satisfy the cross-field rules: `valid` requires `verificationStatus = PASS`, severity in `CRITICAL|HIGH|MEDIUM` and at least one evidence item; `invalid` requires `verificationStatus = FAIL`. Evidence line ranges SHALL satisfy `startLine ≥ 1` and `endLine ≥ startLine`.

#### Scenario: Contradictory verdict is rejected
- **GIVEN** a verdict with `validity: "valid"` and `verificationStatus: "FAIL"`
- **WHEN** it is validated
- **THEN** validation fails with a defined reason identifying the contradictory fields

#### Scenario: Valid verdict without evidence is rejected
- **GIVEN** a verdict with `validity: "valid"`, `PASS`, severity `HIGH` and an empty evidence list
- **WHEN** it is validated
- **THEN** validation fails with a reason naming missing evidence

#### Scenario: Short reasoning is rejected
- **GIVEN** a verdict whose `reasoning` has fewer than 50 characters
- **WHEN** it is validated
- **THEN** validation fails on the `reasoning` path

### Requirement: Step outcome tagged union
The protocol SHALL define `StepOutcome` as a tagged union of `completed`, `needs_compaction`, `continue_turn`, `budget_exhausted` and `failed`. Consumers SHALL be able to handle it exhaustively; adding a variant SHALL cause a compile-time error in any consumer that does not handle it.

#### Scenario: Non-exhaustive handling fails to compile
- **GIVEN** a switch over `StepOutcome.type` that omits `failed`
- **WHEN** the package is typechecked
- **THEN** typechecking fails

### Requirement: Stop conditions and precedence constants
The protocol SHALL define `StopReason`, `BudgetLimits` (wall clock, cost, total tokens, max steps, no-progress repeats) and the ordered precedence list `wall_clock_timeout, cost_budget_exhausted, total_tokens_exhausted, max_steps_exceeded, context_budget_exhausted, no_progress_detected`. It SHALL define the mapping of each stop reason to the blueprint terminal reason (`wall_clock`, `cost_budget`, `total_tokens`, `max_steps`, `context_budget`, `no_progress`).

#### Scenario: Mapping is total
- **GIVEN** the list of stop reasons
- **WHEN** each is mapped to a terminal reason
- **THEN** every stop reason maps to exactly one blueprint terminal reason and no two map to the same one

### Requirement: Trajectory event envelope
The protocol SHALL define the trajectory event envelope with `eventId`, `runId`, `sequence` (integer starting at 1), `type`, `schemaVersion`, `payload`, `payloadDigest` and `occurredAt` (UTC RFC 3339 with `Z`). The event type vocabulary SHALL include every blueprint run event type and the additions `context.item_added`, `context.compacted`, `stage.started`, `stage.finished` and `step.started`. Payloads SHALL NOT contain host paths, credentials, ground-truth labels or scorer metadata.

#### Scenario: Unknown event type is rejected
- **GIVEN** an event with a type outside the vocabulary
- **WHEN** it is parsed
- **THEN** parsing fails

#### Scenario: Timestamp format is enforced
- **GIVEN** an event whose `occurredAt` lacks the `Z` suffix
- **WHEN** it is parsed
- **THEN** parsing fails

### Requirement: Boundary ports
The protocol SHALL define the ports through which the loop reaches other tracks: tool registry, security filter, ingestion, sanitizer, sandbox, source snapshot reader, run store, clock, random source, sleep, and cancellation. The source snapshot port SHALL expose read-only operations. The run store port SHALL require a claim token and expected state version on every mutation. No port SHALL expose ground-truth labels, adjudication reports or scoring metadata to agent-visible paths.

#### Scenario: Run store mutation requires a claim
- **GIVEN** the run store port type
- **WHEN** an append-event call is written without a claim token
- **THEN** the call does not typecheck

#### Scenario: Snapshot port is read-only
- **GIVEN** the source snapshot port type
- **WHEN** its members are enumerated
- **THEN** none of them writes, deletes, renames or executes

### Requirement: Run flags and configuration snapshot
The protocol SHALL define the resolved flag set (the six TV2 flags plus `enableSchemaRepair`, `enableMaxStepsForcing`, `enableNoProgressDetection`, `enableInfraRetry`, `enableParallelToolDispatch`) and a run configuration snapshot containing the resolved flags, `ContextPolicy`, retry configuration, budget limits, system prompt digest and verdict schema digest, with a canonical digest of the whole snapshot.

#### Scenario: Equal configuration gives equal digest
- **GIVEN** two snapshots constructed from the same values in different key order
- **WHEN** their digests are computed
- **THEN** the digests are equal

#### Scenario: Changed flag changes digest
- **GIVEN** a snapshot and a copy differing only in `enableObsMasking`
- **WHEN** their digests are computed
- **THEN** the digests differ
