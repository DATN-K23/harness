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
