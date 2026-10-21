# Sprint 9 Judge API MVP — Implementation Plan

> **Execution:** Use Superpowers `executing-plans` inline and `test-driven-development`. For every behavior task: write one focused failing test, run it and confirm the expected failure, implement the minimum, rerun the test and owning package suite. Do not implement beyond the acceptance requirements below.

**Goal:** Expose the existing Judge runtime through a local asynchronous API that durably accepts a finding/snapshot, dispatches recoverable work, and lets the application safely retrieve run state, events, and verdict.

**Architecture:** `@harness/server` owns transport, local authentication, validation and safe projections. Run admission, idempotency, durable handoff, cancellation, claims and terminal writes remain in the runtime/core persistence boundary; `JudgeRunner` remains the only Judge orchestrator. No in-process-only job dispatch and no insecure authentication fallback.

**Tech stack:** Existing TypeScript/Bun/Turborepo workspace, Zod, Drizzle/PostgreSQL, existing core/protocol ports; no HTTP dependency until native Bun server proves insufficient.

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
- `packages/cli/src/*`: serve/start composition only; ordinary commands consume runtime API if required by established architecture.
- Tests stay alongside owners in `packages/{protocol,core,schema,server,cli}/test`.

## Tasks (dependency order)

### Task 1: Request boundary and ground-truth isolation

- [ ] **1.1 RED:** Add a protocol/server test that nested `GroundTruthLabel`, adjudication/report/scoring, credentials and raw host-path fields are rejected before service invocation. Run `bun test <test-file>` and confirm failure because the request decoder/API is absent.
- [ ] **1.2 GREEN:** Implement the smallest Zod request decoder using existing `CandidateFinding` contract; reject unknown/prohibited keys recursively and enforce non-empty/bounded report and snapshot ID. Verify the focused test and `bun run --cwd packages/protocol test`.
- [ ] **1.3 RED/GREEN:** Add malformed JSON, wrong types, empty finding, excessive body and unknown-field tests; run red, implement bounded safe `400` error envelope in API, rerun focused and server package tests.

### Task 2: Atomic run admission and idempotency

- [ ] **2.1 RED:** Add schema-store test that admission atomically persists run, immutable config, idempotency binding and outbox item; inject failure at each write and assert none are partially visible. Run the focused test and observe expected missing-operation failure.
- [ ] **2.2 GREEN:** Add the narrow run-control admission port/operation and PostgreSQL transaction/migration; preserve existing CAS/claim semantics. Run focused store tests and `bun run --cwd packages/schema test`.
- [ ] **2.3 RED/GREEN:** Test same key/same canonical digest returns same run ID, changed digest conflicts, missing key behavior follows existing API contract, and concurrent duplicate submissions create one run. Implement digest/idempotency logic; run focused tests and store suite.
- [ ] **2.4 RED/GREEN:** Test unknown snapshot/config is rejected before commit and accepted snapshot ID/config are frozen in run record; implement resolution at trusted application boundary, run relevant core/schema tests.

### Task 3: Durable outbox handoff and recovery

- [ ] **3.1 RED:** Test publisher does not expose work before admission commit and leaves intent for retry after publication failure. Implement outbox publisher/claim boundary; focused test and schema/core suites pass.
- [ ] **3.2 RED/GREEN:** Test duplicate work delivery results in one active claim, lease takeover works, and stale worker cannot append/transition. Reuse `RunStorePort` contract suite; add only missing durable operations and pass in-memory + Postgres conformance.
- [ ] **3.3 RED/GREEN:** Test restart recovers accepted work and never silently replays provider attempt with ambiguous outcome. Integrate existing hydration/attempt ledger; focused recovery tests and core/schema suites pass.

### Task 4: Local API authentication, discovery and handshake

- [ ] **4.1 RED:** Test server rejects non-loopback/public binding and missing authentication. Run focused server test and confirm failure before implementation.
- [ ] **4.2 Decision gate:** Inspect platform dependencies/code for an approved protected credential store and installation-scoped rendezvous. If none exists, stop and ask the team; do not implement plaintext fallback, anonymous localhost or invent a custody design.
- [ ] **4.3 RED/GREEN:** If an approved backend exists, test credential rotation preserves run IDs, secret never enters URLs/logs/events/exports, and unavailable backend fails closed; implement auth/discovery with injected platform port, run focused server security tests.
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
