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

Added `disputed-witness` to the offline demo. It uses a sanitized assertion-free PoC because the witness port is available only on that path (narrative-only reports do not expose the sandbox witness), records a typed `balanceOf(attacker)` delta from scripted sandbox stages, and asserts ordered stage events, one bounded `run_state_probe` request/completion, and deterministic usage. Re-inspection shows `JudgeStep` has code for accepting a post-witness verdict only when targeted condition and before/after values match the typed probe evidence, the delta explanation is adequate, and verdict synthesis resolves its snapshot citations. However, the post-witness branch currently exits early with a fixed UNVERIFIED outcome when the persisted consensus is disputed; it does not invoke that acceptance path. A scripted valid response was tested and the run still committed UNVERIFIED. The scenario therefore faithfully checks that unresolved result and measured delta, without claiming a valid verdict or fabricating evidence. The requested evidence-backed final verdict remains a documented implementation gap: resolving it requires changing this disputed-branch policy, which is beyond a fixture-only Task 5 adjustment and must retain the existing evidence gates.

Follow-up verification: focused `packages/core/test/demo/demo.test.ts` and `bun run --cwd packages/core typecheck` passed; no live API or Docker used.
