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
