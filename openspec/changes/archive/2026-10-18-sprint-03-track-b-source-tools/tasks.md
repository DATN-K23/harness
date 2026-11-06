# Tasks

## 1. Tool Contracts and Snapshot Binding

- [x] 1.1 Update `ToolRegistry` options and handlers to accept `SourceSnapshotPort` with `snapshotId` alongside existing in-memory fixtures, and verify with unit tests in `packages/core/test/tool/registry.test.ts`.
- [x] 1.2 Adapt `read_file` handler to read from `SourceSnapshotPort.readLines`, enforcing path authorization via `checkSnapshotPath` and line range boundaries, verified with tests in `packages/core/test/tool/read-file.test.ts`.
- [x] 1.3 Adapt `list_dir` and `glob` handlers to query snapshot file listings from `SourceSnapshotPort.listFiles`, enforcing path boundaries and sorting deterministically, verified with tests in `packages/core/test/tool/list-dir.test.ts` and `glob.test.ts`.
- [x] 1.4 Adapt `grep` handler to search snapshot file contents line-by-line, validating regex syntax and filtering out denied paths, verified with tests in `packages/core/test/tool/grep.test.ts`.

## 2. Resource Limits, Truncation, and Error Handling

- [x] 2.1 Implement truncation markers (`[Output truncated. ...]`) for `read_file` line/byte limits and `grep` match limits (max 100 matches), verified by truncation tests in `packages/core/test/tool/truncation.test.ts`.
- [x] 2.2 Enforce non-throwing error normalization for all tool failures (syntax error, file missing, out of range, access denied, timeout), returning structured `ToolExecutionResult` with model-actionable messages, verified with negative test suites in `packages/core/test/tool/errors.test.ts`.
- [x] 2.3 Integrate secret redaction on tool output contents before returning to runner, verifying no configured secrets or credentials leak in tool output.

## 3. Integration & Conformance Verification

- [x] 3.1 Verify end-to-end tool execution against real `DiskSourceSnapshot` instances created by Track A, ensuring all four tools function correctly on an ingested repository.
- [x] 3.2 Run monorepo typecheck and test suite (`bun turbo typecheck && bun turbo test`) to confirm 0 type errors and 0 test regressions across all packages.
