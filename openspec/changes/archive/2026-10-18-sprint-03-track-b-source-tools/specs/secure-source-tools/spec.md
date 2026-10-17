# Spec Delta

## MODIFIED Requirements

### Requirement: Purpose-built bounded tool contracts
The blueprint SHALL define versioned `read_file`, `list_dir`, `glob`, and text-search inputs, outputs, limits, deterministic ordering, truncation markers, and model-actionable errors. It MUST exclude generic shell and network tools. Tool definitions, schemas, and execution handlers MUST be organized within `packages/core/src/tool/` with a centralized `ToolRegistry` managing parameter validation and error normalization. The execution handlers SHALL be backed by `SourceSnapshotPort` to operate on immutable disk-backed snapshots. Output size, line counts, and execution timeout MUST be strictly bounded, appending explicit truncation markers when limits are exceeded, and failures MUST return structured non-throwing error results.

#### Scenario: Tool catalog is validated
- **GIVEN** the tool contract and description catalog
- **WHEN** a reviewer checks each exposed operation
- **THEN** every operation is read-only, rooted, bounded, versioned, and independently dispatchable through the registry

#### Scenario: Tools and registry reside in dedicated tool module
- **GIVEN** the implementation of source tools in `packages/core/src/tool/`
- **WHEN** tool registration and parameter schemas are loaded
- **THEN** tool handlers (`read_file`, `grep`, `glob`, `list_dir`) are modularly isolated and dispatchable through `ToolRegistry` without coupling to test fixtures

#### Scenario: Tool execution on disk-backed source snapshot
- **GIVEN** a registered snapshot with ID `snap-123` on disk
- **WHEN** `read_file`, `list_dir`, `glob`, or `grep` is executed via `ToolRegistry.execute()`
- **THEN** content and file listings are resolved via `SourceSnapshotPort` without direct unauthorized host filesystem access

#### Scenario: Bounded tool output and truncation marker
- **GIVEN** a search or read operation that yields more results than configured limits (e.g. max matches or max bytes)
- **WHEN** the tool execution completes
- **THEN** the output is deterministically truncated and an explicit truncation marker `[Output truncated. ...]` is appended to the result content

#### Scenario: Model-actionable non-throwing error reporting
- **GIVEN** an invalid regex pattern, non-existent path, or access violation
- **WHEN** a tool call is executed
- **THEN** `execute()` resolves to a `ToolExecutionResult` with `isError: true` containing a descriptive, model-actionable error message instead of rejecting the Promise
