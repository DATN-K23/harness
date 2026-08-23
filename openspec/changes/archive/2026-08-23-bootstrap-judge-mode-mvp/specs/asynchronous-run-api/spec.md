## Purpose

Defines the implementation-neutral local-runtime API blueprint required for the downloadable desktop client, runtime processes, and reviewers to agree on asynchronous Judge-run behavior before code exists.

## ADDED Requirements

### Requirement: Complete asynchronous API contract
The blueprint MUST define request and response schemas, status codes, headers, and examples for Judge submission, run retrieval, ordered event retrieval, and cancellation. Submission MUST return a `run_id` without waiting for model execution.

#### Scenario: API blueprint is reviewed
- **GIVEN** the API contract artifact and its referenced schemas
- **WHEN** a reviewer traces a successful Judge submission through terminal retrieval
- **THEN** every request, response, identifier, state, status code, and schema reference required by the flow is defined without relying on implementation code

### Requirement: Idempotency and error semantics
The blueprint SHALL define canonical request digest calculation, idempotency-key behavior, conflict handling, validation failures, unknown-run behavior, pagination errors, and a common machine-readable error envelope.

#### Scenario: Duplicate submission is modeled
- **GIVEN** two submissions with the same idempotency key
- **WHEN** their canonical request digests are equal or different
- **THEN** the contract unambiguously specifies reuse of the original `run_id` for equal digests and a conflict response for different digests

### Requirement: Partial state and cancellation semantics
The blueprint MUST define which fields are visible for accepted, queued, running, and terminal runs; it MUST prohibit presenting a partial verdict as final and MUST specify idempotent cooperative cancellation at safe worker boundaries.

#### Scenario: Non-terminal run is inspected
- **GIVEN** a run with committed events that has not reached a terminal state
- **WHEN** a client retrieves status or requests cancellation
- **THEN** the blueprint identifies the visible partial data, legal transition, cancellation outcome, and preservation of committed events

### Requirement: Non-public access-controlled local-runtime boundary
The blueprint SHALL define the MVP control plane as a single-user local daemon reachable only through a loopback-bound endpoint or OS-equivalent local IPC. Endpoint discovery MUST use an installation-scoped protected rendezvous mechanism, and requests MUST use an installation-scoped access credential or equivalent OS access control. The credential MUST remain under native-shell/OS-protected custody, MUST NOT appear in URLs, renderer persistence, ordinary logs, trajectories or exports, and MUST be rotatable without changing run identity. If no approved protected credential backend is available, connection setup MUST fail closed; plaintext files, renderer storage and silent insecure fallbacks are prohibited. Public-interface binding, remote access and multi-tenancy MUST be disabled and marked as future work; local process access control MUST NOT be presented as production multi-user authorization.

#### Scenario: Deployment assumptions are checked
- **GIVEN** the API security and desktop/runtime connection sections
- **WHEN** a reviewer evaluates endpoint binding, discovery, local credential handling and whether the contract can be exposed publicly
- **THEN** the blueprint requires a protected local-only path, rejects public exposure and credential logging, and records a separate future remote-authorization extension point

#### Scenario: Protected credential storage is unavailable
- **GIVEN** the desktop starts on a host where no approved protected credential backend can be established
- **WHEN** it attempts to discover or authenticate to the local runtime
- **THEN** the connection remains unauthorized with an actionable safe error, no plaintext credential is created or exposed to the renderer, and no anonymous or direct-access fallback is attempted

### Requirement: Durable handoff and polling-first client contract
The blueprint MUST separate request lifetime and desktop lifecycle from run execution by committing run identity and recoverable work intent before returning submission success. The MVP desktop SHALL obtain state and committed ordered events through finite retrieval requests with cursor-based polling; streaming MAY be a later projection but MUST NOT be required for correctness. The OpenAPI contract MUST remain the source for the generated TypeScript local-runtime client; generation MUST use an explicit public-schema allowlist that excludes scorer-only schemas, and generated artifacts MUST be checked for drift rather than edited manually.

#### Scenario: Client disconnects after submission
- **GIVEN** the API committed a successful Judge submission and the client disconnects before its next status request
- **WHEN** the client or a newly generated compatible client later polls by `run_id`
- **THEN** execution and recovery are independent of the original connection and desktop process, and the generated client observes only committed state/events defined by the same OpenAPI contract

### Requirement: Desktop/runtime discovery and compatibility handshake
Before ordinary resource calls, the blueprint MUST define runtime discovery, health and compatibility behavior including local endpoint identity, runtime/API version, canonical contract digest, build version and supported capability set. An incompatible contract or major version MUST fail closed with an actionable restart/update state and MUST NOT permit a fallback to direct database, provider, filesystem-tool or scorer access.

#### Scenario: Desktop finds an incompatible daemon
- **GIVEN** a desktop build whose expected API version or contract digest is incompatible with the discovered local daemon
- **WHEN** the connection handshake runs
- **THEN** submission and mutation controls remain disabled, the user receives a safe version-specific recovery action, and neither side bypasses the canonical local-runtime contract

### Requirement: UI-independent run and process lifecycle
Closing, crashing, disconnecting or restarting the desktop MUST NOT implicitly cancel an accepted run or erase execution authority. Daemon and worker recovery SHALL derive from PostgreSQL state, work records, claims, versions, budgets and committed events. Runtime shutdown, update and run cancellation MUST be explicit control-plane operations with documented safe boundaries; desktop caches and notifications MUST remain non-authoritative projections.

#### Scenario: Desktop closes during a running Judge job
- **GIVEN** a run has committed work and the desktop process terminates
- **WHEN** the desktop later reconnects or a compatible desktop instance opens the run
- **THEN** the runtime continues or recovers according to committed state, the desktop reconstructs the view through polling, and window closure alone produces neither cancellation nor a duplicate run

### Requirement: Native-host-independent supervision and coordinated update
The blueprint MUST require the native desktop host to discover, start or attach to a supervised or detached local runtime whose lifetime is not owned by a renderer window or an ordinary host child-process handle. Desktop and runtime releases SHALL use signed artifacts, an explicit compatibility manifest, active-work preflight, database-migration compatibility, and defined rollback behavior. An update MUST either reject while work is active or complete an explicitly confirmed `quiesce_then_stop` flow at safe worker boundaries; closing the desktop, installing only one incompatible component, or losing the updater process MUST NOT silently cancel work or erase committed state.

#### Scenario: Desktop exits after starting the runtime
- **GIVEN** the native host started or attached to a compatible runtime and a Judge run has committed recoverable work
- **WHEN** every desktop window and the native host process exit
- **THEN** the runtime continues or recovers under its independent lifecycle, the run remains PostgreSQL-authoritative, and a later compatible desktop can rediscover it without creating a duplicate run

#### Scenario: Coordinated update is requested while work is active
- **GIVEN** a signed desktop/runtime update is available while one or more runs have active or ambiguous work
- **WHEN** the operator requests installation
- **THEN** the blueprint requires an active-work summary and either a safe rejection or explicit quiesce flow, preserves ambiguous paid-attempt evidence, verifies post-update compatibility before enabling mutation, and defines rollback without treating window closure as cancellation

### Requirement: Desktop is a generated-client-only consumer
The blueprint MUST prohibit the desktop renderer and native shell from importing Python runtime internals, opening runtime/scorer databases, invoking model providers, executing Judge tools, resolving provider or ground-truth credentials, or fabricating authoritative events. Repository selection and OS integration MAY enter through explicit local-runtime requests, but all validation, authorization, snapshotting and execution remain runtime responsibilities.

#### Scenario: Desktop feature requests direct runtime authority
- **GIVEN** a proposed desktop feature that calls a provider SDK, reads PostgreSQL, dispatches a source tool or resolves a ground-truth label directly
- **WHEN** its dependency path is reviewed
- **THEN** the feature is rejected or redesigned as a versioned local-runtime API operation implemented by the owning runtime capability, with scorer-only data remaining unavailable

### Requirement: Ephemeral local source-registration contract
The local API blueprint MUST define source registration as a separate control-plane operation before Judge submission. A native picker-selected host path SHALL be classified as sensitive ephemeral request input; the `source_access` capability SHALL canonicalize, authorize, snapshot and digest it, and the successful response SHALL expose only an opaque `source_snapshot_id`, immutable revision, tree digest and safe status. Raw host paths MUST NOT appear in run requests, run/event responses, ordinary logs, idempotency digests shared with experiments, provider traffic or generated trace exports.

#### Scenario: Desktop registers and submits a selected repository
- **GIVEN** the native shell has selected a local repository and no source snapshot exists yet
- **WHEN** the generated client registers the path and later submits a Judge run
- **THEN** registration returns a verified opaque snapshot reference, submission accepts only that reference, and every later API/example payload omits the raw host path
