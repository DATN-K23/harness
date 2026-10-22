# Claim-bound PoC admission — design

## Intent

Define when a submitter-provided Foundry test is sufficiently bound to one structured claim to be considered for execution and evidence. Do not relax production execution gates in this work.

## Goals

- Parse PoC Solidity structurally using the repository-pinned compiler/parser; do not treat regular-expression checks as a security boundary.
- Require exactly one target test and a deterministic mapping from the structured claim predicate to its assertions and target implementation.
- Establish that the test deploys/uses the actual immutable snapshot implementation and cannot replace, mock, etch, fork, or substitute it.
- Reject unsupported syntax/cheatcodes, external calls, imports outside the snapshot, unbounded execution, ambiguous assertions, helper indirection not analyzed, and tests that can pass without checking the claim.
- Produce a typed admission result with claim digest, snapshot digest, test function identity, assertion spans, and bounded rejection codes.
- Keep production PoC execution false and health capability absent until the policy and sandbox are separately reviewed and explicit release gates are met.

## Candidate initial claim subset (not approved for admission)

Candidate scope is the static verifier's `unauthorized_state_write` predicate. The predicate remains unapproved until it can distinguish caller-local accounting from unauthorized cross-account/state effects. Do not admit PoCs against this predicate until that semantic gap is resolved. A future policy would require a canonical claim identity (contract/function, mutated state variable and authorization state variable), and the parsed test must:

1. Deploy the exact target implementation sourced from the immutable snapshot through an approved deployment fixture.
2. Call the named target function as a caller that does not meet the declared authorization condition.
3. Assert the exact claimed state predicate after the call, using a direct supported equality/inequality assertion.
4. Avoid mocks, cheatcodes that mutate or substitute target state/code, low-level/dynamic calls, external/network interaction, and non-local assertion logic.

The first release may conservatively reject every test rather than accept a false binding. A policy pass is only admission, not proof; execution results are not verdict evidence unless a separate evidence evaluator binds actual test outcome to the admitted claim and target identity.

## Non-goals

- Enabling Docker/Foundry execution in production, increasing `maxProbeRuns`, generating or rewriting tests, or treating exit code as evidence.
- Proving arbitrary Foundry tests safe, supporting arbitrary assertion helpers or complex setup fixtures, or supporting more than one claim class.
- Replacing the sandbox with parser policy. Parser admission is defense in depth; isolation remains mandatory.

## Architecture

Keep policy in the server adapter implementing `SanitizerPort`; have it consume a typed claim/predicate and immutable snapshot identity, and return a typed admitted/rejected result. Core must preserve fail-closed behavior when admission is unavailable or incomplete. Any eventual runtime evidence must include matching claim digest, snapshot digest, target identity, parsed test identity, structured Foundry result, and sandbox provenance.

## Independent release gates

- Static verifier profile is implemented and reviewed; otherwise the policy has no canonical claim predicate to bind.
- Parser and snapshot binding tests prove the actual deployed target is the exact snapshot contract.
- Sandbox isolation is validated for the supported host/runtime/image; Task 10's single Docker Desktop observation is not cross-version certification.
- Evidence evaluator distinguishes assertion failure from setup/harness failure and ignores arbitrary stdout and process exit alone.
- Explicit production approval is recorded before any execution flag can be enabled.

## Acceptance tests

- Exact supported claim-bound fixture is admitted but never executed by production composition.
- Assertion-free test, unrelated assertion, wrong target/function/state, alternate implementation, mock/replacement cheatcodes, hidden helper assertions, ambiguous tests, unsupported AST, import escape, and compiler/parser uncertainty are denied.
- Changing claim or snapshot changes the binding digest; stale/mismatched evidence is rejected.
- Production health/config continue to show PoC execution disabled and no state-probe capability.

## Calls made by implementer

- Scope is restricted to one claim type and direct assertion form.
- An allow decision cannot trigger execution; this is a policy-only prerequisite.
- Production remains deny-only until the independent release gates are approved.
