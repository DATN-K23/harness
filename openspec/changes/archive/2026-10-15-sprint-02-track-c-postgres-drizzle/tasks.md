# Tasks

## 1. Setup and Package Configuration

- [x] 1.1 (TV6/Dev C, Sprint 2) Configure `packages/schema/package.json` with dependencies (`drizzle-orm`, `postgres`, `drizzle-kit`), export map, and verify `bun install` resolves dependencies cleanly.
- [x] 1.2 (TV6/Dev C, Sprint 2) Create `packages/schema/drizzle.config.ts` targeting PostgreSQL schema and migrations directory, and verify configuration loads without syntax errors.
- [x] 1.3 (TV6/Dev C, Sprint 2) Add root `"db:migrate"` script to root `package.json` delegating to `packages/schema` and verify script delegation works via `bun run`.

## 2. Relational Schema & Migration Generation

- [x] 2.1 (TV6/Dev C, Sprint 2) Implement relational schema in `packages/schema/src/db/schema.ts` defining `runs`, `events`, and `model_attempts` tables with types, constraints, and composite sequence index, verifying with `bun run --cwd packages/schema typecheck`.
- [x] 2.2 (TV6/Dev C, Sprint 2) Generate the initial SQL migration files in `packages/schema/drizzle/` using `drizzle-kit generate` and verify generated SQL table definitions.
- [x] 2.3 (TV6/Dev C, Sprint 2) Implement migration execution runner in `packages/schema/src/db/migrate.ts` and verify it can connect and execute pending migrations against PostgreSQL.

## 3. PostgresRunStore Implementation & Sanitization

- [x] 3.1 (TV6/Dev C, Sprint 2) Implement database client and connection pool helper in `packages/schema/src/db/client.ts` with OpenCode attribution header and verify connection initialization and close helpers.
- [x] 3.2 (TV6/Dev C, Sprint 2) Implement `PostgresRunStore` in `packages/schema/src/store/postgres-run-store.ts` satisfying `RunStorePort` (`claim`, `appendEvent`, `transition`, `loadRun`, `loadEvents`) with CAS concurrency and secret redaction.
- [x] 3.3 (TV6/Dev C, Sprint 2) Export `PostgresRunStore`, database client, and schema types from `packages/schema/src/index.ts` and verify module exports with `bun run --cwd packages/schema typecheck`.

## 4. Conformance Testing, Architecture & Integration

- [x] 4.1 (TV6/Dev C, Sprint 2) Implement test suite in `packages/schema/test/postgres-run-store.test.ts` running canonical `runStoreContractTests` from `@harness/core/testing` against PostgreSQL and verify all contract assertions pass.
- [x] 4.2 (TV6/Dev C, Sprint 2) Implement secret sanitization tests verifying that sensitive tokens, keys, and connection passwords in attempts or events are never stored in plaintext.
- [x] 4.3 (TV6/Dev C, Sprint 2) Update root `NOTICE` with OpenCode attribution for adapted schema/store files and verify monorepo compliance with `packages/core/test/architecture.test.ts` and `bun typecheck`.
- [x] 4.4 (TV6/Dev C, Sprint 2) Update `docs/sprint-02-gap-analysis.md` Track C section to document implemented status and evidence for Sprint 2 evaluation.
