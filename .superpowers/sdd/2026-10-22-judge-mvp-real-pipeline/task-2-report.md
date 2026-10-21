# Task 2 implementation report

## Outcome

Sandbox and state-probe port results now require a typed outcome: `passed`, `assertion_failed`, `infrastructure_failed`, `setup_failed`, or `timed_out`. Runner decisions no longer infer validity from process exit codes. Any non-passed single-shot result terminates as `unverified/UNVERIFIED` with `EXECUTION_FAILED`; failed probes return a bounded status-only error and supply no state evidence. The `JudgeVerdict` wire shape is unchanged.

Static valid verdicts continue through `synthesizeVerdict`, which resolves citations against the immutable snapshot and computes the snippet digest before acceptance. Runtime PASS is not inferred from the port result by itself; this task does not enable execution or assert that a verified sandbox exists. The agreed isolation/compiler/image/macOS blocker remains in force.

## TDD proof

- Added regression in `packages/core/test/runner/judge-runner.test.ts` asserting an infrastructure failure with exit code 1 is UNVERIFIED, not invalid.
- Before production changes, ran `bun test packages/core/test/runner/judge-runner.test.ts`: **31 pass, 1 fail**. The new assertion failed as expected: the implementation returned `invalid/FAIL` for exit code 1.
- After implementation, the same focused runner test passed. Added coverage confirming assertion failure without validated claim evidence also stays UNVERIFIED.

## Verification

- `bun test packages/core/test/runner packages/core/test/judge packages/protocol/test` — **592 pass, 0 fail**.
- `bun turbo typecheck` — **6 packages successful**.
- `bun test packages/core/test/demo/demo.test.ts` — **6 pass, 0 fail**.
- `bun run --cwd packages/core demo` completed scripted scenarios; this is not a sandbox/isolation verification and must not be represented as one.
- `git diff --check` passed.

## Scope and concerns

No event schema or verdict fields were added. Port result shapes are intentionally stricter, so concrete sandbox adapters must report a classified outcome before they can typecheck against this port. The repository currently has no production sandbox adapter; runtime remains blocked and must be explicitly enabled only after its isolation prerequisites are verified. Assertion failures are conservatively UNVERIFIED pending validated test/trace evidence and a separately designed evidence-validation path.

Commit: `71807f9` (`fix(core): distinguish sandbox outcome from exit status`).
