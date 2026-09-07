## Why

Over time, temporary linter report files (`eslint.json`, `eslint_report.txt`) accumulated in the repository root directory, and legacy pre-OpenSpec draft documents (`docs/specs/tv6/`) remained alongside the canonical `openspec/specs/` single source of truth. Cleaning up and reorganizing these files will streamline workspace navigation, prevent AI agent context drift, and ensure strict compliance with repository protocol `00-global-protocol.md`.

## What Changes

- **Move Root Artifacts**: Relocate `eslint.json` (186 KB) and `eslint_report.txt` (55 KB) from workspace root to `docs/050-Research/outputs/` as raw analysis artifacts.
- **Archive Legacy Specs**: Move legacy TV6 draft spec files from `docs/specs/tv6/` to `docs/archive/legacy-specs/tv6/` to avoid confusion with main `openspec/specs/`.
- **Maintain Workspace Hygiene**: Ensure workspace root contains only standard package, engine, and configuration entrypoints.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- None (`skip_specs: true` set in `.openspec.yaml` as this is a workspace hygiene and documentation refactoring change).

## Impact

- Affected Files: `eslint.json`, `eslint_report.txt`, `docs/specs/tv6/`.
- System Impact: Zero impact on application code or test runners. Improves developer and AI agent documentation lookup precision.
