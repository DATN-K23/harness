# Task 5 report: offline end-to-end evidence and verification

## Outcome

Added the seeded `narrative-agreed` scenario to the existing offline demo. It supplies a narrative-only finding, scripted reachability and reconstruction agreement, and a verdict citing the immutable `src/Vault.sol` snapshot. The scenario needs no executable PoC and does not invoke live APIs or Docker.

The demo test checks the scenario row, final valid/PASS verdict, source citation, four provider attempts, exact stage-event order (`ingestion` started then finished), absence of further sanitizer/sandbox stages, recorded terminal usage (100 tokens, $0.02), and dossier evidence. Existing demo expectations were adjusted for the fifth scenario. The confirmed-exploit proof assertion now checks `applicable: true`; the prior test incorrectly required non-empty state-delta rows even though the scripted bundle produces none.

## Verification

- `bun run --cwd packages/protocol test`: passed (149 tests).
- `bun run --cwd packages/core test`: passed (831 tests).
- `bun run --cwd packages/protocol typecheck`: passed.
- `bun run --cwd packages/core typecheck`: passed.
- `bun turbo typecheck`: passed (6 packages).
- `bun turbo test`: passed (6 packages; core 831 tests, no failures).
- Inspected changes for ground-truth/secret leakage and unauthorized source access; scenario uses only the existing fixture snapshot and no OpenCode code was borrowed.

## Scope note

Task 5's diff adds only the narrative agreement demo path, not disputed/witness coverage. The existing integrated disputed-to-probe-to-terminal-CAS case is `packages/core/test/runner/judge-runner.test.ts`, test `Tier 2 probe dispatch and result are committed with terminal outcome via CAS`; it scripts disputed consensus, one bounded `run_state_probe`, and an UNVERIFIED verdict. `packages/core/test/runner/witness-resolution.test.ts` also covers witness bounds and unresolved outcomes.

## Follow-up: disputed witness demo

Added `disputed-witness` to the offline demo. It uses a sanitized assertion-free PoC because the witness port is available only on that path (narrative-only reports do not expose the sandbox witness), records a typed `balanceOf(attacker)` delta from scripted sandbox stages, and asserts ordered stage events, one bounded `run_state_probe` request/completion, and deterministic usage. Investigation confirms `JudgeStep` validates exact targeted condition and before/after values, adequate delta explanation, and snapshot-resolved citations in the intended post-witness acceptance path. However, persisted consensus is held in prior items while the current step response is the next model output; the demo scripts had placed the consensus marker as a response, so `consensusStatus` was undefined on the subsequent step and that branch never ran. The latest fixture now scripts the marker as the response after the backward result, then again as the next response to enter the witness branch, but the implementation still ends UNVERIFIED because consensus is read from `input.items` before processing the current response. This reproduces an implementation gap in how consensus transitions into witness handling; no evidence-backed verdict was accepted, and the demo explicitly asserts UNVERIFIED rather than claiming one. Resolving Task 5's evidence-backed verdict requirement needs a safe runner-flow change to recognize/persist consensus before witness handling, preserving the targeted delta checks and snapshot citation validation.

Follow-up verification: focused `packages/core/test/demo/demo.test.ts` and `bun run --cwd packages/core typecheck` passed; no live API or Docker used. The demo test is the reproducer for the unresolved policy/flow gap.
