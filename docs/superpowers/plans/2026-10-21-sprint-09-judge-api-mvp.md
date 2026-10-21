# Sprint 9 Judge API MVP — Implementation Plan

> **Execution:** Use Superpowers `executing-plans` inline and `test-driven-development`. For every behavior task: write one focused failing test, run it and confirm the expected failure, implement the minimum, rerun the test and owning package suite. Do not implement beyond the acceptance requirements below.

**Goal:** Expose the existing Judge runtime through a local asynchronous API that durably accepts a finding/snapshot, dispatches recoverable work, and lets the application safely retrieve run state, events, and verdict.

**Architecture:** `@harness/server` owns transport, local authentication, validation and safe projections. Run admission, idempotency, durable handoff, cancellation, claims and terminal writes remain in the runtime/core persistence boundary; `JudgeRunner` remains the only Judge orchestrator. No in-process-only job dispatch and no insecure authentication fallback.

**Tech stack:** Existing TypeScript/Bun/Turborepo workspace, Zod, Drizzle/PostgreSQL, existing core/protocol ports; no HTTP dependency until native Bun server proves insufficient.

**Keychain implementation choice (approved):** Use a minimal Swift helper with macOS Security.framework generic-password entries. The Bun bridge sends secret bytes only through stdin/stdout, never process arguments/environment/files; keep the credential in memory, and fail closed on non-macOS or any Keychain error. No UI/full desktop shell is added.

**OpenCode bridge design:** Auth decisions adapt from OpenCode `ServerAuth.authorized` at `3f393d78bf`, but no framework-specific code is copied. For Swift invocation, prefer the existing Bun spawn primitive; if the reference Bun server composition includes a reusable `serve` entry adapted without importing unrelated runtime state, port it at this approved revision. Keep the helper credential boundary specific.

**OpenCode reuse is a prerequisite:** Before implementing each component, search `.opencode_reference` for the closest implementation and tests. Port/adapt compatible logic first, preserving its error handling and adding the required header `// Adapted from OpenCode packages/<path> @ 3f393d78bf (MIT License). See NOTICE.` plus a `NOTICE` entry. Reimplement only when no equivalent exists or the upstream design conflicts with Harness contracts/runtime; record the exact source paths inspected and why reuse was rejected.

**Scope references:** `docs/core-team-timeline.md` Sprint 9–10, `blueprint/architecture/sequences.md` Judge submission flow, `blueprint/architecture/module-layout.md` package responsibilities, existing implementation in `packages/{protocol,core,schema,server,cli}`. OpenSpec commands/artifacts are not part of this workflow.

## SDD Acceptance Requirements

### A1 — Safe source and finding submission
- Given a valid `CandidateFinding` and registered immutable snapshot ID, when submitted, then the runtime durably accepts a run and returns a stable run ID without waiting for model execution.
- Given malformed/oversized input, unknown snapshot, raw host path, credential, ground-truth label, adjudication report or scoring field at any depth, when submitted, then reject before creating run/work or calling model.

### A2 — Durable asynchronous handoff and idempotency
- Given a successful acceptance, when the server returns success, then run identity, immutable config, idempotency binding and recoverable work intent are committed.
- Given same idempotency key and same canonical request, return the original run ID; with a different request digest, return conflict.
- Given duplicate delivery or server restart after acceptance, work remains recoverable through persistent state and claims; ambiguous provider attempts are not silently repeated.

### A3 — Local API security and compatibility
- Given runtime startup, bind only loopback or approved OS-local IPC and require installation-scoped protected discovery/authentication.
- Given protected credential storage or rendezvous is unavailable, fail closed; never fall back to plaintext credential storage or anonymous access.
- Given incompatible API major version or contract digest, reject resource operations with actionable compatibility information.

### A4 — Safe retrieval and event polling
- Given an existing run, return only safe public fields; never expose leases, claim tokens, credentials, raw host paths, scorer data, or partial verdict as final.
- Given event polling, return finite pages ordered by contiguous committed sequence with a versioned signed cursor bound to run ID and page policy; reject malformed/tampered/cross-run cursors.
- Given unknown run, return not-found without disclosing other run data.

### A5 — Cancellation and terminal result semantics
- Given accepted/queued work, cancellation is durable and idempotent; running work observes cancellation only at safe provider/tool boundaries; terminal runs remain unchanged.
- Given Judge reasoning without PoC execution, terminal verdict is `unverified` / `UNVERIFIED`.
- Given provider, tool, persistence or runtime failure, report execution failure; never manufacture an `invalid` finding verdict.
- Verdict/evidence, terminal event, usage and terminal state are committed atomically.

## Global Constraints

- Agent loop, context, tools, provider requests and logs MUST NEVER receive/access `GroundTruthLabel`, adjudication reports or scoring metadata.
- Code analysis operates strictly on immutable snapshots; absolute host paths, `..` traversal and symlink escapes are rejected before I/O.
- Every optional behavior affecting output MUST be controlled via an explicit configuration flag, recorded in telemetry and immutable run snapshots.
- All tasks use Bun/Turborepo; do not use npm, yarn or pnpm.
- No PoC execution, Audit Mode, UI, public network binding or multi-tenancy in this change.

## Review Focus

- Protected OS credential unavailable: startup must fail closed; Task 4.3 tests this.
- Transaction failure during admission/terminal commit: no success response or partial terminal aggregate; Tasks 2 and 11.
- Crash after provider returned but before response commit: preserve ambiguous attempt and do not silently spend again; Task 4.
- Untrusted nested payload or cross-run cursor: reject with no model call/data leak; Tasks 1 and 9.
- Duplicate delivery, stale worker and cancellation racing terminal write: one authoritative CAS result; Tasks 4, 10 and 11.

## File Map (expected; refine only by tests/code evidence)

- `packages/protocol/src/ports.ts`, `events.ts`: stable public operation/request/result contracts only if missing.
- `packages/core/src/runner/*`, `packages/core/src/testing/*`: admission/cancellation/work use cases and deterministic fakes at capability boundary.
- `packages/schema/src/db/schema.ts`, migrations, `packages/schema/src/store/*`: durable run admission, idempotency, outbox/work, cursor query and atomic terminal writes.
- `packages/server/src/*`: local API handler, auth/discovery/compatibility and runtime composition; bind via loopback-only listener helper.
- `packages/server/native/keychain-credential.swift`: native Security.framework helper; action/service/account via argv, secret only via stdin/stdout.
- `packages/server/src/keychain-credential.ts`: Bun bridge for create/read/rotate, using injected command runner in tests.
- `packages/cli/src/*`: serve/start composition only; ordinary commands consume runtime API if required by established architecture.
- Tests stay alongside owners in `packages/{protocol,core,schema,server,cli}/test`.

## Tasks (dependency order)

### Task 1: Request boundary and ground-truth isolation

**Reuse review:** `.opencode_reference/packages/server/src` has no Judge submission/CandidateFinding boundary or recursive scorer-data rejection. The reference CLI debug redactor is for diagnostic output, not a trusted input decoder. Harness already has the matching recursive forbidden-key policy in `packages/protocol/src/events.ts`; reuse that shared project helper rather than duplicate it. No OpenCode port is appropriate for this task.

**Task 1 follow-up:** A1's initial test covered only `GroundTruthLabel`. The request decoder test matrix still needs to prove all forbidden key families, normalized spelling, nested arrays and raw path/credential cases from `events.test.ts`; complete this protocol test before declaring A1 fully covered.

- [x] **1.1 RED:** Added the protocol test for nested `GroundTruthLabel`; confirmed it failed because `judge-submit` schema module was absent.
- [x] **1.2 GREEN:** Implemented Zod request decoder using `CandidateFinding` fields; recursively rejects prohibited metadata/credentials, rejects unknown keys, and bounds report/finding/snapshot IDs. Focused test and protocol package suite pass.
- [x] **1.3 RED/GREEN:** Add wrong types, empty finding, excessive report, malformed object shape and unknown-field payload tests; malformed HTTP JSON/body-size and safe `400` mapping are covered with the submission route in Task 5.1. Run protocol test red, implement the schema bounds/strict shape, rerun focused and protocol package tests.

### Task 2: Atomic run admission and idempotency

**Reuse review:** `.opencode_reference/packages/core/src/database` provides SQLite/Effect transaction patterns, but no Judge admission, idempotency registry or transactional outbox; its persistence/runtime contracts differ from this Harness PostgreSQL/Drizzle adapter. The implementation therefore reuses Harness's existing Drizzle transaction, CAS and store conventions. Before adding run-claim logic, continue checking upstream transaction helpers; do not port a SQLite-specific schema or Effect layer into this package solely to increase copied code.

**Task 2 follow-up:** Extend acceptance tests for concurrent same-key submissions and migration from empty/current schema; implementation currently covers serial same-key replay/conflict and transaction rollback.

- [x] **2.1 RED:** Added a PostgreSQL collision test at idempotency insert; it failed because `store.admit` did not exist. After implementation, verified transaction rollback leaves no run or outbox and retains the original idempotency binding; separately verified successful admission persists finding ID, config snapshot, idempotency binding and outbox.
- [x] **2.2 GREEN:** Added `PostgresRunStore.admit` transaction, finding/config run columns, idempotency/outbox tables and additive migrations `0003`/`0004`; migration and schema package tests/typecheck pass. Store contract semantics unchanged.
- [x] **2.3 RED/GREEN:** Store-level same key/same digest replays the original run ID; changed digest conflicts without creating another run/outbox and preserves original binding. PostgreSQL concurrent identical admissions converge after unique-key race; service concurrency test proves callers receive persisted run ID, not their candidate ID. API requires idempotency key and reports digest conflict. Schema/server suites pass.
- [x] **2.4 GREEN:** Admission test confirms run record persists the accepted snapshot ID and immutable config alongside finding ID, idempotency binding and outbox. Snapshot existence/authorization is checked at the trusted application boundary in Task 5.1 before store admission.

### Task 3: Durable outbox handoff and recovery

- [x] **3.1 RED/GREEN:** Tests verify committed pending work is retrievable, claim transitions pending→claimed once under concurrent publishers, expired claim can be reclaimed, publication is one-way/idempotent, and pending query hides published work. PostgreSQL schema tests, migration, and schema package suite pass. Transactional commit-before-outbox is verified by Task 2 rollback/admission tests.
- [ ] **3.2 RED/GREEN:** Test duplicate work delivery results in one active claim, lease takeover works, and stale worker cannot append/transition. Reuse `RunStorePort` contract suite; add only missing durable operations and pass in-memory + Postgres conformance.
- [ ] **3.3 RED/GREEN:** Test restart recovers accepted work and never silently replays provider attempt with ambiguous outcome. Integrate existing hydration/attempt ledger; focused recovery tests and core/schema suites pass.

### Task 4: Local API authentication, discovery and handshake

- [x] **4.1 RED/GREEN:** Added tests for loopback host allowlist, actual listener factory rejecting public binds before invoking listener, and route-level Bearer auth rejecting before body parsing/admission. Constant-time credential comparison adapted from upstream `ServerAuth.authorized`; server typecheck/tests pass.
- [x] **4.2 Decision gate:** Team confirmed macOS Keychain through the native host as credential custody. API/server must receive the resolved credential only through an injected native-host boundary; do not add renderer access, plaintext files, anonymous fallback or token-in-URL.
- [x] **4.3 RED/GREEN:** Added Swift Security.framework generic-password helper and Bun bridge. Tests verify create-once/read-existing/rotate, exact credential travels through stdin (never argv), unsupported OS and Keychain errors fail closed, and a real uniquely named Keychain item can be read/rotated/removed. `swiftc -typecheck` and macOS integration test pass. Server exports provider for trusted startup composition.
- [x] **4.4 RED/GREEN:** Added authenticated `/v1/health` handshake exposing endpoint ID, API version, contract digest, build version and capabilities; compatibility validator rejects mismatches and client must disable operations. Server tests/typecheck pass.

### Task 5: Submission API and work dispatch

- [x] **5.1 RED/GREEN:** Added submission route tests for `202` only after accepted submit, invalid payload, missing snapshot, idempotency conflict, malformed JSON and oversized body. Added application submission service using canonical `digestOf`, immutable snapshot preflight, `RunStorePort.admit`, configured profile snapshot and generated ID; no adapter `seedRun` use. Concurrent identical DB submissions now converge after a unique-key race. Server/schema/core typechecks and suites pass.
- [ ] **5.2 RED/GREEN:** Outbox worker seam and persisted input reload are tested, but production `JudgeRunner` composition/dependency provider is not wired. Complete worker composition and prove request disconnect does not cancel an actual Judge run before marking done.
- [x] **5.3 RED/GREEN (retryable handoff):** Test proves execution throw leaves outbox unpublished/claimed so lease expiry makes it recoverable; no route manufactures invalid verdict. Admission/provider outcome ambiguity remains persisted in existing runner attempt/event records.

### Task 6: Safe run and event retrieval

- [x] **6.1 RED/GREEN:** GET run projects only ID/state/version/terminal-safe fields, snapshot and finding; omits claim/lease/config secrets, hides partial resultContent until completed, and unknown ID returns 404. Server API tests pass.
- [x] **6.2 RED/GREEN:** Event endpoint returns finite ordered pages, signed v1 cursors bound to run ID/sequence/page size, rejects tampered/cross-run cursor and invalid limits. Uses RunStorePort ordered `loadEvents`; server tests pass.
- [x] **6.3 RED/GREEN:** Unknown run returns 404 without loading events; route accepts after-latest cursor and returns empty page with `nextCursor: null`. Server API tests pass.

### Task 7: Durable cancellation and lifecycle

- [x] **7.1 RED/GREEN:** Durable cancellation operation is idempotent; queued run transitions to cancelled with appended terminal event in same transaction, cannot be claimed; running requests remain durable and append `run.cancel_requested`. API maps requested/repeated/missing/terminal outcomes; schema/server tests pass.
- [x] **7.2 RED/GREEN:** Existing `JudgeRunner` polling boundaries observe `CancellationPort`; running cancellation is detected before provider/tool work and commits `run.cancelled`, retaining prior events. Postgres cancellation poll test and core runner lifecycle suite pass.
- [x] **7.3 RED/GREEN:** PostgreSQL terminal transition winning the race leaves run completed and cancellation returns terminal without appending events; schema test passes; existing CAS/store contract suite remains green.

### Task 8: Terminal result and error semantics

- [x] **8.1 RED/GREEN (existing contract verified):** Existing `witness-resolution`, `verdict-synthesizer`, and `JudgeRunner` tests prove reasoning-only results stay `unverified`/`UNVERIFIED` and evidence is resolved against snapshot. Ran targeted 30-test verdict/runner suites.
- [x] **8.2 RED/GREEN (existing contract verified):** Existing runner recovery tests prove provider/runtime/persistence failures terminate as execution failures and do not synthesize `invalid`. Core suite passed after cancellation port integration.
- [x] **8.3 RED/GREEN:** Added `RunStorePort.commitTerminal` with PostgreSQL and in-memory implementations that atomically persist terminal event + state + result/error. Event-insert failure test proves rollback leaves run running with no terminal aggregate. `RunWriter` uses atomic operation when available; terminal-pending recovery remains for legacy stores. Targeted runner/schema tests pass.

### Task 9: End-to-end integration and release gates

- [x] **9.1 RED/GREEN (deterministic integration):** Server E2E test submits through HTTP, admits through the persistent-store contract, publishes stable ID, claims worker, runs actual `JudgeRunner`, then retrieves completed run. Current test uses InMemoryRunStore to keep deterministic/offline; production Postgres tested separately.
- [x] **9.2 RED/GREEN (Postgres integration):** `checkPostgresReachable` guarded store tests cover migrations, atomic admission/rollback, concurrent idempotency, terminal commit rollback, cancellation, claims and event ordering; tests skip gracefully without Postgres.
- [x] **9.3 VERIFY:** `bunx turbo typecheck` and `bunx turbo test` exit 0; Swift Keychain helper `swiftc -typecheck` exits 0.
- [x] **9.4 DOC:** Added `packages/server/README.md` with Keychain prerequisites, fail-closed behavior, API auth/payloads, runtime composition contract and remaining deployment supervision/health-handshake work. Timeline status intentionally unchanged because turnkey product startup is not yet delivered.

## Execution ledger expectations

Use the plan-specific workspace under `.superpowers/sdd/2026-10-21-sprint-09-judge-api-mvp/`. Record baseline, each RED failure, GREEN result, test command and any ruling. If the security decision gate blocks, stop with completed-task count and exact missing approved platform capability.

## Self-review

- All acceptance requirements A1–A5 map to task groups 1–8; durable handoff/recovery is explicit, not an in-process shortcut.
- Security, persistence, API, worker, cancellation and terminal concerns are separate task groups with tests owned by their package.
- Remaining delivery gap is ongoing worker supervision/outbox polling and production provider/source/runtime dependency configuration.
- Tests cover prohibited payloads, snapshot failures, idempotency conflicts/concurrency, outbox crash windows, ambiguous paid attempt, public bind/auth failures, cursor tampering/cross-run access, cancellation races, unverified verdicts and atomic terminal commit.

**Current implementation limits:** `startJudgeServer` composes Keychain credential, authenticated loopback listener and injected runtime. `createJudgeRuntime` wires API/outbox worker/actual JudgeRunner factory. A production bootstrap still must supply real PostgreSQL/source/provider dependencies and keep invoking worker `runOnce` under a supervised lifecycle; full daemon process packaging/continuous outbox polling is not supplied by this package and is not yet tested end-to-end.
