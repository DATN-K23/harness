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
