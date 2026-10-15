# Tasks

<!--
Execution Governance:
- Methodology: Spec-Driven Development (SDD) based on specs/blueprint-structure/spec.md and specs/secure-source-tools/spec.md.
- Code Provenance: Adapted modular layout from OpenCode (@ 3f393d78bf, MIT License) with full attribution headers.
- Roles: 1 Subagent executes implementation edits; Main Agent conducts code review against research invariants and verifies acceptance.
-->

## 1. Tool & Source Access Modularization (TV3 / TV4)

- [x] 1.1 Extract tool definitions and parameter JSON schemas into `packages/core/src/tool/definitions.ts` and individual handlers into `packages/core/src/tool/handlers/` (`read-file.ts`, `grep.ts`, `glob.ts`, `list-dir.ts`).
  - Subagent task: Implement modular tool handlers with bounds and error normalization.
  - Main Agent review: Verify path traversal denials and immutable snapshot boundaries.
  - Verification: `bun test packages/core/test/tool` passes.
- [x] 1.2 Implement `ToolRegistry` in `packages/core/src/tool/registry.ts` and relocate dispatcher to `packages/core/src/tool/dispatcher.ts`, keeping re-export shim in `packages/core/src/step/parallel-tool-dispatcher.ts`.
  - Subagent task: Implement `ToolRegistry` and wire dispatcher.
  - Main Agent review: Confirm backward-compatible re-exports and schema validation.
  - Verification: `bun test packages/core/test/step/parallel-tool-dispatcher.test.ts` passes.
- [x] 1.3 Relocate snapshot abstractions to `packages/core/src/source/source-snapshot.ts` and `in-memory-snapshot.ts`, retaining legacy re-export in `packages/core/src/testing/in-memory-snapshot.ts`.
  - Subagent task: Create `packages/core/src/source/` files and shims.
  - Main Agent review: Verify snapshot line indexing (1-based inclusive) and traversal denials.
  - Verification: `bun test packages/core/test/testing/in-memory-snapshot.test.ts` passes.

## 2. Context Engine & Reduction Modularization (TV2)

- [x] 2.1 Move token estimation, context engine contracts, and compaction logic from `testing/fake-context-engines.ts` into `packages/core/src/context/` (`token-estimator.ts`, `context-engine.ts`, `compaction.ts`).
  - Subagent task: Create canonical `context/` module files.
  - Main Agent review: Verify token estimation and layer-6 compaction contracts.
  - Verification: `bun test packages/core/test/testing/fake-context-engines.test.ts` passes.
- [x] 2.2 Provide re-export shims in `packages/core/src/testing/fake-context-engines.ts` ensuring all test consumers remain functional without modifying existing test fixtures.
  - Subagent task: Wire re-exports and verify imports.
  - Main Agent review: Confirm zero broken imports across core test suites.
  - Verification: `bun run --cwd packages/core test` passes cleanly.

## 3. Sandbox, Audit & Evaluation Scaffolding (TV1 / TV4 / TV5)

- [x] 3.1 Scaffold `packages/core/src/sandbox/` (`sandbox-runner.ts`, `scripted-sandbox.ts`) moving scripted sandbox logic out of `testing/` with re-export shim.
  - Subagent task: Scaffold sandbox contracts and relocate scripted sandbox.
  - Main Agent review: Confirm `--network none` and Docker sandbox boundaries are explicitly typed.
  - Verification: `bun test packages/core/test/testing/scripted-stages.test.ts` passes.
- [x] 3.2 Scaffold `packages/core/src/audit/` (`audit-report.ts`, `audit-runner.ts`) defining domain contracts and exploration interfaces for Audit Mode.
  - Subagent task: Create audit mode interfaces and stub runner.
  - Main Agent review: Verify finding and evidence types match blueprint vocabulary.
  - Verification: `bun run --cwd packages/core typecheck` passes.
- [x] 3.3 Scaffold `packages/core/src/eval/` (`metrics.ts`, `corpus-loader.ts`) defining research evaluation metric formulas (Precision, Recall, F1, Delta $Y - X$) and contest manifest interfaces.
  - Subagent task: Implement evaluation metrics and corpus loader types.
  - Main Agent review: Verify ground-truth isolation invariant (scorer holds labels outside agent context).
  - Verification: `bun test packages/core/test/eval` passes with metric unit tests.

## 4. Integration & Workspace Verification (TV4 / TV6)

- [x] 4.1 Update `@harness/core` root exports (`packages/core/src/index.ts`) and testing index (`packages/core/src/testing/index.ts`) to expose the restructured capability modules cleanly.
  - Subagent task: Export canonical modules from core index.
  - Main Agent review: Confirm clean public surface and zero circular dependencies.
  - Verification: `bun turbo typecheck` reports 6/6 packages green.
- [x] 4.2 Run workspace-wide typechecking and test suite (`bun run typecheck && bun run test`) to prove zero regressions across `@harness/protocol`, `@harness/core`, `@harness/schema`, `@harness/llm`, and `@harness/cli`.
  - Main Agent review: Execute full regression pipeline and inspect git diff.
  - Verification: `bun turbo test` passes with 100% green across all 6 packages.
