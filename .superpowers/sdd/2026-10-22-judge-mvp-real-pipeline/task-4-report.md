# Task 4 report — bidirectional evidence and narrative no-witness

## Outcome

- `decideConsensus` now requires both directions to explicitly say `blocked` before producing `agreed-invalid`; a blocked result paired with an incomplete direction is disputed, not refutation.
- The initial context records when BCE is explicitly incomplete (the Task 3 `incomplete` ingestion result). After model verdict citation resolution against the immutable snapshot, a proposed static valid/invalid conclusion is downgraded to `UNVERIFIED/UNRESOLVED`. Model consensus alone cannot upgrade it.
- Narrative-only input does not pass through PoC sanitizer or sandbox, regardless of `enablePocExecution`; no witness is generated. Its incomplete BCE case terminates unverified when model reasoning cannot resolve it.
- Existing `synthesizeVerdict` remains the snapshot citation authority: it reads each cited line from the requested immutable snapshot and computes snippet/digest itself. Its tests cover fabricated hashes, missing file, invalid line ranges and unsafe paths.

## Verification

- RED: focused tests initially failed because `blocked + incomplete` returned `agreed-invalid` and citation-valid `PASS` was accepted with incomplete BCE.
- Focused tests: `bun test packages/core/test/runner/judge-runner.test.ts packages/core/test/judge/bidirectional-verifier.test.ts packages/core/test/judge/verdict-synthesizer.test.ts` — **73 pass, 0 fail**.
- `bun run --cwd packages/core typecheck` — passed.
- `git diff --check` — passed.
- `bun run --cwd packages/core test` — **873 pass, 4 fail**. Failures are offline demo expectations that still assert runtime/exploit success or cheat/execution stage events. The implementation does not make runtime execution safe; Task 5/6 must update these demonstrations only alongside verified production sandbox capability. No Docker, Foundry, or runtime execution was run.

## Limitations / parked release blockers

- Task 3 BCE still marks the AST slices `bce_unavailable`/incomplete in every adapter result. Therefore no narrative static PASS is currently eligible; citations are validated but source slices are retrieval context, not complete supported BCE. The runner cannot independently validate that citation semantics establish the specific claim or a blocking guard; it conservatively returns `UNVERIFIED` for any static conclusion under explicit incomplete BCE. No absent graph edge is used as proof.
- The existing core `enablePocExecution` option still reaches sanitizer/sandbox for submitter PoCs when explicitly true. This is deliberately not changed here: it is a test seam and no real sandbox adapter/isolation has been verified. Production composition must refuse enabling it until separately verified and approved (carry to Task 6). Task 4 does not execute Docker or bypass this gate.
- Some legacy demo tests still encode runtime success; see the failed full-core suite above. Do not claim the MVP is release-ready from Task 4.
