# SDD ledger — plan: docs/superpowers/plans/2026-10-22-judge-mvp-real-pipeline.md

Plan/spec approved by user. Witness generation disabled; PASS is evidence-validated static or runtime per user decision.

## Preflight scan
| Tasks/files/interfaces | Produces / consumes | Result |
|---|---|---|
| Task 2 ↔ 3 | Task 2 typed execution and evidence outcomes; Task 3 implements IngestionResult/BCE | Compatible; Task 2 should avoid prematurely expanding ingestion result, leave explicit BCE incomplete state to Task 3 |
| Task 3 ↔ 4 | Structured claim/BCE citations consumed by bidirectional validation | Compatible if exact schema and incomplete marker are settled by Task 2/3 |
| Task 4 ↔ 5 | Task 4 routes only submitter PoC to runtime; Task 5 handles policy/sandbox | Compatible; no generated witness |
| Task 5 ↔ 6 | Production adapters composed by runtime | Compatible after Task 1 package/toolchain decision |
| Task 6 ↔ 7 | Production composition exercised through API E2E | Compatible |
| Task 1 self-check | Decision record only, no code/tests | Consistent |
| Task 2 self-check | Protocol/core changes gated by failing tests | Consistent; avoid verdict wire change absent explicit decision |
| Task 3 self-check | Adapter package and fixtures; bounded BCE | Consistent; toolchain choice precedes implementation |
| Task 4 self-check | Existing runner and prompts, source evidence validation | Consistent; runtime branch only when submitter PoC exists |
| Task 5 self-check | Policy and Docker adapter with gated integration | Consistent; security-sensitive Docker execution requires explicit gate |
| Task 6 self-check | Local server composition/startup | Consistent; Keychain remains only credential path |
| Task 7 self-check | E2E and release criteria | Consistent; no full-production claim when integration dependencies skipped |

Ruling: Task 5 introduces real execution of hostile, untrusted PoC inside Docker. This crosses the security-sensitive action boundary and requires user confirmation before enabling/running Docker integration or production execution; safe unit tests and offline adapter development can proceed. Cost if wrong: unsafe code execution or false claim of verified isolation.
Task 1: reviewer P2 noted toolchain/image not fully pinned. Ruling: keep Task 1's explicit BLOCKED status and do not claim selection complete for runtime execution; the design explicitly forbids enabling execution until image/compiler and target isolation are verified, and local evidence was Linux ARM64 while target is macOS. This task delivered a bounded AST profile and reusable-code map; compile/image pin remains a release blocker for Task 5/7, not a reason to fabricate values. Cost if wrong: work may need revisiting when verified target artifacts are available.
Task 1: complete with blocker (commit 6ea6201, research-only; review confirms hard security gate, runtime pin unresolved).
Task 2: fix round 1/5 (2 addressed, 0 open — thrown sandbox errors and bounded/redacted probe evidence; commits 4ba25a8..a4ff5b0).
Task 2: fix round 2/5 (1 addressed, 0 open — cap total state-probe deltas at 32; commits a4ff5b0..1675d32).
Task 2: complete (commits 6ea6201..1675d32, review clean after 2 fix rounds).
Task 3: implementer reports explicit blocker: exact compiler unverified; output remains incomplete and cannot advance as BCE. Review needed against requirement that this is a safe partial deliverable, not falsely complete BCE.
Task 3: fix round 1/5 (2 addressed, 0 open — fenced PoC parsing and contract-scoped source mapping; commits 51ef665..99521ea).
Task 3: fix round 2/5 (1 addressed, 0 new — comment markers in string literals; commits 99521ea..fc89917).
Task 3: fix round 3/5 (1 addressed, 0 open — EOF line comment; commits fc89917..c017ae5).
Task 3: fix round 4/5 (1 addressed, 0 open — PoC runtime gate; commits 2b291bf..3313572).
Task 3: parked at breaker — explicit `enablePocExecution: true` can route PoC to sanitizer/sandbox before target isolation verification. Ruling: core flag is a default-off test seam only; no real adapter exists and no runtime was invoked. Carry as a load-bearing Task 6 requirement: production composition must refuse true until a separately verified/approved isolation capability exists; Task 5 runtime remains blocked meanwhile. Cost if wrong: a future composition could enable hostile PoC prematurely; this is a release blocker, not accepted security behavior.
Task 3: complete with parked P1 (commits 1675d32..3313572; AST BCE implemented, runtime enablement finding carried to Task 6; review has no clean pass).
Task 4: implementer reports focused tests 73 pass and full core 873 pass/4 demo expectation failures. Do not mark complete until review and disposition of failures; no release claim.
Task 4: fix round 1/5 (1 addressed, 0 open — unknown/empty BCE now fails closed; commit a752afe..c3c5e35).
Task 4: reviewer confirms unknown-BCE guard fixed but full core has 4 stale demo failures, which were not updated. Carry to Task 7: revise demo fixtures/tests to assert unverified/default-off behavior, do not re-enable unsafe execution. Task 4 implementation still has stated limits; no static PASS until supported BCE completeness exists.
Task 4: complete with blocker (commits 3313572..c3c5e35, scoped review clean; full-core suite red due documented stale demo expectations).
Task 5 resumed with explicit user authorization for image inspection, benign integration and hostile PoC fixtures. Inspected exact ARM64 image digest: Forge 1.5.1 (`b0a9dd9`), uid 10001, no solc/Node. Verified official Node v22.14.0 Linux ARM64 checksum `08bfbf538bad0e8cbb0269f0173cca28d705874a67a22f60b57d99dc99e30050`, mounted repository solc-js 0.8.30 and locked dependencies read-only, wrote a test solc shim and verified an offline benign Foundry test. Implemented opt-in Docker argv/workspace adapter, deny-only conservative policy, compiler version check, exact hardening flags, bounds, cancellation/timeout/output handling, and cleanup. Integration test passed benign and assertion failure. Linux ARM64 only; production enablement remains blocked on macOS validation and reviewed PoC claim binding. Full evidence in task-5-report.md.
Verification: server tests 46/46; server/core typecheck pass; `bun turbo typecheck` all six packages pass; Docker adapter tests 5/5 with live integration when tooling env is supplied. `bun turbo test`: core 873 pass, 5 failures in carried stale `packages/core/test/demo/demo.test.ts` expectations from Task 4; unchanged here.
Task 5 implementation attempt: Task5 worker reports deployed Docker adapter with local offline solc-js + Node bind mounts, exact image pin and hardened runtime; performed live benign/assertion tests under Linux ARM64. No hostile workload run; production remains disabled pending macOS validation, parser/policy gate and missing stateDelta extraction. Review task diff before deciding completeness.
Task 5: fix round 1/5 (4 addressed per implementer report; commits 8e40de8..b5dd2d7). Review required before completion.
Task 5: fix round 2/5 (1 addressed, 0 open — pre-aborted signal; commits b5dd2d7..16f66ea).
Task 5: complete with release blocker (commits 174be6a..16f66ea, review loop clean). Sandbox tested on Linux ARM64 only; macOS Docker Desktop validation and real PoC policy/state delta mapping remain release gates.
Task 6 implementer output is release-blocked readiness endpoint, not API/runtime composition. Review before marking done. User authorized Task5+, but missing runtime adapters still prevent real Judge service; no false production claim.
Task 6: fix round 1/5 (3 findings addressed by implementer, but live Docker/Postgres/Keychain failure-before-listen still not tested; commits 3f1f084..2e19176).
Task 6: fix round 2/5 (2 addressed — real startup orchestration failures prevent listen, non-vacuous listener call assertions; commits 2e19176..1557c60).
Task 6: complete with release blocker (commits f91dcad..1557c60, scoped review clean). Delivers fail-closed local readiness/health command only, not functional Judge composition; provider connectivity, actual pipeline/worker, and live infrastructure unverified; must not call Judge production ready.
Task 7: implementer says complete with release blocked; plan records 878 tests and no live DB/Docker integration. Needs review.
Task 7: fix round 1/5 (2 addressed — negative metadata API test and demo test name; commits 3e4b169..c17fc30).
Task 7: fix round 2/5 (1 addressed — demo test renamed to exactly describe reason-row assertions; plan clarifies clean E2E fixture vs negative boundary test; commits c17fc30..73adf5d).
Task 7: complete with release blocker (commits 1557c60..73adf5d; scoped review clean). Production API→Postgres→worker E2E and requested runtime PoC scenarios remain unavailable because Task6 composition is health-only, BCE incomplete, and policy/sandbox release gates remain open.
Task 7 final review fix wave: protocol key scan now rejects normalized `scoringMetadata` and `groundTruthLabel` at nested depths without changing accepted event payload schemas; invalid ingestion now commits completed UNVERIFIED/UNRESOLVED rather than worker failure, with provider/sanitizer/sandbox bypass assertions. Fenced-JSON and prohibited-key ingestion adapter cases are already covered by `packages/core/test/ingestion/snapshot-ingestion.test.ts`. Production limitations are unchanged: this is not a production API→Postgres→worker E2E, complete BCE, or approved runtime PoC path.
Final branch review (base 381f312..HEAD 3b0aa64): critical load-bearing release blockers confirmed—no production Judge API/worker composition, BCE always incomplete and therefore static verdicts remain UNVERIFIED, policy remains deny-only, macOS Docker Desktop isolation unverified. These are explicitly represented in README/plan/health and must not be presented as MVP-ready. Final review also found Rule R2 key variants and invalid report mapping; fixed in 7dab5fc, then re-reviewed in 3b0aa64 with no new issues.
Final verification (fresh): `bunx turbo typecheck` → 6 packages success; `bunx turbo test` → 879 pass, 0 fail across 62 files; `swiftc -typecheck packages/server/native/keychain-credential.swift` passed; `git diff --check` passed. No live PostgreSQL or Docker integration was run in final verification. Opt-in Docker test had earlier Linux ARM64 benign/assertion coverage only; macOS remains unverified.
Plan execution stopped with release criteria NOT MET. Rulings: (1) Task 1 compiler/image pins remain runtime-blocked until independently verified; cost if wrong: unsupported toolchain. (2) Task 3 explicit `enablePocExecution=true` is a test seam only, production execution blocked pending isolation; cost if wrong: unsafe untrusted code execution. (3) Task 5 Linux ARM64 integration is not macOS Docker Desktop evidence; cost if wrong: false isolation assurance. (4) Task 6 continuation wires API/worker but lacks live Postgres/provider E2E; cost if wrong: incomplete operational confidence. (5) Task 7 E2E remains deterministic runner-level; cost if wrong: incomplete operational confidence.

## Task 6 continuation addendum

- User explicitly resumed Task 6. Added real production API and polling worker composition using PostgresRunStore, exact-ID disk snapshot resolver, RealModelGateway, production context, snapshot tool registry/ingestion, RegexSecurityFilter, PostgresCancellation, and production clock/random/sleep/ID sources. No test doubles are in the production composition.
- PoC execution is deeply frozen false with no opt-in; deny-only policy and disabled Docker sandbox are wired. BCE remains incomplete, so health explicitly reports unverified-only. No provider request at startup; real executions use the configured gateway.
- RED evidence: snapshot resolver test first failed because the export did not exist; then passed exact snapshot, wrong ID, traversal, and missing-snapshot assertions.
- Removed Docker image startup prerequisite because composition keeps sandbox disabled; no Docker is executed by this local service.
- Verification: server 61 pass/1 skip; CLI 54 pass; server and CLI typechecks pass. No live Postgres/provider/Keychain was used. Production HTTP→Postgres E2E remains unverified.
- Detailed report: `task-6-continuation-report.md`.

### Task 6 fix round 1

- Provider routing restricted to OpenAI native and explicit OpenAI-compatible OpenRouter URL; unsupported vendors and default OpenAI endpoint misuse fail closed.
- Promoted canonical redaction filter into core production API and removed production's `@harness/core/testing` import.
- Added schema-validated effective runtime metadata to immutable run config / run.started digest, excluding credentials.
- Added bounded polling-worker shutdown that leaves DB open while active work settles (or until it settles after the timeout); no force-close of active writes.
- Focused tests and full gates green: 880 pass, 0 fail; six package typechecks pass. External/live integrations not run per instruction.
- Detailed fix wave evidence appended to `task-6-continuation-report.md`.

### Task 6 fix round 2

- Native OpenAI endpoint host is restricted to `api.openai.com`; OpenRouter requires its explicit compatible URL and rejects OpenAI's host.
- Both supported provider URL paths reject userinfo, fragment, and secret-bearing query parameter names before any value can be recorded in run metadata.
- TDD red observed for wrong OpenAI host and credential query/fragment cases; green after policy fix. Focused tests, six-package typecheck and full test suite pass (880/0); no live services used.
- Detailed result in `task-6-continuation-report.md`.

### Task 6 fix round 3

- Require HTTPS for explicit OpenAI/OpenRouter base URLs and reject all query strings/fragments, including arbitrary keys such as `x` and `auth`, before gateway config construction.
- TDD: new HTTP/query regression tests failed before change and pass after. Focused tests/typecheck and full `bun turbo typecheck` + `bun turbo test` pass (880/0); no live services contacted.
- Report appended at `task-6-continuation-report.md`.

### Task 6 fix round 4

- Provider URL validation/normalization now happens before Postgres construction, snapshot checks, admission, or listener setup; the resolved config is reused for gateway and immutable runtime metadata.
- Added startup regression proving invalid URL is rejected before other startup failures, and runtime snapshot asserts normalized credential-free URL.
- Focused server tests (14 pass) and six-package typecheck pass. No live services used; detailed record in continuation report.

### Task 6 continuation fix round 5

- Added an internal production-startup operations seam solely to prove ordering, without adding caller-controlled public readiness callbacks. Query, HTTP, and userinfo provider URLs each reject before Postgres store construction, snapshot access, Keychain/startup orchestration, or listener invocation (all counters zero).
- TDD red observed before the seam; focused production-runtime test passes 15/15 and server typecheck passes. No live services were used; detailed evidence is in `task-6-continuation-report.md`.

### Task 6/7 continuation tracking correction — 2026-10-22

- Task 6 lifecycle tests cover local binding/startup, worker polling and recovery/shutdown, and health compatibility. They do not exercise a live listener or macOS Keychain; readiness/preflight tests are not live integrations.
- Task 7 has a guarded `packages/server/test/postgres-judge-runtime.test.ts` (API handler → Postgres → worker → real JudgeRunner). It was not run: `HARNESS_POSTGRES_E2E` was absent. Fresh check with both opt-in variables unset: `env -u HARNESS_POSTGRES_E2E -u HARNESS_POSTGRES_E2E_DATABASE_URL bun test packages/server/test/postgres-judge-runtime.test.ts` → 1 skipped. Do not describe PostgreSQL integration as unavailable or unimplemented.
- Fresh verification: `bun turbo typecheck` → 6 packages successful; `bun turbo test` → 880 pass, 0 fail across 62 files; `swiftc -typecheck packages/server/native/keychain-credential.swift` and `git diff --check` passed. No live PostgreSQL, Docker, Keychain, or live-model integration was run.
- Release remains blocked: BCE incomplete, policy deny-only, macOS sandbox unvalidated, and production PostgreSQL/Keychain/live-model integrations not run. No full MVP/production claim.

## Task 9 continuation — claim-bound state probes

Ruling: do not invent a Foundry stdout parser or relax the deny-only PoC policy. Normal Forge output supplies no authenticated structured pre/post values tied to a deconstructed claim, and the current policy cannot prove a generated probe preserves the target rather than mocking, redeploying, or replacing it. Cost if wrong: fabricated empty or incidental output could be treated as runtime evidence.

Task 9: safely-disabled path complete. Production config remains `maxProbeRuns: 0`; health has no state-probe capability; direct `DockerFoundrySandbox.runStateProbe` fails closed before compiler/Docker launch instead of returning an empty successful measurement. Decision: `docs/superpowers/decisions/2026-10-22-judge-state-probe-no-go.md`.

Verification: RED `bun test packages/server/test/docker-foundry-sandbox.test.ts` failed because the former adapter returned an empty successful measurement; GREEN focused tests: 30 pass, 1 guarded skip; server typecheck passed; core adjudication probe regression suite: 6 pass; `git diff --check` passed. No Docker, hostile PoC, or production probe path was enabled or run.
Task 8: complete as NO-GO for static PASS. AST slices/citation verification do not prove arbitrary vulnerability semantics; no complete-profile route added. Ruling: retain all `UNVERIFIED` until a deterministic claim language/verifier is designed and reviewed. Cost if wrong: false positives/negatives if model consensus is treated as proof.
Task 9: complete as NO-GO for state probes. Ruling: maxProbeRuns stays 0 and direct sandbox probe call fails before execution because output has no trusted structured claim-bound pre/post state protocol and PoC policy cannot prove target preservation. Cost if wrong: fabricated state evidence could create false verdicts.

## Task 10 continuation — observed macOS Docker Desktop capability

Ruling: treat the actual `desktop-linux` daemon as Docker Desktop target evidence only after identifying it with `docker info`/`docker version;` it is Docker Desktop 4.81.0 / Engine 29.6.1 Linux ARM64 behind a Darwin ARM64 client, not native macOS containers. Cost if wrong: calling VM-based Linux evidence macOS-native isolation would overstate what was tested.

Task 10: inspected only the Task 5 artifact root and verified the exact image digest is available as Linux ARM64. Node and shim matched adapter pins; raw solc and dependency tree checksums are recorded in `docs/superpowers/decisions/2026-10-22-judge-macos-docker-desktop-task10.md`.

Task 10: a unique, disposable sanitized container verified `network=none`, root/bind read-only behavior, UID/GID 10001, zero effective caps, no-new-privileges, Engine CPU/RAM/PID limits, a 256 MiB scratch quota, and no host-bind mutation. Independent uniquely named timeout and abort controls exited 137 and were absent after cleanup; a bounded-output fixture stopped at 1,024 bytes and cleaned up. Opt-in real Foundry fixtures passed 14/14 including a benign assertion and bounded hostile `assert(false)` classification. No real submission, secrets, Docker socket, production config change, or arbitrary workload was used. Full suite was not rerun by instruction.

Task 10: release gate remains BLOCKED. Ruling: do not add a capability gate or flip production execution because the result covers only one Desktop version, `ConservativePocPolicy` rejects every PoC, and Task 9 intentionally lacks claim-bound state evidence. Cost if wrong: an isolated but unbound test could be represented as runtime verdict evidence. Decision/report: `docs/superpowers/decisions/2026-10-22-judge-macos-docker-desktop-task10.md`, `.superpowers/sdd/2026-10-22-judge-mvp-real-pipeline/task-10-report.md`.
Task 10 evidence captured: actual macOS ARM64 Docker Desktop 4.81.0 / Engine 29.6.1 Linux ARM64 VM; bounded controls probe and opt-in Foundry fixtures pass on this daemon. This does not enable production execution: only one Docker Desktop version validated, deny-only policy and no claim-bound state protocol remain. See task-10-report.md and decision doc.
Verification after Task9/Task10 dirty changes: `bunx turbo typecheck` all packages success; `bunx turbo test` 880 pass/0 fail across 62 files; Swift helper typecheck and git diff check passed; focused Docker adapter + production runtime tests 30 pass/1 skip. No dedicated Postgres opt-in was configured, so guarded E2E intentionally did not run. macOS Docker evidence recorded for Docker Desktop 4.81.0/Engine 29.6.1; not generalized to other versions. Static PASS and state probes remain explicit NO-GO; production PoC remains disabled.
Task10 evidence tracked in commit cdebe0b after review found ignored workspace report; decision doc now contains exact commands/observed control values and reproducible fixture invocation. State probes now fail closed before process launch with tests; production maxProbeRuns=0 and no probe capability. Focused sandbox/runtime tests after these edits: 30 pass, 1 skip; server typecheck pass; diff check pass. Full suite/typecheck was run immediately before documentation/probe guard commit: 880 pass, 0 fail/all packages typecheck; those later edits have focused verification only.
Task11 continuation: dedicated Postgres E2E is present but not executed because no `HARNESS_POSTGRES_E2E_DATABASE_URL` is configured; explicitly testing with `HARNESS_POSTGRES_E2E=1` failed immediately as designed with required dedicated URL (no DATABASE_URL fallback). Existing shared `harness-postgres` container/database was not used. Task10 report + decision tracked in cdebe0b/0604361; Mac Docker Desktop 4.81.0 opt-in suite rerun after changes: 14 pass, 0 fail. Task9 fail-closed state probe now prevents false empty-delta success. Invalid report terminal reasoning fixed to satisfy protocol minimum; fresh full verification: turbo typecheck all six, turbo test 881/0, swiftc helper typecheck, diff check. Release blockers remain: deny-only PoC policy, no claim-bound state probe, BCE semantically incomplete/static no-go, no dedicated Postgres live E2E or production Keychain/provider integrated test; production PoC disabled.
Task11 continuation: created a dedicated disposable `postgres:16-alpine` container (unique name/random localhost port, dedicated user/db, trap cleanup; did not touch the existing harness-postgres container/database). Guarded Postgres runtime E2E passed (2/2) before listener coverage. Added listener-level real Bun HTTP + Postgres + API + worker + real Runner E2E using only the internal test credential/gateway seam, no Keychain/provider/PoC. Full verification after addition: 881 pass/0 fail, all 6 typechecks, Swift typecheck and diff check. Remaining manual test path requires macOS Keychain credential retrieval and user's actual model/provider config; no provider call occurs for unsupported input and only UNVERIFIED is currently possible.

Task 11 follow-up: shared Postgres target regression now includes the dedicated-database acknowledgement, proving target identity rejection occurs before/independently of the acknowledgement requirement; all opt-in guards remain fail-closed. README smoke instructions now use the actual `cli:repo add` ingest command and explicitly predict UNVERIFIED/UNRESOLVED with PoCs denied. Provider-backed smoke/routing test remains NOT RUN: this environment has no `MODEL_API_KEY`, `DATABASE_URL`, or snapshot directory. Requires operator-supplied local key (never chat) and dedicated local config. Verification: focused validator test 5 pass/1 guarded skip; `bun turbo typecheck` all 6 successful; `bun turbo test` 881 pass/0 fail; Swift Keychain helper typecheck and `git diff --check` passed.
Manual-test continuation final: Added runnable README smoke-test instructions (repo snapshot command, dedicated DB migration, Keychain helper token retrieval without args/files, HTTP submit/poll/stop; expected UNVERIFIED). Added stricter live Postgres E2E acknowledgement and normalized DB target guard (host aliases, case/trailing dot, default port, database; role/scheme/query ignored). Dedicated disposable PG listener E2E ran in a fresh uniquely named postgres:16-alpine container with random loopback port and cleanup trap: 7 pass / 0 fail; no shared DB touched. Opt-in without dedicated URL fails intentionally; equivalence tests cover same DB across scheme/role/localhost aliases. Latest full suite 881 pass/0 fail; all six typechecks; Swift helper typecheck; diff check. Actual manual API provider run not performed because environment lacks MODEL_API_KEY, DATABASE_URL, snapshot dir. User must supply local credentials/config privately and note output remains UNVERIFIED-only. Remaining release blockers: no static verifier, deny-all PoC policy, provider routing controlled endpoint untested, maxProbeRuns zero, version-wide Docker certification incomplete.

### Task 11 live provider follow-up — 2026-10-22

- Root cause for the zero-attempt `worker_interrupted` runs: `JudgeStep` called `ProductionContextEngine.prepare()` without its mandatory canonical request. The thrown contract error occurred before the provider retry boundary. Fixed by passing the request through preflight and reusing prepared sanitized items/tools for the attempt; regression test covers this.
- Live `9router` routing was then observed against fresh, uniquely named disposable PostgreSQL containers and temporary immutable snapshots. Outcomes: 1 attempt → context budget exhausted; 2/4 attempts → max-steps exhausted; 5 attempts → schema repair exhausted. Provider attempt events confirm the calls reached the configured route, but no run completed with a verdict. No raw errors, prompts, response content, or credentials printed. Full sanitized report: `live-provider-report.md`.
- Updated the manual script's bounded limits (8 steps, 32,768 tokens; fixed provider output cap remains 512) for a more representative test. These limits remain explicit and do not relax verdict, PoC, or probe gates.
- Focused verification: JudgeStep + context engine 42 pass; server manual summary/script tests 2 pass; server typecheck and diff check pass. Full monorepo verification remains outstanding.
- Release status unchanged: static PASS has no verifier, PoC denied, state probes disabled, BCE incomplete. Controlled endpoint routing is exercised, but a completed provider-backed Judge run remains outstanding because current bounded model output exhausted schema repairs.
- The first full test run after the request fix caught stale hydration behavior: 5 failures (recovery/stress) because request digests were now recorded but takeover did not rebuild the canonical request. Fixed takeover reconstruction from persisted tool descriptions, preserving the request-digest check; a test-only legacy pass-through remains for old unit fixtures. Focused recovery/demo rerun: 57 pass; history hydration: 5 pass. Full suite rerun is required before completion.
