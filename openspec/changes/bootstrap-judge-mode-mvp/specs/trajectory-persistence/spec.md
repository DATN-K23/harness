## Purpose

Defines the persistence and data-dictionary blueprint required to explain, reproduce, compare, and later replay every Judge run without storing prohibited data.

## ADDED Requirements

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
