# Claim-Bound PoC Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unconditional PoC refusal only with structural admission for a narrowly supported, claim-bound test; do not enable PoC execution.

**Architecture:** Server-side `SanitizerPort` parses the submitter test using the pinned Solidity compiler and checks its AST against the static verifier's canonical `unauthorized_state_write` predicate and immutable snapshot. Admission is a prerequisite, never a verdict or execution authorization; production remains disabled.

**Tech Stack:** Bun, TypeScript, solc 0.8.30, existing `SanitizerPort`, immutable snapshot port, Docker/Foundry adapter (not invoked by this plan).

**Spec:** `docs/superpowers/specs/2026-10-22-claim-bound-poc-design.md`

## Global Constraints

- Depends on the static claim contract from `docs/superpowers/specs/2026-10-22-static-claim-verifier-design.md` and its implemented `unauthorized_state_write` predicate.
- Policy admission must not trigger sandbox execution or enable `enablePocExecution`.
- Sandbox is the isolation boundary; text/AST policy is not a substitute.
- Claim and snapshot identity must bind cryptographically to admission output; stale or mismatched evidence rejects.
- Unsupported or ambiguous tests fail closed; no generated/rewritten tests or state probes.

## Review Focus

- Assertion unrelated to claim state: deny; test a passing test asserts the exact state predicate.
- Wrong function/contract/state variable: deny; test each mismatch.
- Mock, etch, deploy-substitute or cheatcode mutation: deny; test known replacement routes and unknown cheatcodes.
- Hidden helper/dynamic/low-level calls and multiple test methods: deny; test no assertion can be hidden behind unsupported indirection.
- Snapshot or claim changes after admission: reject binding/evidence mismatch; test digests differ and stale evidence is refused.

---

### Task 1: Introduce claim-bound admission contract

**Files:**
- Modify: `packages/protocol/src/ports.ts` sanitizer contract types (retain compatibility if needed by core test doubles)
- Test: `packages/protocol/test/` sanitizer result schema tests

**Interfaces:**
- Admitted result contains `claimDigest`, `snapshotId`, `snapshotDigest`, `testContract`, `testFunction`, `assertionSpans`, and `policyVersion: "claim-bound-poc-v1"`.
- Rejected result contains only bounded rule IDs/reasons; no PoC source is placed into diagnostic events.

- [ ] **Step 1: Add failing schema tests** for a valid admitted binding, mismatched/empty digest, unbounded assertion spans, and unexpected keys.
- [ ] **Step 2: Run** protocol tests and observe failure.
- [ ] **Step 3: Add strict typed schema** and preserve deny behavior for legacy callers without a canonical predicate/snapshot identity.
- [ ] **Step 4: Run** protocol tests and typecheck.
- [ ] **Step 5: Commit** `feat(protocol): define claim-bound poc admission result`.

### Task 2: Parse and bind the supported PoC profile

**Files:**
- Modify: `packages/server/src/poc-policy.ts`
- Create if needed: `packages/server/src/claim-bound-poc-parser.ts`
- Test: `packages/server/test/poc-policy.test.ts`

**Interfaces:**
- `sanitize(input: StageInput & { pocCode: string; claim: StaticClaimPredicate; snapshot: SourceSnapshotPort; snapshotDigest: string }) -> Promise<SanitizerResult>`.
- Only one test function, direct target deployment/call and direct supported state assertion are admissible; the test must assert an unguarded write matching `stateVariable` and not matching the declared `authorizationStateVariable`. No helper, dynamic, low-level, external, mock, or state-forging behavior is admitted.

- [ ] **Step 1: Write failing tests** for exact target deployment, unauthorized caller, direct claim-state assertion accepted; unrelated assertion, wrong target/function/state, no assertion, ambiguous tests, helper calls, imports, compiler mismatch and parser errors rejected.
- [ ] **Step 2: Run** `bun test packages/server/test/poc-policy.test.ts`; verify relevant admission cases fail before implementation.
- [ ] **Step 3: Implement** AST-based admission using the same pinned compiler version and stable AST node IDs; ensure unknown cheatcodes and unsupported nodes reject rather than pass.
- [ ] **Step 4: Add digest tests** proving a claim or snapshot change invalidates the admission binding.
- [ ] **Step 5: Run** policy tests and server typecheck.
- [ ] **Step 6: Commit** `feat(server): bind poc admission to claim and snapshot`.

### Task 3: Keep runtime composition disabled and prove no execution

**Files:**
- Modify only if required for typed policy plumbing: `packages/core/src/runner/run-stages.ts`, production composition and immutable config
- Test: `packages/server/test/production-runtime.test.ts`, `packages/core/test/runner/run-stages.test.ts`

**Interfaces:**
- Admission result may be recorded as bounded provenance; it never flips `enablePocExecution` or invokes `SandboxPort` in production.
- Production health continues to report PoC execution disabled and state-probe capability absent.

- [ ] **Step 1: Write failing tests** proving an admitted PoC in the production composition still does not invoke sandbox and health remains disabled.
- [ ] **Step 2: Run** focused tests and observe the behavior/assertion failure.
- [ ] **Step 3: Make the smallest production wiring change** to pass claim/snapshot into policy while preserving the fixed false runtime flag.
- [ ] **Step 4: Run** core/server focused tests and typechecks.
- [ ] **Step 5: Commit** `test(server): keep admitted poc execution behind release gate`.

### Task 4: Record independent release gates and operator limits

**Files:**
- Modify: `packages/server/README.md`, `docs/superpowers/decisions/2026-10-22-judge-state-probe-no-go.md`, SDD progress ledger

- [ ] **Step 1: Document** policy admission versus execution/evidence distinction and the still-disabled production runtime.
- [ ] **Step 2: Run** `bun turbo typecheck`, `bun turbo test`, `git diff --check`.
- [ ] **Step 3: Commit** `docs: record claim-bound poc admission limits`.

**Completion gate:** only the direct supported test profile can be admitted; no PoC is executed and no runtime verdict is produced. A future execution proposal separately requires platform isolation review, claim-bound evidence evaluation and explicit production approval.
