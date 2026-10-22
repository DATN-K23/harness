# Deterministic static claim verifier — design

## Intent

Allow a static PASS/FAIL only for a deliberately small Solidity claim language whose truth can be established by deterministic analysis of the immutable snapshot. Anything outside that language, or outside the analyzed source profile, remains `UNVERIFIED`.

## Goals

- Add an explicit, versioned, machine-readable claim predicate only after its security semantics are approved; do not infer a verdict predicate from free-form prose or model consensus.
- Verify the predicate from solc AST and exact snapshot source, with complete-profile checks before any negative/absence conclusion.
- Emit snapshot-bound evidence with exact file/line ranges and verifier/profile version.
- Reject unknown constructs, unresolved calls/inheritance/modifiers, compiler errors, truncated source, unsupported language versions, and ambiguous mapping as incomplete.
- Keep the existing `JudgeVerdict` wire contract; use its existing PASS/FAIL/UNVERIFIED values.

## Candidate initial profile (not approved for verdicts)

Candidate property: **an externally callable target function writes a named state variable without an authorization guard**. This is not an approved security predicate: absence of an owner-style guard does not establish unauthorized behavior (for example, caller-local accounting updates may be intentionally permissionless). Do not map this candidate to PASS/FAIL until the semantics distinguish intended caller-local updates from unauthorized cross-account/state effects. Require all of the following before any future implementation may decide:

- A canonical `unauthorized_state_write` predicate naming exactly one contract, function, mutated state variable, and authorization state variable, selected explicitly in structured input (not guessed by the LLM).
- One uniquely resolved concrete contract and one public/external function in one complete snapshot source unit.
- No inheritance, modifiers, assembly, delegate/low-level calls, external calls, internal function calls, libraries, unresolved imports, or unsupported control flow in the target function.
- Every state write and every authorization-relevant branch in the target body is understood by the verifier. The initial authorization grammar recognizes only direct `require(msg.sender == <authorizationStateVariable>)` before direct writes in a straight-line body; all other expressions/control flow reject as unsupported.
- No guard in the supported grammar and a reachable write of the named state variable yields `PASS` for the predicate. A supported guard dominating every write yields `FAIL`. Mixed paths, partial guarding, unknown expressions, or unsupported syntax yield `UNVERIFIED`.

This is not a general Solidity vulnerability verifier. Even a complete syntactic profile is insufficient until predicate semantics are sound. Any implemented profile must be versioned and included in immutable run configuration/telemetry (R1). It must not use AST slice absence as proof: completeness is established over the entire compilation unit and target body before evaluating the property.

## Non-goals

- General call-graph/data-flow completeness, arbitrary vulnerability classification, arithmetic or economic reasoning, proxy/delegatecall analysis, or model-consensus verdicts.
- Expanding the verdict wire schema or changing unsupported claims to invalid.
- Enabling PoC execution; that belongs to its own design and remains an independent path.

## Architecture

Keep compiler/parser and deterministic predicate evaluation in core ingestion/verifier code behind existing snapshot ports. The verifier returns a typed result: `verified` with predicate truth and exact evidence, or `incomplete` with a bounded reason code. `JudgeRunner` may synthesize PASS/FAIL only from `verified`; it must preserve `UNVERIFIED` for every other result. Model output may identify a candidate predicate for review but cannot authorize the profile or supply its proof.

## Security and research controls

- Ground-truth/adjudication/scoring keys remain rejected at every trust boundary.
- All reads are through immutable `SourceSnapshotPort`; no host paths or alternate repository access.
- Compiler version, claim profile ID/version, supported constructs and completeness outcome are recorded without secrets.
- The verifier must not claim that unsupported or absent syntax is proof of safety.

## Acceptance tests

- A supported unguarded state write produces a deterministic PASS with exact snapshot citation.
- A supported authorization guard dominating all writes produces deterministic FAIL with exact citation.
- Branches where only some paths are guarded, unknown guard expressions, helper calls, modifiers, inheritance, assembly, missing/truncated sources, ambiguous targets and compiler errors all remain UNVERIFIED.
- Mutating source after snapshot creation cannot change the result; citation line ranges resolve through the snapshot.
- Model-supplied PASS/FAIL without a verifier result is downgraded to UNVERIFIED.

## Calls made by implementer

- Begin with exactly one predicate. Do not add optional predicate extensibility until this profile has independent review and fixtures.
- Unknown and unsupported cases are `UNVERIFIED`, never `FAIL`.
- Existing contract/wire schema is retained.
