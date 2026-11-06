# Design

## Context
See `proposal.md` for motivation. Currently, `packages/core/src/` has accumulated implementations across disparate folders:
- Bounded read-only tools and tool dispatching are split between `step/parallel-tool-dispatcher.ts` and `testing/in-memory-tool-registry.ts`.
- Source snapshot handling is implemented solely in `testing/in-memory-snapshot.ts`.
- Context engine implementations reside in `testing/fake-context-engines.ts`.
- Capabilities defined in the Blueprint (`audit`, `sandbox`, `eval`) lack dedicated directory homes in `packages/core/src/`.

By adapting OpenCode's modular structure (`tool`, `session`, `filesystem`) while strictly respecting the Blueprint's smart contract security invariants (immutable source, bounded tools, isolated ground truth), we can restructure `packages/core/src/` into maintainable, capability-first modules.

## Goals / Non-Goals

**Goals:**
- Create canonical capability directories under `packages/core/src/`:
  - `source/`: Source snapshot management and verification.
  - `tool/`: Modular tool definitions, individual handlers, and unified `ToolRegistry`.
  - `context/`: Context engine contracts, token estimation, and compaction.
  - `sandbox/`: Sandbox execution contracts and scripted/Docker runner interfaces.
  - `audit/`: Audit mode contracts, exploration orchestrator, and report synthesis.
  - `eval/`: Research evaluation metrics (precision, recall, cost delta) and corpus loader.
- Move existing implementations from `testing/` and `step/` to their canonical homes.
- Maintain 100% backward compatibility via re-export shims so all existing tests pass without modification.

**Non-Goals:**
- Implementing production Docker containers for Foundry in this change (scaffolding interfaces and scripted runners only).
- Implementing full autonomous exploration for Audit mode (scaffolding interfaces and stub runners only).
- Modifying `@harness/protocol` or database schemas.

## Decisions

### 1. Tool Modularization (`packages/core/src/tool/`)
In OpenCode, tools are defined with isolated parameter schemas and dedicated execution handlers.
- `packages/core/src/tool/definitions.ts`: Exports canonical `ToolDefinition` instances for `read_file`, `list_dir`, `glob`, and `grep`.
- `packages/core/src/tool/handlers/`:
  - `read-file.ts`: Bounded line span reading with out-of-range checks.
  - `list-dir.ts`: Bounded directory enumeration.
  - `glob.ts`: Bounded pattern matching.
  - `grep.ts`: Bounded regular expression search.
- `packages/core/src/tool/registry.ts`: `ToolRegistry` class implementing `ToolRegistryPort`, handling JSON argument parsing, schema validation, path normalization, and error result synthesis.
- `packages/core/src/tool/dispatcher.ts`: Move `parallel-tool-dispatcher.ts` here, providing backward-compatible re-export at `packages/core/src/step/parallel-tool-dispatcher.ts`.

### 2. Source Access Modularization (`packages/core/src/source/`)
- `packages/core/src/source/source-snapshot.ts`: Core `SourceSnapshot` implementation and path authorization rules (rejecting `..`, absolute paths, and denied prefixes).
- `packages/core/src/source/in-memory-snapshot.ts`: Moved from `testing/in-memory-snapshot.ts`, with re-export shim remaining in `testing/`.

### 3. Context Engine Modularization (`packages/core/src/context/`)
- `packages/core/src/context/token-estimator.ts`: Token estimation logic (`characters / 4`).
- `packages/core/src/context/context-engine.ts`: Base interfaces and `PassThroughContextEngine`.
- `packages/core/src/context/compaction.ts`: `ThresholdContextEngine` and tool result shaping.
- Re-export shims in `packages/core/src/testing/fake-context-engines.ts` to keep test suites intact.

### 4. Sandbox Scaffolding (`packages/core/src/sandbox/`)
- `packages/core/src/sandbox/sandbox-runner.ts`: Interface and execution contracts for isolated sandbox execution.
- `packages/core/src/sandbox/scripted-sandbox.ts`: Moved from `testing/scripted-stages.ts`, maintaining re-export in `testing/`.

### 5. Audit Mode Scaffolding (`packages/core/src/audit/`)
- `packages/core/src/audit/audit-report.ts`: Structured types for `AuditReport` and `AuditFinding`.
- `packages/core/src/audit/audit-runner.ts`: Initial orchestrator stub for autonomous exploration.

### 6. Evaluation Scaffolding (`packages/core/src/eval/`)
- `packages/core/src/eval/metrics.ts`: Functions for calculating precision, recall, F1, and cost/latency deltas.
- `packages/core/src/eval/corpus-loader.ts`: Interface and types for loading contest datasets with strict contest-level split.

## Risks / Trade-offs

- **Import Churn & Test Breakage**: Moving files across directories risks breaking existing imports.
  *Mitigation*: Retain non-breaking re-export shims at all legacy paths (`step/parallel-tool-dispatcher.ts`, `testing/in-memory-snapshot.ts`, `testing/in-memory-tool-registry.ts`, `testing/fake-context-engines.ts`).
- **Over-Engineering**: Creating empty/stub files without clear purpose.
  *Mitigation*: Every scaffolded file directly corresponds to a capability defined in `blueprint/architecture/system-overview.md` and contains typed contracts and unit test coverage.
