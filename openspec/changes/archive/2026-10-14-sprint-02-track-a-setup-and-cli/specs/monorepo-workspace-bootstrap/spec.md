# Spec Delta

## MODIFIED Requirements

### Requirement: Protocol and core package manifests
`packages/protocol` SHALL be named `@harness/protocol`, `packages/core` SHALL be named `@harness/core`, `packages/cli` SHALL be named `@harness/cli`, `packages/schema` SHALL be named `@harness/schema`, `packages/llm` SHALL be named `@harness/llm`, and `packages/server` SHALL be named `@harness/server`. Each SHALL be `private`, `type: module`, license MIT, and expose its source through an `exports` map. `@harness/core` SHALL additionally expose a `testing` subpath containing deterministic fakes. The `.gitkeep` markers in these populated packages SHALL be removed once real manifest and source files exist; the remaining package directories (`packages/client`, `packages/ui`, `packages/app`, `packages/desktop`) SHALL remain untouched with their `.gitkeep`.

#### Scenario: Public import paths resolve
- **GIVEN** an installed workspace
- **WHEN** a script imports `@harness/protocol`, `@harness/core`, `@harness/core/testing`, `@harness/schema`, `@harness/llm`, or `@harness/cli`
- **THEN** each import resolves to a module in the corresponding package without relative cross-package paths

#### Scenario: Other packages are untouched
- **GIVEN** the change is applied
- **WHEN** the tracked files under `packages/client`, `packages/ui`, `packages/app` and `packages/desktop` are listed
- **THEN** each directory still contains only its `.gitkeep` marker

## ADDED Requirements

### Requirement: Root workspace scripts for operational flow
The repository root `package.json` SHALL expose runnable scripts `cli:run`, `cli:view`, and `db:migrate` that delegate to the corresponding workspace packages (`@harness/cli` and `@harness/schema`).

#### Scenario: Running CLI commands from root delegates to workspace packages
- **GIVEN** a configured workspace with dependencies installed
- **WHEN** a developer invokes `bun run cli:run -- --prompt "test prompt"` or `bun run cli:view -- --id <runId>`
- **THEN** Turborepo or Bun delegates command execution to `@harness/cli` with all command arguments preserved
