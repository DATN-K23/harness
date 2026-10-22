# Deterministic Static Claim Verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic Solidity claim profile only after its security semantics distinguish vulnerability from intended behavior; otherwise preserve UNVERIFIED.

**Architecture:** Keep parsing and verification in core using the pinned solc AST and `SourceSnapshotPort`. A typed verifier result can authorize verdicts only after the predicate's security semantics are approved; model consensus and citations alone never authorize PASS/FAIL. Record the profile version in the immutable run config.

**Tech Stack:** Bun, TypeScript, `solc` 0.8.30, Zod contracts, existing JudgeRunner and snapshot ports.

**Spec:** `docs/superpowers/specs/2026-10-22-static-claim-verifier-design.md`

## Global Constraints

- Unsupported, ambiguous, incomplete, or out-of-profile claims remain `UNVERIFIED`.
- No absolute host paths, traversal, symlink escapes, or reads outside immutable `SourceSnapshotPort`.
- No model consensus or AST slice omission may establish truth or absence.
- Do not add wire verdict fields; profile configuration affecting output is explicit and snapshotted.
- Do not change PoC execution or state-probe gates in this plan.

## Review Focus

- Unsupported control flow, helper calls, modifiers or inheritance: test each is incomplete before verdict synthesis.
- Partially guarded writes/branching: test it cannot be classified as FAIL or PASS.
- Ambiguous/duplicate target or state variable: test it remains UNVERIFIED.
- Missing/truncated/imported source and compiler errors: test completeness fails closed.
- Model-provided PASS/FAIL without verifier evidence: test the verdict remains UNVERIFIED.

---

### Task 1: Define the versioned predicate/result contract

**Files:**
- Modify: `packages/protocol/src/` claim/verdict configuration contracts and exports
- Test: `packages/protocol/test/` contract/schema tests

**Interfaces:**
- Produces `StaticClaimPredicate` for exactly `unauthorized_state_write`, with `contractName`, `functionName`, `stateVariable`, and `authorizationStateVariable` strings.
- Produces `StaticVerificationResult = { kind: "verified"; predicate: StaticClaimPredicate; truth: "true" | "false"; profileId: "solidity-unauthorized-state-write-v1"; evidence: BceSlice[] } | { kind: "incomplete"; reason: bounded reason code }`.
- Reject extra keys and malformed identities; preserve current `JudgeVerdict` schema.

- [ ] **Step 1: Write failing schema tests** for accepted canonical predicate/result and rejected extra key, wrong profile, empty names, malformed evidence, and unknown reason.
- [ ] **Step 2: Run** `bun test packages/protocol/test/<new-contract-test>.test.ts`; verify missing schemas fail.
- [ ] **Step 3: Implement** strict Zod schemas and exports in the existing protocol contract module used for run configuration.
- [ ] **Step 4: Run** the new test and `bun run --cwd packages/protocol typecheck`; expect all pass.
- [ ] **Step 5: Commit** `feat(protocol): define static claim verification contract`.

### Task 2: Implement fail-closed verifier for the one profile

**Files:**
- Create: `packages/core/src/ingestion/static-claim-verifier.ts`
- Modify: `packages/core/src/ingestion/snapshot-ingestion.ts` only to expose complete snapshot compilation material as needed
- Test: `packages/core/test/ingestion/static-claim-verifier.test.ts`

**Interfaces:**
- `verifyStaticClaim(input: { snapshot: SourceSnapshotPort; snapshotId: string; predicate: StaticClaimPredicate; signal?: AbortSignal }): Promise<StaticVerificationResult>`.
- Reuse `solc` 0.8.30; use the whole required source unit, not `astSlices`, and exact byte-offset-to-line mapping.

- [ ] **Step 1: Write failing fixtures** for direct unguarded named-state write → true, direct `require(msg.sender == authorizationStateVariable)` before writes → false, and branching/mixed guard → incomplete.
- [ ] **Step 2: Run** `bun test packages/core/test/ingestion/static-claim-verifier.test.ts`; verify profile cases fail before implementation.
- [ ] **Step 3: Add failing tests** for helper/internal/external calls, inheritance, modifiers, assembly, low-level calls, unknown guards, ambiguous targets, imports, source bounds, compile errors, and abort.
- [ ] **Step 4: Implement** complete-profile validation first; only evaluate truth when every target body construct and every write/guard is in the supported grammar. Unknown syntax returns bounded `incomplete` reason codes.
- [ ] **Step 5: Run** the verifier test file and core typecheck; all listed cases must pass and all unsupported cases remain incomplete.
- [ ] **Step 6: Commit** `feat(core): verify bounded unauthorized state write claims`.

### Task 3: Bind verified result to Judge verdict and run snapshot

**Files:**
- Modify: `packages/core/src/runner/run-stages.ts`, `packages/core/src/runner/judge-runner.ts`, `packages/core/src/runner/judge-step.ts`, run-config snapshot schema
- Test: `packages/core/test/runner/judge-runner.test.ts`, `packages/core/test/runner/run-config-snapshot.test.ts`

**Interfaces:**
- `IngestionResult` may carry the explicit structured predicate; natural-language fields do not synthesize it.
- The verifier result is the only route to static PASS/FAIL; model-derived verdicts without verified evidence are downgraded to UNVERIFIED.

- [ ] **Step 1: Write failing runner tests** proving verified true/false map to existing PASS/FAIL with exact citations and incomplete/absent/forged model verdict stays UNVERIFIED.
- [ ] **Step 2: Run** the targeted tests and observe the expected failure.
- [ ] **Step 3: Implement** verifier invocation and verdict mapping; record `profileId` and profile version in immutable run configuration before any provider call.
- [ ] **Step 4: Test** source mutation after snapshot, exact evidence line ranges, unsupported report predicate, and model-supplied false evidence.
- [ ] **Step 5: Run** `bun run --cwd packages/core test`, `bun turbo typecheck`, and `git diff --check`.
- [ ] **Step 6: Commit** `feat(core): gate static verdicts on verified claim evidence`.

### Task 4: Document evidence limits and release behavior

**Files:**
- Modify: `packages/server/README.md`, static no-go decision doc, SDD progress ledger
- Test: existing core/server suites; no new runtime capability test unless production wiring changes

- [ ] **Step 1: Update docs** to state the single supported predicate, explicit unsupported syntax, and that this is not a general smart-contract verifier.
- [ ] **Step 2: Run** `bun turbo typecheck`, `bun turbo test`, `git diff --check`.
- [ ] **Step 3: Commit** `docs: document bounded static verifier profile`.

**Completion gate:** no static PASS/FAIL for any input until the named predicate's semantics are independently reviewed; unsupported or incomplete always yields UNVERIFIED. Independent security review is required before claiming the verifier is sound or broadening its profile.
