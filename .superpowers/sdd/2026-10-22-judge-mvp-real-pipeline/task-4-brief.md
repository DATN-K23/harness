### Task 4: Enforce bidirectional evidence validation and no-witness narrative path

**Files:**
- Modify: `packages/core/src/runner/judge-step.ts`, `packages/core/src/judge/bidirectional-verifier.ts`, prompt templates only where required.
- Test: `packages/core/test/runner/judge-runner.test.ts`, `packages/core/test/judge/bidirectional-verifier.test.ts`.

**Interfaces:**
- Consumes: Task 3 structured claim/BCE result; existing forward/backward typed results and `JudgeVerdict`.
- Produces: consensus result eligible for static verdict only with validated citations and sufficiently complete supported BCE; otherwise it requests an available submitter PoC path or commits inconclusive. No generated witness path.

- [x] Add tests for matched forward/backward evidence, source-verified blocking-guard semantics, incomplete BCE and conflicting directions; existing `verdict-synthesizer.test.ts` covers fabricated/missing citations and snapshot line bounds.
- [x] Add tests proving narrative-only does not call sanitizer/sandbox and returns `UNVERIFIED` when runtime evidence is needed.
- [x] Run focused runner tests and observe failures.
- [x] Preserve snapshot line/digest citation validation through `synthesizeVerdict`; consensus cannot upgrade incomplete BCE to PASS.
- [x] Preserve status semantics: this Task 3 incomplete BCE profile remains `UNVERIFIED` for static claims; no missing edge proves blocked.
- [x] Run focused tests and the full core suite (focused passed; full suite has 4 remaining demo failures documented in `task-4-report.md`).
