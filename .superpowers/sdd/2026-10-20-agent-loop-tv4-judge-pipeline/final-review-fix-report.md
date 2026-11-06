# Final whole-branch review fixes

## Changes

- Bound `run_state_probe` expressions to exact text in the deconstructed claim's `claimedState` or `claimedImpact`. The check runs before sanitizer injection and sandbox execution; verdict synthesis also verifies the claim target.
- Reject incomplete narrative-only claims at ingestion as `UNRESOLVED`/`UNVERIFIED`, before ordinary model adjudication. The minimal protocol validator requires at least one target contract/function plus nonempty root cause, attack scenario, claimed impact, and claimed state.
- Updated Task 1's reference note: the controller inspected the OpenCode files in the original checkout; those files were absent from this worktree, and the Task 1 implementer did not inspect them. No Task 1 code adaptation occurred.

## Verification

Commands run from the indicated package directories:

```text
packages/core: bun test test/runner/judge-runner.test.ts test/judge/adjudication-step.test.ts test/demo/demo.test.ts
40 pass, 0 fail, 213 expect() calls

packages/protocol: bun test test/ports.test.ts
8 pass, 0 fail, 22 expect() calls

packages/core: bun run typecheck
tsc --noEmit (exit 0)

packages/protocol: bun run typecheck
tsc --noEmit (exit 0)
```

The full monorepo test and typecheck commands were not run.
