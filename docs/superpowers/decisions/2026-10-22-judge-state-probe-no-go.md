# Task 9 decision: no claim-bound state probe

**Status:** No-go. Production state probing remains unavailable and cannot contribute verdict evidence.

## Why

`DockerFoundrySandbox.runStateProbe` previously ran the generated test and returned an empty `stateDeltas` array regardless of Foundry output. Foundry's normal test output has no structured, authenticated before/after state-value protocol. Parsing arbitrary stdout would not bind values to the exact decomposed claim, target implementation, or a pre/post point; it could also accept incidental or forged output.

The present deny-only PoC policy cannot establish that generated probes preserve the real target implementation rather than mocking, redeploying, or replacing it. The macOS Docker isolation gate is also unverified. These are independent blockers to enabling a probe path.

## Effective behavior

- Production `maxProbeRuns` is fixed at `0`; the Tier 2 probe tool is not offered.
- Production health advertises no state-probe capability.
- The Docker adapter now returns `setup_failed` without launching a compiler or container when `runStateProbe` is called directly, rather than reporting a successful run with fabricated empty evidence.
- No protocol, parser, PoC-policy relaxation, or runtime enablement was added.

## Revisit criteria

Require a reviewed, bounded structured probe protocol that records exact claim expression, target implementation identity, and deterministic before/after values; a policy proof that the generated test cannot replace or mock that target; and the Task 10 verified platform capability gate. Add malformed, duplicate, missing, unrelated-value, output-size, and count-bound tests before any nonzero production probe budget.
