# Spec Delta: single-turn-runner

## MODIFIED Requirements

### Requirement: Single-turn execution orchestration
The system SHALL provide a `SingleTurnRunner` that coordinates a single-turn prompt execution against a `ModelGatewayPort` and persists state and events via `RunStorePort`. The runner MUST initialize or claim a run in `pending` or `queued` state, transition to `running`, record invocation events (`run.queued`, `run.started`), invoke exactly one attempt on `ModelGatewayPort`, record the outcome event (`provider.attempted` or `provider.failed`), and transition the terminal run state to `completed` or `failed` with Compare-and-Set concurrency guards. When `seedRun` is available on the store, the runner MUST asynchronously await its completion before issuing the initial claim to eliminate race conditions against relational databases.

#### Scenario: Successful execution end-to-end
- **GIVEN** a valid prompt and model configuration
- **WHEN** the single-turn runner executes the run
- **THEN** the run transitions through `running` to `completed`, provider usage metrics (tokens, cost, latency) are recorded in the terminal record and `model.completed` event, and the model response text is persisted

#### Scenario: Provider error marks run failed
- **GIVEN** a model provider error during attempt execution
- **WHEN** the runner handles the error response
- **THEN** a `model.failed` event is recorded, the run state transitions to `failed` with the sanitized error message, and no unhandled rejection is thrown

#### Scenario: Asynchronous run registration avoids claim race condition
- **GIVEN** a persistent database store where `seedRun` performs asynchronous insertion
- **WHEN** the runner initiates execution with a generated `runId`
- **THEN** the initial insert completes before `claim()` is executed, acquiring the claim successfully without `not_found` errors

#### Scenario: Terminal run outcomes are fully persisted
- **GIVEN** a successful model execution
- **WHEN** the runner transitions the run to `completed`
- **THEN** the store's run record reflects the original prompt, response content, prompt tokens, completion tokens, cost in USD, latency in milliseconds, and the terminal state

### Requirement: Persistent run and history inspection query
The system SHALL provide programmatic query functions (`getRun` and `getRunHistory`) that accept a `runId` and `RunStorePort`. `getRun` MUST return the persistent `RunRecord` including its terminal state, version, original prompt, model profile, result content or error details, token usage, cost, and latency. `getRunHistory` MUST return all recorded trajectory events sorted strictly in ascending sequence order (`sequence: 1..N`).

#### Scenario: Query existing run and trajectory history
- **GIVEN** an existing completed or failed run in the persistent store with multiple events
- **WHEN** `getRunHistory` is invoked with the run identifier
- **THEN** the returned events are strictly sorted in ascending sequence order with contiguous sequence numbers

#### Scenario: Query non-existent run
- **GIVEN** a run identifier that does not exist in the store
- **WHEN** `getRun` is invoked
- **THEN** `null` is returned without throwing an unhandled exception

#### Scenario: Inspect complete run record across process restart
- **GIVEN** a run executed and stored in PostgreSQL by an earlier process
- **WHEN** `getRun` is invoked with the `runId` on a newly created `PostgresRunStore`
- **THEN** the returned run record contains the original prompt, terminal state, model output, token counts, cost in USD, and latency
