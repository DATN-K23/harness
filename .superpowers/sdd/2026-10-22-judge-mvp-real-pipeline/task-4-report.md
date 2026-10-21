# Task 4 report — bidirectional evidence and narrative no-witness

## Outcome

- `decideConsensus` now requires both directions to explicitly say `blocked` before producing `agreed-invalid`; a blocked result paired with an incomplete direction is disputed, not refutation.
- The initial context marks BCE incomplete for every current public ingestion path, including `kind: "ok"` (where `bceStatus` is absent or slices are empty). There is no trusted complete-BCE marker in the current public ingestion contract. After model citation resolution against the immutable snapshot, a proposed static valid/invalid conclusion is downgraded to `UNVERIFIED/UNRESOLVED`. Model consensus alone cannot upgrade it.
- Narrative-only input does not pass through PoC sanitizer or sandbox, regardless of `enablePocExecution`; no witness is generated. Its incomplete BCE case terminates unverified when model reasoning cannot resolve it.
- Existing `synthesizeVerdict` remains the snapshot citation authority: it reads each cited line from the requested immutable snapshot and computes snippet/digest itself. Its tests cover fabricated hashes, missing file, invalid line ranges and unsafe paths.

## Verification

- RED: focused tests initially failed because `blocked + incomplete` returned `agreed-invalid` and citation-valid `PASS` was accepted with incomplete BCE.
- Focused tests: `bun test packages/core/test/runner/judge-runner.test.ts packages/core/test/judge/bidirectional-verifier.test.ts packages/core/test/judge/verdict-synthesizer.test.ts` — **73 pass, 0 fail**.
- `bun run --cwd packages/core typecheck` — passed.
- `git diff --check` — passed.
- `bun run --cwd packages/core test` — **5 failures reproduced** (the new unknown-BCE regression plus 4 demo failures; a subsequent run showed 4 because of ordering/parallel reporter output). The failing demo cases are `runs the offline scenarios and prints a summary row for each` (expects `EXPLOIT_CONFIRMED`; gets `UNRESOLVED`), `missing, cheating and failing PoCs cost zero tokens and report the right reason` (expects cheat/runtime fast rejects with zero steps; instead gateway script exhaustion ends `provider_permanent` with one step), `narrative-only agreement skips PoC stages and commits a source-cited verdict` (expects static `valid/PASS`; gets `UNVERIFIED` because BCE is incomplete), `disputed report resolves through bounded witness evidence and snapshot citation` (expects `valid/PASS`; gets `UNVERIFIED` because the attempted witness evidence does not resolve semantically), and `confirmed exploit: all seven pillars exist and carry the evidence` (expects runtime proof applicable; actual bundle says no execution). The runtime assertions are stale under default-off PoC execution and must not be re-enabled to make tests green; the static PASS assertions conflict with Task 3's incomplete BCE. I did not update demo fixtures/tests because they are demo capability expectations beyond Task 4 and correcting them needs separately scoped release/demo decisions. No Docker, Foundry, or runtime execution was run.

## Limitations / parked release blockers

- Task 3 BCE still marks the AST slices `bce_unavailable`/incomplete in every adapter result. Therefore no static PASS or FAIL is currently eligible; citations are validated but source slices are retrieval context, not complete supported BCE. The runner cannot independently validate that citation semantics establish the specific claim or a blocking guard; it conservatively returns `UNVERIFIED` for any static conclusion when the public ingestion result's BCE completeness is unknown or incomplete. No absent graph edge is used as proof.
- The existing core `enablePocExecution` option still reaches sanitizer/sandbox for submitter PoCs when explicitly true. This is deliberately not changed here: it is a test seam and no real sandbox adapter/isolation has been verified. Production composition must refuse enabling it until separately verified and approved (carry to Task 6). Task 4 does not execute Docker or bypass this gate.
- Some legacy demo tests still encode runtime success; see the failed full-core suite above. Do not claim the MVP is release-ready from Task 4.
