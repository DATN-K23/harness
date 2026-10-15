# Spec Delta: secure-source-tools

## MODIFIED Requirements

### Requirement: Purpose-built bounded tool contracts
The blueprint SHALL define versioned `read_file`, `list_dir`, `glob`, and text-search inputs, outputs, limits, deterministic ordering, truncation markers, and model-actionable errors. It MUST exclude generic shell and network tools. Tool definitions, schemas, and execution handlers MUST be organized within `packages/core/src/tool/` with a centralized `ToolRegistry` managing parameter validation and error normalization.

#### Scenario: Tool catalog is validated
- **GIVEN** the tool contract and description catalog
- **WHEN** a reviewer checks each exposed operation
- **THEN** every operation is read-only, rooted, bounded, versioned, and independently dispatchable through the registry

#### Scenario: Tools and registry reside in dedicated tool module
- **GIVEN** the implementation of source tools in `packages/core/src/tool/`
- **WHEN** tool registration and parameter schemas are loaded
- **THEN** tool handlers (`read_file`, `grep`, `glob`, `list_dir`) are modularly isolated and dispatchable through `ToolRegistry` without coupling to test fixtures
