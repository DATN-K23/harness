# Sprint 9 Judge API MVP — Implementation Plan

> **Execution:** Use Superpowers `executing-plans` inline and `test-driven-development`. For every behavior task: write one focused failing test, run it and confirm the expected failure, implement the minimum, rerun the test and owning package suite. Do not implement beyond the acceptance requirements below.

**Goal:** Expose the existing Judge runtime through a local asynchronous API that durably accepts a finding/snapshot, dispatches recoverable work, and lets the application safely retrieve run state, events, and verdict.

**Architecture:** `@harness/server` owns transport, local authentication, validation and safe projections. Run admission, idempotency, durable handoff, cancellation, claims and terminal writes remain in the runtime/core persistence boundary; `JudgeRunner` remains the only Judge orchestrator. No in-process-only job dispatch and no insecure authentication fallback.

**Tech stack:** Existing TypeScript/Bun/Turborepo workspace, Zod, Drizzle/PostgreSQL, existing core/protocol ports; no HTTP dependency until native Bun server proves insufficient.

**Keychain implementation choice (approved):** Use a minimal Swift helper with macOS Security.framework generic-password entries. The Bun bridge sends secret bytes only through stdin/stdout, never process arguments/environment/files; keep the credential in memory, and fail closed on non-macOS or any Keychain error. No UI/full desktop shell is added.

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

- Protected OS credential/rendezvous facility absent: startup must fail closed; Task 6 tests this, implementation pauses for a security decision if no approved facility exists.
- Transaction failure during admission/terminal commit: no success response or partial terminal aggregate; Tasks 2 and 11.
- Crash after provider returned but before response commit: preserve ambiguous attempt and do not silently spend again; Task 4.
- Untrusted nested payload or cross-run cursor: reject with no model call/data leak; Tasks 1 and 9.
- Duplicate delivery, stale worker and cancellation racing terminal write: one authoritative CAS result; Tasks 4, 10 and 11.

## File Map (expected; refine only by tests/code evidence)

- `packages/protocol/src/ports.ts`, `events.ts`: stable public operation/request/result contracts only if missing.
- `packages/core/src/runner/*`, `packages/core/src/testing/*`: admission/cancellation/work use cases and deterministic fakes at capability boundary.
- `packages/schema/src/db/schema.ts`, migrations, `packages/schema/src/store/*`: durable run admission, idempotency, outbox/work, cursor query and atomic terminal writes.
- `packages/server/src/*`: local API handler, auth/discovery/compatibility and runtime composition.
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
- [x] **2.3 RED/GREEN:** Store-level same key/same digest replays the original run ID; changed digest conflicts without creating another run/outbox and preserves original binding. Focused schema tests and package suite pass. Request canonicalization, missing-key HTTP contract and concurrent submission race are verified at the application boundary in Task 5.1.
- [x] **2.4 GREEN:** Admission test confirms run record persists the accepted snapshot ID and immutable config alongside finding ID, idempotency binding and outbox. Snapshot existence/authorization is checked at the trusted application boundary in Task 5.1 before store admission.

### Task 3: Durable outbox handoff and recovery

- [x] **3.1 RED/GREEN:** Tests verify committed pending work is retrievable, claim transitions pending→claimed once under concurrent publishers, expired claim can be reclaimed, publication is one-way/idempotent, and pending query hides published work. PostgreSQL schema tests, migration, and schema package suite pass. Transactional commit-before-outbox is verified by Task 2 rollback/admission tests.
- [ ] **3.2 RED/GREEN:** Test duplicate work delivery results in one active claim, lease takeover works, and stale worker cannot append/transition. Reuse `RunStorePort` contract suite; add only missing durable operations and pass in-memory + Postgres conformance.
- [ ] **3.3 RED/GREEN:** Test restart recovers accepted work and never silently replays provider attempt with ambiguous outcome. Integrate existing hydration/attempt ledger; focused recovery tests and core/schema suites pass.

### Task 4: Local API authentication, discovery and handshake

- [x] **4.1 RED/GREEN (helper only):** Added tests for loopback host allowlist and credential decision helper, observed RED before module existed, then GREEN after adapting constant-time auth comparison from upstream `ServerAuth.authorized`. This does not yet prove actual listener binding or middleware enforcement; route/startup integration remains open.
- [x] **4.2 Decision gate:** Team confirmed macOS Keychain through the native host as credential custody. API/server must receive the resolved credential only through an injected native-host boundary; do not add renderer access, plaintext files, anonymous fallback or token-in-URL.
- [x] **4.3 RED/GREEN:** Added Swift Security.framework generic-password helper and Bun bridge. Tests verify create-once/read-existing/rotate, exact credential travels through stdin (never argv), unsupported OS and Keychain errors fail closed, and a real uniquely named Keychain item can be read/rotated/removed. `swiftc -typecheck` and macOS integration test pass. Server exports provider for trusted startup composition.
- [ ] **4.4 RED/GREEN:** Test health/discovery reports endpoint identity, API/runtime versions, contract digest, build and capabilities; incompatible major/digest blocks mutations and returns actionable safe error. Implement handshake and run server tests.

### Task 5: Submission API and work dispatch

- [ ] **5.1 RED:** Test `POST` valid finding + snapshot commits admission before returning `202` with stable run ID/status URL; invalid payload/snapshot does not create work. Implement route calling admission operation (never adapter-specific `seedRun`) and run server tests.
- [ ] **5.2 RED/GREEN:** Test dispatch carries only stable run ID, worker claims from durable store and invokes existing `JudgeRunner`; client disconnect does not cancel. Implement worker composition and pass server/core tests.
- [ ] **5.3 RED/GREEN:** Test dispatch failure leaves recoverable work and cannot fabricate invalid verdict. Implement error mapping/republication behavior and run server/core/schema suites.

### Task 6: Safe run and event retrieval

- [ ] **6.1 RED:** Test each run state maps to safe projection; omit claim/lease/config secrets and prohibit presenting partial verdict as final. Implement GET run projection and pass API tests.
- [ ] **6.2 RED:** Test finite event pages ordered by committed sequence and cursor signing/binding to run, sequence and page policy; tampered, malformed, expired-policy and cross-run cursors fail safely. Implement cursor codec and DB query; run focused server/schema tests.
- [ ] **6.3 RED/GREEN:** Test unknown run returns `404`, no event sequence gap is fabricated, and polling after latest committed event returns empty page with documented cursor semantics. Run focused API/schema tests.

### Task 7: Durable cancellation and lifecycle

- [ ] **7.1 RED:** Test cancellation request is durable/idempotent for accepted/queued work and prevents claim/start. Implement control operation and pass core/schema tests.
- [ ] **7.2 RED/GREEN:** Test running cancellation is observed at provider/tool boundaries, preserves earlier events, and terminal run cancellation is no-op. Integrate existing `CancellationPort`/`JudgeRunner`; pass core lifecycle tests.
- [ ] **7.3 RED/GREEN:** Test cancellation racing completion has one CAS winner and never rewrites terminal result. Run in-memory + Postgres conformance tests.

### Task 8: Terminal result and error semantics

- [ ] **8.1 RED:** Test reasoning-only successful result is `unverified` / `UNVERIFIED` and evidence is snapshot-resolved; preserve existing schema and pass verdict/runner tests.
- [ ] **8.2 RED/GREEN:** Test provider/runtime failure yields failed execution state/error and no `invalid` verdict; run core/server tests.
- [ ] **8.3 RED/GREEN:** Inject terminal transaction failure and assert verdict/evidence, usage, terminal event and state are all-or-nothing; run schema/core persistence suites.

### Task 9: End-to-end integration and release gates

- [ ] **9.1 RED/GREEN:** Add deterministic end-to-end test: register snapshot → submit → transactionally accept/outbox → claim work → scripted `JudgeRunner` → poll run/events → observe safe `unverified` verdict. Run test red first, then implementation and all directly affected package suites.
- [ ] **9.2 RED/GREEN:** Add Postgres integration tests for migration from empty/current schema, transaction rollback, duplicate admission/delivery, cursor paging, cancellation and terminal atomicity; skip only when `checkPostgresReachable` fails.
- [ ] **9.3 VERIFY:** Run `bun turbo typecheck` and `bunx turbo test`; expected exit 0. Do not mark earlier tasks complete based only on this final run.
- [ ] **9.4 DOC:** Document local startup/auth prerequisites and API examples; update `docs/core-team-timeline.md` status only when acceptance tests pass. Verify documented commands against actual implementation.

## Execution ledger expectations

Use the plan-specific workspace under `.superpowers/sdd/2026-10-21-sprint-09-judge-api-mvp/`. Record baseline, each RED failure, GREEN result, test command and any ruling. If the security decision gate blocks, stop with completed-task count and exact missing approved platform capability.

## Self-review

- All acceptance requirements A1–A5 map to task groups 1–8; durable handoff/recovery is explicit, not an in-process shortcut.
- Security, persistence, API, worker, cancellation and terminal concerns are separate task groups with tests owned by their package.
- The only implementation decision deliberately unresolved is approved protected credential/rendezvous facility; it is a blocking security decision, not an assumption.
- Tests cover prohibited payloads, snapshot failures, idempotency conflicts/concurrency, outbox crash windows, ambiguous paid attempt, public bind/auth failures, cursor tampering/cross-run access, cancellation races, unverified verdicts and atomic terminal commit.
