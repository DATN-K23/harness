# Task 3 Report: Bidirectional Verification and Consensus

## Implemented

- Added `packages/core/src/judge/bidirectional-verifier.ts` with typed forward/backward result contracts, strict JSON parsing, and deterministic outcomes (`agreed-valid`, `agreed-invalid`, `disputed`, `inconclusive`). A blocking result from either direction is treated as the proposal's explicit refutation; both incomplete results are inconclusive.
- Added versioned `forward-verification.v1` and `backward-verification.v1` prompts and registered them in the existing prompt loader.
- Wired claim-bearing Stage 4 contexts into the existing `JudgeStep` loop. The forward and backward results are separately added to persisted context, and consensus is computed from the typed results. Invalid model output uses existing validation-failure persistence and schema-repair budget; no tool requests are routed outside the provided registry.
- Added verifier tests plus JudgeStep coverage for a direction's typed result and registered-only tool dispatch.

## Scope limits / follow-up

- Task 4's targeted witness execution and Task 5 scenarios were not implemented.
- Consensus is recorded as a reasoning context item; existing `JudgeVerdict` has no inconclusive/disputed state, so this change does not synthesize a terminal verdict from consensus. The legacy verdict synthesis remains downstream and is a known integration gap to resolve with Task 4's verdict work.
- The JudgeStep currently uses existing `repairsUsed`, which is run-wide and also tracks verdict repairs. The existing persisted history can therefore account for verification repairs without adding event types.
- OpenCode reference runner was inspected; no code was copied/adapted, therefore no attribution header was needed and no runtime dependency was added.

## Verification

From `packages/core`:

- `bun run typecheck` — passed.
- `bun test test/judge/bidirectional-verifier.test.ts test/runner/judge-step.test.ts test/runner/judge-runner.test.ts` — 53 passed, 0 failed.

## Security notes

- No ground-truth, scoring metadata, or new external tool access was introduced. Model tool calls continue through the existing supplied snapshot tool registry and security filtering.

## Review-fix report (2026-10-21)

- Consensus classification now leaves contradictory blocked/non-blocking results disputed; both blocked results agree-invalid, while blocking paired with incomplete remains explicit refutation. Added coverage for blocked/non-blocked, all incomplete combinations, and reachable/reconstructed agreement.
- Forward/backward JSON boundary rejects any keys beyond the exact status field and `explanation`, including missing required keys.
- `JudgeStep` now fails closed whenever persisted consensus is not `agreed-valid`, before another model call or ordinary verdict synthesis. This keeps disputed, inconclusive, and agreed-invalid from being converted by a later unconstrained answer. No Task 4 witness/verdict behavior was added.
- Focused check from `packages/core`: `bun run typecheck` passed; `bun test test/judge/bidirectional-verifier.test.ts test/runner/judge-step.test.ts test/runner/judge-runner.test.ts` passed (57 tests, 0 failures); `git diff --check` passed.
- No OpenCode implementation was adapted and no new runtime dependency was introduced.
