# Proposal

## Why
Currently, the directory structure of `packages/core/src/` is disorganized and lacks alignment with both the OpenCode reference patterns and the architecture blueprint in `blueprint/architecture/system-overview.md`. Specifically:
1. Source snapshot handling is confined to mock fixtures in `packages/core/src/testing/in-memory-snapshot.ts` rather than an explicit `packages/core/src/source/` module (capability `source_access`).
2. Tool definitions and logic are entangled inside `packages/core/src/step/parallel-tool-dispatcher.ts` and `packages/core/src/testing/in-memory-tool-registry.ts` instead of dedicated, modular tool definitions under `packages/core/src/tool/` as in OpenCode.
3. Context management logic is scattered in `packages/core/src/testing/fake-context-engines.ts` rather than a first-class `packages/core/src/context/` module (capability `agent_runtime` / TV2 Context Engine).
4. Major planned blueprint capabilities (`audit` mode, `sandbox` runner for Docker/Foundry PoC execution, and `eval` research scorer) have no dedicated directory structure or formal placement in `packages/core/src/`.

Restructuring `packages/core/src/` into clean, capability-aligned modules resolves architectural debt before Sprint 3, aligns with OpenCode's proven module boundaries, and establishes the proper scaffolding for real filesystem tools and real sandboxing.

## What Changes
- **Reorganize Tools into `packages/core/src/tool/`**:
  - Extract tool definitions and parameter JSON schemas into `packages/core/src/tool/definitions.ts`.
  - Extract individual tool handlers into `packages/core/src/tool/handlers/` (`read-file.ts`, `grep.ts`, `glob.ts`, `list-dir.ts`).
  - Create a production-ready `ToolRegistry` in `packages/core/src/tool/registry.ts` that unifies parameter validation, bounded execution, and tool failure normalization, moving it out of `testing/`.
  - Update `packages/core/src/step/parallel-tool-dispatcher.ts` to consume the modular tool registry.
- **Establish `packages/core/src/source/` (Capability `source_access`)**:
  - Move snapshot interfaces and snapshot validation into `packages/core/src/source/` (`source-snapshot.ts`, `snapshot-verifier.ts`).
  - Provide base snapshot abstraction that can be backed by in-memory data for testing and local filesystem paths for real runs.
- **Establish `packages/core/src/context/` (Capability `agent_runtime`)**:
  - Move context engine contracts, pass-through engine, and threshold compaction engine from `testing/fake-context-engines.ts` into `packages/core/src/context/` (`context-engine.ts`, `token-estimator.ts`, `compaction.ts`).
- **Scaffold `packages/core/src/sandbox/` (Capability `security / sandbox` / TV4)**:
  - Create `packages/core/src/sandbox/` with interfaces and stubs for Docker `--network none` execution and Foundry `forge test` runners (`sandbox-runner.ts`, `scripted-sandbox.ts`).
- **Scaffold `packages/core/src/audit/` (Capability `audit` mode)**:
  - Create `packages/core/src/audit/` with audit mode contracts, hypothesis interfaces, and placeholder `AuditRunner` (`audit-runner.ts`, `audit-report.ts`).
- **Scaffold `packages/core/src/eval/` (Capability `evaluation / research` / TV5)**:
  - Create `packages/core/src/eval/` with research metric formulas (Precision, Recall, F1, Delta $Y - X$), corpus loader interfaces, and benchmark manifest validators (`metrics.ts`, `corpus-loader.ts`).
- **Preserve Full Backward Compatibility**:
  - Maintain re-exports in `@harness/core` and `@harness/core/testing` so all existing tests, scenarios, and external consumers continue to function without breakage.

## Code Provenance & OpenCode Reuse
- Adapts modular layout patterns from OpenCode reference (`packages/core/src/tool`, `packages/core/src/session`, `packages/core/src/filesystem` at `@ 3f393d78bf`).
- Omits OpenCode mutable coding-assistant modules (`pty`, `file-mutation`, `mcp`, `oauth`) to strictly preserve Harness smart contract security invariants.

## Capabilities

### Modified Capabilities
- `blueprint-structure`: Enforce that `packages/core/src/` adheres to the core capability boundaries specified in the architecture blueprint (`source/`, `tool/`, `context/`, `sandbox/`, `judge/`, `audit/`, `eval/`).
- `secure-source-tools`: Specify that secure source tools (`read_file`, `grep`, `glob`, `list_dir`) and snapshot access are housed in modular directories `packages/core/src/tool/` and `packages/core/src/source/` with strict input bounds and error normalization.

## Impact
- **Internal Structure**: Clear separation of concerns within `packages/core/src/`.
- **Breaking Changes**: None. Re-exports ensure 100% backward compatibility for all existing call-sites and tests.
- **Dependencies**: No external dependencies added.
- **Research Question Served**: Enables clean separation between the direct baseline ($X$) and the harness ($Y$), provides formal home for evaluation metrics (`eval/`), and establishes real filesystem source access for smart contract audits.
