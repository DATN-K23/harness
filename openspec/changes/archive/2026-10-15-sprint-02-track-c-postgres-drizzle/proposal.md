# Proposal

## Why

Sprint 2 establishes the minimal end-to-end real execution loop: submitting a prompt, calling a real model gateway, persisting the run and trajectory events, and querying the results across process restarts. Currently, runs and events are stored only in volatile in-memory maps (`InMemoryRunStore`), meaning all execution history is lost when the process terminates.

To fulfill Track C (Dev C) of Sprint 2 (`docs/sprint-02-gap-analysis.md` §4.3 and `docs/sprint-02.md`), we must implement the real persistence infrastructure in `@harness/schema`. This serves research questions RQ1 and RQ3 by providing immutable, reproducible, and queryable relational storage for model execution baselines, token expenditures, and trajectory events, backed by PostgreSQL and Drizzle ORM.

## What Changes

- **Prioritize OpenCode code and pattern reuse (ADR-008)**: Adapt schema organization, identifier generation, and migration patterns from OpenCode (`3f393d78bf`, MIT License) with explicit file attribution headers and root `NOTICE` entries.
- **Configure PostgreSQL and Drizzle in `@harness/schema`**:
  - Install and configure `drizzle-orm`, `drizzle-kit`, and PostgreSQL driver (`postgres`).
  - Configure `drizzle.config.ts` targeting PostgreSQL with connection URL from environment variables.
  - Add database migration scripts (`db:generate`, `db:migrate`) to `packages/schema/package.json` and expose root script `db:migrate`.
- **Implement Drizzle Relational Schema**:
  - `runs`: Stores run metadata, prompt, technical lifecycle state (`pending`, `running`, `completed`, `failed`), model profile, result content, error details, token usage, cost USD, latency, timestamps, and optimistic concurrency version.
  - `events`: Stores append-only trajectory events with `(run_id, sequence)` uniqueness, event type, JSONB payload, payload digest, and timestamp.
  - `model_attempts`: Stores individual provider invocation attempts, sanitized request/response payloads (secrets stripped), finish reasons, token usage breakdown, cost USD, and latency.
- **Implement `PostgresRunStore` Adapter**:
  - Implement `RunStorePort` from `@harness/protocol` (`claim`, `appendEvent`, `transition`, `loadRun`, `loadEvents`).
  - Guarantee Compare-and-Set (CAS) atomic concurrency transitions and sequence-ordered event insertion.
  - Implement lease management with expiration for distributed worker claims.
- **Contract Conformance & Verification**:
  - Verify `PostgresRunStore` against the canonical conformance test suite `runStoreContractTests` from `@harness/core/testing`.
  - Provide an automated test harness for PostgreSQL persistence in `packages/schema/test/`.
- **Security & Data Sanitization**:
  - Guarantee zero credential or API key leakage into the database; sanitize all request, response, and event payloads before writing.
- **Research controls & scope discipline**:
  - *Research Question Served*: RQ1 & RQ3 (reproducible baseline persistence, precise cost/token audit, tamper-evident trajectory history).
  - *Explicit Non-Goals*: Multi-turn Judge stage persistence, PoC storage, and finding sanitizer tables (deferred to Sprint 7–8); real provider API calls (Track D); CLI presentation formatting (Track A); ground-truth adjudication scoring (strictly isolated).
  - *Non-negotiable Controls*: Strict isolation of ground truth, immutable sequence numbering for events, CAS concurrency enforcement, zero secret persistence.

## Capabilities

### New Capabilities
<!-- None. Relational persistence is governed by the existing trajectory-persistence capability. -->

### Modified Capabilities
- `trajectory-persistence`: Implement concrete PostgreSQL and Drizzle ORM schema, migration pipelines, and the `PostgresRunStore` adapter satisfying `RunStorePort` and passing `runStoreContractTests`.

## Impact

- **Affected Packages**:
  - `packages/schema`: Add Drizzle schema definitions (`src/db/schema.ts`), database client connection (`src/db/client.ts`), `PostgresRunStore` adapter (`src/store/postgres-run-store.ts`), `drizzle.config.ts`, migration files, and exports in `src/index.ts`.
  - `packages/schema/package.json`: Add dependencies (`drizzle-orm`, `postgres`, `drizzle-kit`).
  - `package.json`: Add `"db:migrate"` script delegating to `packages/schema`.
  - `packages/cli`: Enable CLI commands (`run.ts`, `view.ts`) to optionally inject `PostgresRunStore` when `DATABASE_URL` is configured.
  - `docs/sprint-02-gap-analysis.md`: Update Track C checklist and progress status upon completion.
  - Root `NOTICE`: Add attribution entries for any adapted schema and migration helper files.
- **APIs & Dependencies**: Introduces `drizzle-orm`, `postgres`, and `drizzle-kit`. No breaking changes to `@harness/protocol` or `@harness/core`.
