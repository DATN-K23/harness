# trajectory-persistence Specification

## Purpose

Defines the persistence and data-dictionary blueprint required to explain, reproduce, compare, and later replay every Judge run without storing prohibited data.

## Requirements

### Requirement: Relational model and ownership blueprint
The blueprint MUST provide an ERD and field dictionary for source snapshot, candidate finding, run, immutable run configuration, step, provider attempt, tool call, verdict, evidence, security event, experiment, experiment cell, scorer-only label and approved score, including identifiers, constraints, indexes, cardinality, nullability, capability ownership, database role/schema and retention classification. Each table and migration contribution MUST have exactly one capability owner; another capability MUST interact through public contracts rather than direct table queries.

#### Scenario: Data model is reviewed end to end
- **GIVEN** one accepted run that reaches a completed verdict
- **WHEN** a reviewer maps its lifecycle onto the ERD and dictionary
- **THEN** every required record, relation, invariant, aggregate, public query path and database-role boundary is defined without an orphan, ambiguous owner or cross-capability table access

### Requirement: Complete reproduction snapshot
The blueprint SHALL define storage or content references for canonical candidate and source digests; harness/build/runtime/dependency identifiers; resolved prompt, tool-description, schema, flag, budget, sampling, provider, pricing, manifest, and split data; and timestamp provenance before enqueueing.

#### Scenario: Global configuration later changes
- **GIVEN** a stored blueprint example for a run and a later global configuration version
- **WHEN** reproducibility fields are compared
- **THEN** the original resolved values and content digests remain sufficient to identify every mismatch without claiming byte-identical stochastic output

### Requirement: Append-only ordered trajectory semantics
The blueprint MUST define event ordering, `(run_id, sequence)` uniqueness, atomic terminal commits, compare-and-set transitions, idempotent job redelivery, cross-run isolation, and behavior when a worker stops after partial commits.

#### Scenario: Worker delivery is duplicated
- **GIVEN** a worker redelivery after some events are committed
- **WHEN** the persistence and queue sequence is followed
- **THEN** duplicate sequences and terminal transitions are rejected while the committed trajectory remains ordered and inspectable

### Requirement: Exact sanitized model-visible content
The blueprint SHALL persist the exact post-transformation content visible to the model with original content digest or immutable reference, transformation rule/version, native and normalized usage, cost, latency, errors, and timestamps. Redaction MUST occur before persistence and prohibited originals MUST NOT be retained.

#### Scenario: Oversized sensitive result is transformed
- **GIVEN** a tool result that is both oversized and sensitive
- **WHEN** the planned transformation pipeline is applied
- **THEN** the data dictionary and event example retain the bounded redacted representation, original digest, rule versions, and security marker but not the prohibited value

### Requirement: Durable database-owned work execution
The blueprint MUST make committed relational state, a transactional outbox or equivalent recoverable handoff, and versioned worker claims the authority for accepted, queued, running, cancelled, redelivered, and terminal work. Process-local memory, wake signals, locks, coordinators, HTTP connections, and UI subscriptions MAY optimize delivery but MUST NOT establish ownership, hide committed work, or be required to recover a run after process loss.

#### Scenario: Daemon and worker processes restart
- **GIVEN** an accepted or partially executed run whose daemon or worker process terminates after a committed boundary
- **WHEN** replacement processes start with no prior in-memory state
- **THEN** they derive the legal next action from PostgreSQL records, claims, versions, remaining budgets and committed events, without duplicating a terminal transition or pretending that an ambiguous paid attempt did not occur

### Requirement: Desktop-independent persistence projection
The desktop's renderer cache, native-shell state, notification state, open window and connection cursor MUST NOT be authoritative run or evaluation storage. The blueprint SHALL define cursor resume, event de-duplication and safe full refresh from the local runtime so closing, reinstalling or reconnecting a compatible desktop cannot alter committed execution semantics.

#### Scenario: Desktop cache is missing or stale
- **GIVEN** PostgreSQL contains a committed run trajectory and the desktop has no cache or an older cursor
- **WHEN** the generated client reopens the run
- **THEN** the view is reconstructed from versioned status and ordered event resources, duplicate events are ignored by run sequence identity, and no desktop state can insert, rewrite or finalize an authoritative event

### Requirement: PostgreSQL relational schema and migrations
The persistence layer SHALL provide a relational schema managed via Drizzle ORM and SQL migrations with three core tables: `runs`, `events`, and `model_attempts`.
- `runs` MUST record `id` (text primary key), `prompt` (text), `state` (varchar: `pending`, `running`, `completed`, `failed`), `state_version` (integer optimistic concurrency version), `model_profile` (varchar), `result_content` (text nullable), `error_message` (text nullable), `prompt_tokens` (integer nullable), `completion_tokens` (integer nullable), `cost_usd` (numeric nullable), `latency_ms` (integer nullable), `created_at` (timestamp), `updated_at` (timestamp), and optional `terminal_reason` (varchar nullable).
- `events` MUST record `id` (text primary key), foreign key `run_id` referencing `runs(id)`, `sequence` (integer), `event_type` (varchar), `payload` (jsonb), `payload_digest` (varchar), and `timestamp` (timestamp), with a composite uniqueness constraint on `(run_id, sequence)` guaranteeing an ordered, contiguous event trajectory.
- `model_attempts` MUST record `id` (text primary key), `run_id` (foreign key referencing `runs(id)`), `attempt_number` (integer), `provider` (varchar), `model` (varchar), `prompt_tokens` (integer), `completion_tokens` (integer), `total_tokens` (integer), `cost_usd` (numeric), `latency_ms` (integer), `finish_reason` (varchar nullable), `request_json` (jsonb), `response_json` (jsonb nullable), `error_message` (text nullable), `error_category` (varchar nullable), and `created_at` (timestamp).
Database migrations MUST be reproducible via SQL migration files generated by `drizzle-kit` and executable via `bun run --cwd packages/schema db:migrate`.

#### Scenario: Running database migration creates relational tables
- **WHEN** the migration command `bun run --cwd packages/schema db:migrate` is executed against an accessible PostgreSQL database
- **THEN** tables `runs`, `events`, and `model_attempts` are created with the specified columns, data types, foreign keys, and uniqueness constraints.

### Requirement: PostgresRunStore Compare-and-Set and claim lifecycle
The persistence adapter `PostgresRunStore` MUST implement `RunStorePort` (`claim`, `appendEvent`, `transition`, `loadRun`, `loadEvents`).
- `claim` MUST atomically acquire or update an active worker claim on an un-terminal run, incrementing `claim_version` and assigning a unique `claim_token` with an expiration timestamp (`expires_at_ms`). If the run is already held under an unexpired claim or is in a terminal state, `claim` MUST return `{ kind: "unavailable", reason: "already_claimed" | "terminal" | "not_found" }`.
- `transition` MUST atomically verify the caller's active claim and expected state version using Compare-and-Set (CAS). If the claim token or version does not match, or the run has transitioned, it MUST return `{ kind: "stale", reason: "claim_lost" | "state_changed" }` without updating the record.
- `appendEvent` MUST atomically append trajectory events in contiguous sequence order `sequence = last_sequence + 1` while validating claim ownership and expected state version. Duplicate sequence proposals or out-of-order sequence insertion attempts MUST be rejected with a concurrency violation.
- `PostgresRunStore` MUST pass the canonical `runStoreContractTests` conformance test suite.

#### Scenario: Worker acquires a valid run claim
- **GIVEN** a seeded run in state `queued` with no active worker lease
- **WHEN** worker `worker-1` calls `store.claim({ runId: "run-1", workerId: "worker-1" })`
- **THEN** the store returns `{ kind: "claimed", claim, state: "queued", stateVersion }` with a non-empty `claimToken` and `claimVersion >= 1`.

#### Scenario: Conflicting claim on active lease is rejected
- **GIVEN** an active run claim held by `worker-1` whose lease has not expired
- **WHEN** another worker `worker-2` calls `store.claim({ runId: "run-1", workerId: "worker-2" })`
- **THEN** the store returns `{ kind: "unavailable", reason: "already_claimed" }` and leaves the existing claim intact.

#### Scenario: Stale state transition is rejected via CAS
- **GIVEN** a claimed run at state version `1`
- **WHEN** a worker attempts a transition with `expectedStateVersion: 0`
- **THEN** the store returns `{ kind: "stale", reason: "state_changed" }` and does not alter the run's state or state version.

#### Scenario: Appending event preserves contiguous sequence ordering
- **GIVEN** a claimed run whose latest committed event has sequence `N`
- **WHEN** `appendEvent` is called with a new event
- **THEN** the event is persisted with sequence `N + 1` and subsequent queries return events in ascending sequence order.

### Requirement: Zero secret leakage in persistent storage
The persistence layer and adapter MUST NOT store raw provider authentication keys, database connection passwords, or plaintext credentials in database columns, JSONB payloads, or error logs. All request, response, error message, and event payloads MUST be sanitized or redacted prior to database insertion.

#### Scenario: Model attempt with API key is sanitized before storage
- **WHEN** an attempt record or event containing authorization tokens or database connection passwords is submitted to `PostgresRunStore`
- **THEN** the persisted database record contains only redacted or masked representations (`[REDACTED]`) and no raw credentials.
