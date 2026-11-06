# Spec Delta

## Purpose

Provides single-turn prompt execution orchestration, pre-flight input validation, atomic state progression, non-retry interruption handling, and historical run retrieval for the direct-model baseline.

## ADDED Requirements

### Requirement: Single-turn execution orchestration
The system SHALL provide a `SingleTurnRunner` that coordinates a single-turn prompt execution against a `ModelGatewayPort` and persists state and events via `RunStorePort`. The runner MUST initialize or claim a run in `pending` or `queued` state, transition to `running`, record invocation events (`run.queued`, `run.started`), invoke exactly one attempt on `ModelGatewayPort`, record the outcome event (`model.completed` or `model.failed`), and transition the terminal run state to `completed` or `failed` with Compare-and-Set concurrency guards.

#### Scenario: Successful execution end-to-end
- **GIVEN** a valid prompt and model configuration
- **WHEN** the single-turn runner executes the run
- **THEN** the run transitions through `running` to `completed`, provider usage metrics (tokens, cost, latency) are recorded in the terminal record and `model.completed` event, and the model response text is persisted

#### Scenario: Provider error marks run failed
- **GIVEN** a model provider error during attempt execution
- **WHEN** the runner handles the error response
- **THEN** a `model.failed` event is recorded, the run state transitions to `failed` with the sanitized error message, and no unhandled rejection is thrown

### Requirement: Input validation and constraint bounds
The runner MUST validate all input parameters before dispatching any provider attempt. If the prompt is empty, exceeds the maximum configured character limit, or if limits (timeout, max tokens) are invalid, the runner SHALL reject execution or record a terminal `failed` state with a validation error reason without invoking `ModelGatewayPort`.

#### Scenario: Empty prompt rejection
- **GIVEN** a prompt containing only whitespace
- **WHEN** the runner validates the execution input
- **THEN** execution halts with an input validation error, the model gateway is not invoked, and token usage remains zero

#### Scenario: Prompt length exceeding maximum bound
- **GIVEN** a prompt whose character length exceeds the configured maximum allowed length
- **WHEN** input validation executes
- **THEN** execution fails immediately with `prompt_length_exceeded`, no provider attempt is initiated, and 0 tokens are consumed

### Requirement: Interruption handling and non-retry guarantee
When a provider attempt times out, encounters an unrecoverable transport error, or is aborted, the runner SHALL record an explicit failure or interruption event and transition the run to `failed`. The runner MUST NOT trigger automatic blind retries when the outcome of a provider attempt is ambiguous or interrupted, preserving auditability and cost predictability.

#### Scenario: Provider timeout records failure without retry
- **GIVEN** a provider call that times out after the configured timeout threshold
- **WHEN** the timeout is triggered
- **THEN** the runner records an interrupted failure event, updates the run state to `failed` with reason `timeout`, and does not issue a subsequent attempt

### Requirement: Persistent run and history inspection query
The system SHALL provide programmatic query functions (`getRun` and `getRunHistory`) that accept a `runId` and `RunStorePort`. `getRun` MUST return the persistent `RunRecord` including its terminal state, version, and error or completion details. `getRunHistory` MUST return all recorded trajectory events sorted strictly in ascending sequence order (`sequence: 1..N`).

#### Scenario: Query existing run and trajectory history
- **GIVEN** an existing completed or failed run in the persistent store with multiple events
- **WHEN** `getRunHistory` is invoked with the run identifier
- **THEN** the returned events are strictly sorted in ascending sequence order with contiguous sequence numbers

#### Scenario: Query non-existent run
- **GIVEN** a run identifier that does not exist in the store
- **WHEN** `getRun` is invoked
- **THEN** `null` is returned without throwing an unhandled exception

### Requirement: Secret sanitization and ground-truth isolation
All events, stored outputs, and error messages emitted during single-turn execution MUST sanitize API keys and credential secrets. The single-turn runner MUST NOT accept, process, or persist any ground-truth labels, adjudication reports, or scoring metadata.

#### Scenario: Error message containing secret token
- **GIVEN** an error message containing an API key or bearer credential
- **WHEN** the error event is persisted and the terminal state updated
- **THEN** the stored message has the secret redacted and cannot be recovered from the trajectory events
