# Design

## Context

Sprint 2 focuses on establishing the real execution pathway: taking a user prompt, dispatching a model call to a provider, persisting the run and trajectory events in PostgreSQL via Drizzle ORM, and viewing the results across process restarts.

Currently, the monorepo has completed Track A (CLI and environment configuration in `packages/cli`) and Track B (single-turn runner orchestration in `packages/core`). However, all persistence is currently backed only by in-memory fakes (`InMemoryRunStore`), which lose all state upon process restart. `packages/schema` contains only a minimal placeholder (`SCHEMA_VERSION = 1`).

Per **ADR-008** (adopting OpenCode's module structure, conventions, and technology stack as the architectural model), the project prioritizes reusing and adapting proven code patterns, structures, and schemas from the OpenCode repository (`3f393d78bf`, MIT License), porting them to plain TypeScript with attribution headers and root `NOTICE` entries.

See `proposal.md` for background motivation and `specs/trajectory-persistence/spec.md` for requirement contracts.

## Goals / Non-Goals

**Goals:**
- Implement the concrete Drizzle ORM schema for `runs`, `events`, and `model_attempts` in `packages/schema/src/db/schema.ts`.
- Set up PostgreSQL client connection handling with pooling using `postgres` (postgres.js) in `packages/schema/src/db/client.ts`.
- Configure `drizzle.config.ts`, generate initial SQL migrations in `packages/schema/drizzle/`, and provide the `db:migrate` script.
- Implement the `PostgresRunStore` adapter implementing `RunStorePort` (`claim`, `appendEvent`, `transition`, `loadRun`, `loadEvents`) with Compare-and-Set (CAS) atomic concurrency and contiguous sequence guarantees.
- Pass the canonical `runStoreContractTests` conformance test suite from `@harness/core/testing`.
- Guarantee data sanitization (zero secrets, API keys, or raw passwords stored in DB).
- Provide root-level delegated script `db:migrate` in `package.json`.
- Execute via Spec-Driven Development (SDD): delegate implementation sub-tasks to subagents and conduct rigorous main-agent review against contracts and tests.

**Non-Goals:**
- Multi-stage Judge finding sanitization, PoC storage, or sandbox tables (deferred to Sprint 7–8 / Judge mode).
- Storing GroundTruthLabel data, adjudication scoring, or evaluation benchmark labels (strictly prohibited by research controls).
- Real provider HTTP SDK calls (owned by Track D in `packages/llm`).
- CLI interface and prompt formatting (owned by Track A in `packages/cli`).

## Decisions

### Decision 1: PostgreSQL Client and Driver Selection (`postgres` / `postgres.js`)
- **Choice**: Use `postgres` (`postgres.js`) as the underlying database driver with `drizzle-orm/postgres-js`.
- **Rationale**: `postgres.js` is a lightweight, pure-JavaScript/TypeScript driver with exceptional performance on modern JavaScript runtimes (Bun, Node). It requires no native build toolchains (unlike `pg-native`), supports connection pooling out of the box, handles JSON serialization transparently, and has first-class, battle-tested support in Drizzle ORM.
- **Alternatives Considered**:
  - `pg` (`node-postgres`): Widely used, but heavier, requires separate `@types/pg`, and has slightly more boilerplate for type-safe query parameters.
  - Native Bun `SQL` or SQLite: Native Bun SQL lacks mature Drizzle migration support for PostgreSQL dialect, and SQLite does not satisfy the multi-process PostgreSQL persistence requirement of Sprint 2.

### Decision 2: Schema Design and Invariant Constraints
- **Choice**: Define three relational tables in `packages/schema/src/db/schema.ts`:
  1. `runs`:
     - `id`: text primary key (e.g. `run_<nanoid>` or UUID).
     - `prompt`: text.
     - `state`: varchar(32) (`pending`, `running`, `completed`, `failed`).
     - `state_version`: integer default 1 (monotonically incremented on each transition for CAS).
     - `claim_token`: text nullable.
     - `claim_version`: integer default 0.
     - `claim_expires_at`: timestamp with time zone nullable.
     - `model_profile`: varchar(64) nullable.
     - `result_content`: text nullable.
     - `error_message`: text nullable.
     - `terminal_reason`: varchar(64) nullable.
     - `prompt_tokens`: integer nullable.
     - `completion_tokens`: integer nullable.
     - `cost_usd`: numeric(12, 6) nullable.
     - `latency_ms`: integer nullable.
     - `created_at`: timestamp with time zone default now().
     - `updated_at`: timestamp with time zone default now().
  2. `events`:
     - `id`: text primary key (e.g. `evt_<nanoid>`).
     - `run_id`: text not null, foreign key referencing `runs(id)` on delete cascade.
     - `sequence`: integer not null.
     - `event_type`: varchar(64) not null.
     - `schema_version`: integer default 1.
     - `payload`: jsonb not null.
     - `payload_digest`: varchar(128) not null.
     - `occurred_at`: timestamp with time zone not null.
     - **Constraint**: `uniqueIndex("events_run_sequence_idx").on(events.run_id, events.sequence)`.
  3. `model_attempts`:
     - `id`: text primary key.
     - `run_id`: text not null, foreign key referencing `runs(id)`.
     - `attempt_number`: integer not null.
     - `provider`: varchar(64) not null.
     - `model`: varchar(64) not null.
     - `prompt_tokens`: integer not null.
     - `completion_tokens`: integer not null.
     - `total_tokens`: integer not null.
     - `cost_usd`: numeric(12, 6) not null.
     - `latency_ms`: integer not null.
     - `finish_reason`: varchar(32) nullable.
     - `request_json`: jsonb not null.
     - `response_json`: jsonb nullable.
     - `error_message`: text nullable.
     - `error_category`: varchar(64) nullable.
     - `created_at`: timestamp with time zone default now().
- **Rationale**: The composite unique index on `(run_id, sequence)` guarantees that event stream sequence ordering is strictly contiguous and immutable at the database engine level.

### Decision 3: Compare-and-Set (CAS) Concurrency and Lease Expiry in `PostgresRunStore`
- **Choice**: Implement `RunStorePort` operations using atomic SQL statements with optimistic concurrency locks:
  1. `claim({ runId, workerId })`:
     - Check run existence and terminal state.
     - If `claim_expires_at > now()` and claimed by another worker, return `{ kind: "unavailable", reason: "already_claimed" }`.
     - Otherwise, atomically update `claim_token = :token`, `claim_version = claim_version + 1`, `claim_expires_at = now() + :leaseMs` where `id = :runId AND (claim_expires_at IS NULL OR claim_expires_at <= now() OR claim_token = :existingToken)`.
     - Return `{ kind: "claimed", claim, state, stateVersion }`.
  2. `transition({ claim, expectedState, expectedStateVersion, nextState, terminalReason })`:
     - Atomically update:
       ```sql
       UPDATE runs
       SET state = :nextState,
           state_version = state_version + 1,
           terminal_reason = :terminalReason,
           updated_at = NOW()
       WHERE id = :runId
         AND state = :expectedState
         AND state_version = :expectedStateVersion
         AND claim_token = :claimToken
       RETURNING state_version;
       ```
     - If 0 rows updated: inspect current record. If claim token or version mismatch, return `{ kind: "stale", reason: "claim_lost" }`; if state or version mismatch, return `{ kind: "stale", reason: "state_changed" }`.
  3. `appendEvent({ claim, expectedStateVersion, event })`:
     - Run inside a transaction:
       a. Verify run exists, is non-terminal, `claim_token = :claimToken`, and `state_version = :expectedStateVersion`. If not, return `{ kind: "stale", reason }`.
       b. Query `MAX(sequence)` for the run.
       c. Set `sequence = max_sequence + 1`. If caller forced an invalid sequence, abort with error.
       d. Insert into `events` table. Unique index prevents concurrent conflicting sequence writes.
       e. Return `{ kind: "appended", event }`.
- **Rationale**: Matches the exact contract and state machine tested by `runStoreContractTests`.

### Decision 4: Conformance Verification via `runStoreContractTests`
- **Choice**: Create integration tests in `packages/schema/test/postgres-run-store.test.ts` that run `runStoreContractTests(makeHarness)`.
- **Harness Details**:
  - `store`: instance of `PostgresRunStore`.
  - `seedRun(runId, state)`: inserts a row into `runs` with the specified state and `state_version = 1`.
  - `expireLeases()`: updates `runs SET claim_expires_at = NOW() - INTERVAL '1 second'`.
- **Execution Strategy**:
  - Test connects using `DATABASE_URL` (defaulting to `postgresql://harness:harness@localhost:5432/harness_test` or `harness`).
  - Automatically cleans up or uses isolated test run prefixes (e.g. `test-run-...`) to ensure test isolation and idempotency.

### Decision 5: Spec-Driven Development & Subagent Collaboration Pattern
- **Choice**:
  - The implementation will follow the SDD plan:
    1. Subagent executes setup, dependencies, Drizzle schema, and migrations.
    2. Subagent implements `PostgresRunStore` adapter with CAS and sequence logic.
    3. Main agent conducts code review, runs TypeScript typechecks, executes unit & contract tests, and verifies zero secret leakage.
- **Rationale**: Fulfills the user request ("thực hiện theo sdd, subagent thực hiện và agent chính review") while maintaining rigorous verification and architecture compliance.

### Decision 6: Attribution and OpenCode Reuse (ADR-008)
- **Choice**: Reuse patterns from OpenCode:
  - Reuse sortable ID generation logic (`createIdGenerator` from `@harness/core` / OpenCode `packages/schema/src/identifier.ts`).
  - Reuse schema patterns and index conventions.
  - Every file adapted carries the standardized attribution header:
    `// Adapted from OpenCode packages/schema/... @ 3f393d78bf (MIT License). See NOTICE.`
  - Update root `NOTICE` and verify conformance with `packages/core/test/architecture.test.ts`.

## Risks / Trade-offs

- **[Risk: Race condition during concurrent event appends]** → *Mitigation*: The composite unique index on `(run_id, sequence)` guarantees that concurrent attempts to insert identical sequence numbers are rejected at the database level. Event appends are wrapped in transactions that inspect the current sequence and claim state.
- **[Risk: Developer/CI machine lacks a running PostgreSQL instance]** → *Mitigation*: Provide clear Docker startup commands in `docs/environment-setup.md`, and make tests cleanly report connection failures with actionable instructions rather than obscure stack traces.
- **[Risk: Sensitive credentials or API keys stored in JSONB columns]** → *Mitigation*: Implement request/response/payload sanitization in `PostgresRunStore` before any insertion query is executed.
- **[Risk: Clock drift between application and database server]** → *Mitigation*: Injected `ClockPort` is supported for deterministic testing, and SQL queries rely on explicit timestamps or consistent epoch milliseconds to evaluate lease validity.

## Migration Plan

1. In `packages/schema/package.json`: add `drizzle-orm`, `postgres` to `dependencies`, and `drizzle-kit` to `devDependencies`.
2. Configure `drizzle.config.ts` in `packages/schema/`.
3. Create `src/db/schema.ts` with Drizzle table definitions.
4. Run `drizzle-kit generate` to generate the initial migration in `packages/schema/drizzle/`.
5. Implement `packages/schema/src/db/migrate.ts` script for `bun run --cwd packages/schema db:migrate`.
6. Add `"db:migrate": "bun run --cwd packages/schema db:migrate"` to root `package.json`.
7. Implement `PostgresRunStore` and exports in `packages/schema/src/index.ts`.
8. Run `runStoreContractTests` to verify compliance.
