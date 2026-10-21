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

## Fix round 1

Addressed reviewer findings:

- Sandbox port rejections now become `EXECUTION_FAILED` / `UNVERIFIED`; unrelated stage errors remain `worker_interrupted`. Abort-triggered rejections retain the existing wall-clock/cancellation handling.
- Successful state-probe deltas are individually secret-filtered and bounded to 1,000 characters before both model exposure and evidence storage. The verdict wire shape is unchanged.
- Added direct coverage for `setup_failed`, `timed_out`, thrown sandbox calls, and secret/size handling at the delta boundary.

TDD: `bun test packages/core/test/runner/judge-runner.test.ts packages/core/test/judge/adjudication-step.test.ts` initially showed the thrown sandbox case returning `worker_interrupted` and delta data leaking/unbounded. After the fix: **41 pass, 0 fail**.

Verification:

- `bun run --cwd packages/core typecheck` — passed.
- `bun run --cwd packages/protocol typecheck` — passed.
- Focused tests above — **41 pass, 0 fail**.
- No Docker was enabled or run; no isolation claim is made.

Scope note: only the two affected core test files and implementation files were changed for this round; existing unrelated workspace modifications were left untouched.

## Fix round 2

Addressed the scoped re-review finding that an arbitrary number of individually bounded deltas could inflate probe output and evidence. State probes now process at most 32 deltas; excess deltas are omitted from both the rendered result and recorded evidence. No unrelated logic or Docker work was changed.

TDD: added a 100-delta regression asserting only the first 32 are exposed and recorded, and that the resulting content stays below 2,000 characters. Before the implementation change, `bun test packages/core/test/judge/adjudication-step.test.ts` failed as expected (`expect(received).not.toContain(expected)`). Afterward: **6 pass, 0 fail**.

Verification:

- `bun run --cwd packages/core typecheck` — passed.
- `bun run --cwd packages/protocol typecheck` — passed.
- `git diff --check` — passed.
- No Docker was enabled or run.
