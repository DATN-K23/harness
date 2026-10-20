# Task 4 Report: Review Fixes

## Fixed

- An `agreed-invalid` consensus is schema-validated and only becomes `invalid/FAIL` when a ranged BCE source item is reread from the immutable snapshot and its text matches. The verdict citation uses that exact range, filtered snippet, and harness-computed digest. Without matching snapshot evidence the terminal result is `unverified/UNVERIFIED`.
- Added the normative `UNRESOLVED` reason code and instructed the Judge prompt to use it for uncertain evidence/witness outcomes. This avoids labeling unresolved claims as `BENIGN_MECHANICS` or `EXECUTION_FAILED`.
- `disputed`/`inconclusive` remains explicitly `unverified/UNRESOLVED`, with no false invalid inference from process status.
- Added full `JudgeRunner` tests for disputed/inconclusive and agreed-invalid narrative-only paths. They assert terminal completed state, one `run.completed`, contiguous events, and the expected unverified verdict—covering the existing terminal CAS commit path.
- Narrowed the earlier inaccurate claim: only model-authored verdict citations and consensus citations that pass snapshot resolution are bounded by `SourceSnapshotPort`.

## Remaining witness limitation

- The current safe `run_state_probe` is available only when a sanitized assertion-free PoC exists. Narrative-only has no PoC to sanitize; assertion-bearing Tier 1 PoCs do not expose the probe. The tool returns formatted text rather than a typed result tied to a disputed condition. There is therefore no safe way in the current port contract to dispatch and adjudicate a targeted witness for every disputed claim. Such cases remain explicitly UNRESOLVED/UNVERIFIED. No unbounded PoC generation, unsafe execution, or inference from exit code was introduced.
- An available Tier 2 probe remains bounded by the configured probe count and executes only through the existing sanitizer/sandbox ports; however, sound verdict-level interpretation of its output requires a typed targeted-condition contract beyond this review fix.

## Verification

- From `packages/core`: `bun test test/judge/verdict-synthesizer.test.ts test/judge/adjudication-step.test.ts test/runner/judge-step.test.ts test/runner/judge-runner.test.ts test/prompts/prompts.test.ts` — 92 passed, 0 failed.
- From `packages/core`: `bun run typecheck` — passed.
- `git diff --check` — passed.
- No OpenCode runner code was adapted and no dependency was added.

## Follow-up review fix (2026-10-21)

- Disputed/inconclusive consensus now offers the already-registered `run_state_probe` path only when that safe tool is available (its existing sanitizer Tier 2 gate and configured run counter remain authoritative). It will request one state expression explicitly named in the claim, persist the request/result through the normal tool event sink, and enforce no repeated dispatch once a request/result exists.
- Failed/error probe output yields `UNRESOLVED`/`UNVERIFIED`. A successful process exit does not directly decide the claim; subsequent verdict input must include `targetedCondition` exactly matching the requested expression and passes through `synthesizeVerdict` snapshot citation resolution. Missing/mismatched targeted condition remains UNVERIFIED.
- Consensus outputs no longer create fixed-confidence `PASS`/`FAIL` based merely on an arbitrary BCE slice. A normative verdict with exact snapshot citations is required; absent/unsupported evidence becomes UNRESOLVED/UNVERIFIED. Unrelated BCE coverage was added.
- Added isolated `witness-resolution.test.ts` coverage for one registered dispatch, no second dispatch with prior request/result, failed probe, exit-zero without targeted resolution, and unrelated BCE evidence. Existing Task 3 terminal runner cases were inspected and retained; attempted extra scripted runner cases were removed because they exhausted before the witness path due to test prompt choreography and did not provide valid coverage.
- **Remaining concern:** the disputed witness path is covered at deterministic `JudgeStep` level; the added end-to-end Tier 2 script was not stabilized, and there is no new dedicated full-runner test demonstrating probe dispatch plus terminal CAS in one scenario. Existing terminal CAS tests remain in the runner suite. The state-probe contract remains text-shaped, so strict typed targeted-condition semantics are still limited to the model's exact `targetedCondition` response and snapshot-validated verdict citation.

### Follow-up verification

- From `packages/core`: `bun test test/runner/witness-resolution.test.ts test/runner/judge-step.test.ts test/judge/adjudication-step.test.ts test/judge/verdict-synthesizer.test.ts test/prompts/prompts.test.ts` — 71 passed, 0 failed.
- From `packages/core`: `bun run typecheck` — passed.
- `git diff --check` — passed.
- Full `JudgeRunner` probe-dispatch/CAS integration is not verified by a new scenario in this follow-up; attempted scripted end-to-end additions exhausted before reaching the witness path and were removed. Existing Task 3 runner terminal cases remain intact.

## Additional review fix (2026-10-21)

- After a successful registered probe, the verdict path now requires `targetedCondition` to exactly match the one requested variable before it invokes normative verdict synthesis. The synthesis path still resolves every citation against the immutable snapshot; mismatched/unreferenced conditions remain UNRESOLVED. No claim is made that this is a mechanical proof of causality.
- Added a test showing process exit success plus a generic invalid verdict does not resolve a disputed condition; the test remains UNVERIFIED without the exact target marker. Probe error is now tested through the subsequent step's terminal UNVERIFIED verdict, not only the returned tool error. The test also checks a prior request/result prevents second dispatch.
- Agreed-valid/agreed-invalid consensus no longer creates a verdict from a source text keyword-overlap heuristic. It asks for a normative model verdict with direct citations; the final verdict still passes `synthesizeVerdict`. A no-BCE agreed-invalid consensus is immediately UNRESOLVED/UNVERIFIED. Unrelated BCE does not support a verdict.
- Focused verification from `packages/core`: 71 tests across witness resolution, JudgeStep, adjudication, verdict synthesis, and prompt suites passed; `bun run typecheck` and `git diff --check` passed.
- Full-runner probe-to-CAS scenario remains unverified: attempted linear scripts exhausted before exercising that path due to the existing prompt-injection sequence; prior terminal/CAS coverage remains in the existing JudgeRunner tests.

## Fix round 4 (2026-10-21)

- Preserved exact `StateProbeResult.stateDeltas` in an ephemeral probe evidence map (not trajectory events) and passed it from stage-4 tool setup to `JudgeStep`. For disputed/inconclusive claims, a final verdict must include `targetedCondition`, exact `observedBefore`/`observedAfter`, and a non-trivial `deltaExplanation`; all are checked against the requested target and typed sandbox result before snapshot citation synthesis. Missing/mismatched evidence remains UNVERIFIED. Prompt clarifies source citations do not prove dynamic deltas.
- Kept process failure/exhaustion fail-closed and added tests for exact-delta mismatch plus exhausted bounded invocation ending UNVERIFIED without redispatch.
- Fixed the existing runner integration/CAS test fixture: its inconclusive runner script ended after the second directional answer and omitted the final UNVERIFIED verdict response, causing `provider_permanent` instead of testing the expected terminal CAS. With the missing model response supplied, it exercises terminal `run.completed`, completed state, and contiguous event sequence through the runner path. A full Tier-2 probe-to-CAS scenario remains unestablished.
- Verification from `packages/core`: focused witness, JudgeRunner, adjudication and verdict-synthesis suites — 58 passed, 0 failed; `bun run typecheck` passed; `git diff --check` passed.
- Recovery caveat: exact delta values are deliberately not persisted in events. A takeover rebuilds an empty typed witness record; resumed resolution therefore remains UNVERIFIED rather than trusting presentation text. Persisting typed witness evidence safely would require a follow-up contract/event design.
