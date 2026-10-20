# Task 4 Report: Targeted Witness and TV4 Verdict

## Implemented

- `JudgeStep` now maps `agreed-valid` directly to a schema-validated `valid/PASS` verdict and `agreed-invalid` to `invalid/FAIL`; both terminate through the existing runner and terminal CAS path.
- `disputed` and `inconclusive` terminate as `validity: "unverified"` / `verificationStatus: "UNVERIFIED"`, rather than being mistaken for invalid findings.
- The protocol verdict schema now distinguishes `unverified` as a durable validity state. Existing invalid verdicts retain their `FAIL` requirement; only the explicit unverified state carries `UNVERIFIED`.
- Added synthesis/step coverage for unverified validity and consensus outcomes. Existing model-driven citations remain resolved and bounded through `SourceSnapshotPort`.

## Deliberate limitation

- A full targeted witness does not run here. The existing `run_state_probe` is only made available for sanitized assertion-free PoCs, while Task 2's required `narrative_only` path has no PoC to sanitize or state-probe. The current flow does not carry a typed disputed condition or enough target state to synthesize a safe probe. Per the bounded-scope decision, those unresolved cases are explicitly UNVERIFIED rather than using an unbounded exploit-generation path or guessing invalidity.
- Successful `run_state_probe` evidence is currently formatted as a tool result for model interpretation; no typed witness adjudication result exists. Treating exit code 0 alone as proof of invalidity would be unsound, so it is not used as a verdict shortcut.
- The unverified verdict uses the existing `BENIGN_MECHANICS` reason code because no unresolved/witness-unavailable reason exists in the normative verdict schema; validity and verification status remain explicit. A dedicated reason code is a protocol follow-up.

## Verification

- From `packages/core`: `bun test test/judge/verdict-synthesizer.test.ts test/runner/judge-step.test.ts test/runner/judge-runner.test.ts` — 72 passed, 0 failed.
- From `packages/core`: `bun run typecheck` — passed.
- `git diff --check` — passed.
- No OpenCode runner implementation was borrowed; no runtime dependency or additional port was introduced.
