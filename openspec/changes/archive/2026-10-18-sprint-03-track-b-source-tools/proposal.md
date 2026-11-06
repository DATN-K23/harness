# Proposal: Sprint 3 Track B - Source Reading Tools

## Why
Sprint 3 requires the agent loop to transition from synthetic in-memory fixtures to real codebases. Track B ("Bộ tool đọc source") provides the four canonical read-only tools (`read_file`, `list_dir`, `glob`, `grep`) connected to immutable source snapshots created by Track A. Adapting existing patterns from OpenCode while enforcing strict Research Invariants (Ground-Truth Isolation R2, path authorization, output bounds, and secret redaction) ensures the model receives safe, bounded, and deterministic source observations.

## What Changes
- **Connect ToolRegistry to `SourceSnapshotPort`**: Adapt `ToolRegistry` and tool handlers to accept and query real source snapshots (`SourceSnapshotPort` / `DiskSourceSnapshot`) alongside the existing in-memory fixtures.
- **Implement Output Bounds & Truncation**:
  - Bound `read_file` line count and byte size.
  - Bound `grep` match count and line length, appending an OpenCode-style truncation marker (`[Output truncated. Showing first X matches...]`).
  - Bound `glob` and `list_dir` result counts.
- **Enforce Strict Ground-Truth Isolation & Security Checks**:
  - Pre-flight path validation (`checkSnapshotPath`) rejecting absolute paths, traversal (`..`), symlinks, and denied prefixes (e.g. ground-truth labels, scoring fixtures, secrets).
  - Secret redaction before tool results cross into runner or trajectory history.
- **Error Normalization**:
  - Ensure all tool executions return structured `ToolExecutionResult` with `isError: true` on failures (syntax errors, file not found, access denied, timeout) instead of throwing unhandled exceptions.
  - Provide actionable, model-friendly error messages adapted from OpenCode to facilitate LLM self-correction.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `secure-source-tools`: Extend tool contracts to mandate disk-backed snapshot integration via `SourceSnapshotPort`, rigorous truncation bounds, and model-actionable error reporting.

## Impact
- **Affected Packages**:
  - `packages/core`: `src/tool/` (`registry.ts`, `definitions.ts`, handlers for `read-file.ts`, `grep.ts`, `glob.ts`, `list-dir.ts`).
  - `packages/protocol`: verify `ToolRegistryPort` and `ToolExecutionResult` compatibility.
- **Dependencies**:
  - Consumes Track A's `SourceSnapshotPort` / `DiskSourceSnapshot`.
  - Supplies tool definitions and execution to Track C (Runner) and Track D (Gateway / CLI).
