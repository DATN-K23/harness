# Task 8 decision: no static PASS profile

**Status:** No-go for static verdict synthesis in this MVP. Keep BCE explicitly incomplete and preserve `UNVERIFIED` for narrative-only conclusions. Revisit only with a separately reviewed deterministic claim verifier and evidence contract.

## Why

The current `SnapshotIngestion` compiles bounded snapshot source with solc-js 0.8.30, selects AST declarations by name/reference, and emits at most 16 source slices. This is useful context, not a claim verifier:

- The AST traversal and selected slices do not establish semantic reachability, exploitability, authorization behavior, or the truth of arbitrary report predicates.
- The source-read limits (120 lines/file, 512 KB project, 128 Solidity files) and 16-slice cap intentionally omit information. AST success alone cannot prove the submitted claim is within a complete analysis boundary.
- `JudgeStep` validates verdict schema and snapshot citations, but citation validation proves cited text exists at the requested location; it does not prove the model's interpretation or the absence of an alternate path.
- Treating an “agreed” forward/backward model consensus as proof would contradict the design's explicit rule that consensus alone cannot establish validity. In particular, absence of an observed path/guard must never refute a finding.

A syntactic profile such as “one source file, no imports, no assembly” does not repair this semantic gap. A profile restrictive enough to prove a vulnerability claim would need a new deterministic analyzer for the allowed claim language and predicates, not merely AST coverage checks. No such analyzer or approved claim language exists in this task; inventing one here would be a new research/design decision.

## Evidence in current implementation

- `packages/core/src/ingestion/snapshot-ingestion.ts` returns `{ kind: "incomplete", reason: "bce_unavailable", ... }` even when bounded AST slices are available (line 150). Its extraction is therefore explicitly contextual, not complete.
- `packages/core/src/runner/run-stages.ts` maps incomplete ingestion to `bceStatus: "incomplete"`; all current passed-stage variants set `bceIncomplete: true`.
- `packages/core/src/runner/judge-step.ts` downgrades any otherwise accepted non-UNVERIFIED verdict under incomplete BCE, and separately refuses source-less blocking consensus.
- Existing tests in `packages/core/test/ingestion/snapshot-ingestion.test.ts` assert AST slices remain incomplete, unresolved imports remain incomplete, omitted files remain incomplete, and target mapping is bounded. This is the safe behavior to retain.

## Consequences / revisit criteria

Do not add a “complete-for-profile” status or static PASS route based on AST selection, clean compilation, or model consensus. Existing exact-citation checks remain necessary but are not sufficient for semantic proof. Runtime evidence also remains outside this decision and must satisfy its own sandbox/claim-binding gates.

A future proposal must define a machine-checkable claim subset, deterministic verifier semantics, explicit rejection of unsupported syntax/data/control-flow edges, snapshot-bound evidence provenance, and tests proving both positive verification and fail-closed behavior. It must also record any output-affecting profile in immutable run configuration/telemetry (R1). Until then the supported static result is context-only and incomplete.
