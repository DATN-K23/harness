# monorepo-workspace-bootstrap Specification

## Purpose

Defines the Bun/Turborepo workspace layout, configuration baselines, package manifests for protocol and core packages, package dependency boundaries, and OpenCode adaptation attribution.

## Requirements

### Requirement: Bun workspace root
The repository SHALL contain a root `package.json` that declares `packages/*` as workspaces, pins `packageManager` to an exact Bun version, defines a dependency `catalog` for shared versions, and exposes `typecheck`, `test` and `demo` scripts delegating to packages. A root `bunfig.toml` SHALL require exact dependency versions and a minimum release age for newly resolved packages. A root `tsconfig.json` SHALL extend `@tsconfig/bun`, and a `turbo.json` SHALL define `typecheck` and `test` tasks.

#### Scenario: Clean checkout installs and typechecks
- **GIVEN** a machine with the pinned Bun version and no previous `node_modules`
- **WHEN** `bun install` is run at the repository root followed by `bun run typecheck`
- **THEN** both commands exit with status 0 and every workspace package is resolved from the local `packages/` directory

#### Scenario: Version drift is rejected
- **GIVEN** a package manifest that declares a dependency version not present in the root catalog and not exact
- **WHEN** the workspace manifests are checked by the architecture test
- **THEN** the check fails naming the package and dependency

### Requirement: Protocol and core package manifests
`packages/protocol` SHALL be named `@harness/protocol` and `packages/core` SHALL be named `@harness/core`. Each SHALL be `private`, `type: module`, license MIT, and expose its source through an `exports` map. `@harness/core` SHALL additionally expose a `testing` subpath containing the deterministic fakes. The `.gitkeep` markers in these two packages SHALL be removed once real files exist; the other eight package directories SHALL remain unchanged.

#### Scenario: Public import paths resolve
- **GIVEN** an installed workspace
- **WHEN** a script imports `@harness/protocol` and `@harness/core` and `@harness/core/testing`
- **THEN** each import resolves to a module in the corresponding package without relative cross-package paths

#### Scenario: Other packages are untouched
- **GIVEN** the change is applied
- **WHEN** the tracked files under `packages/schema`, `packages/llm`, `packages/server`, `packages/cli`, `packages/client`, `packages/ui`, `packages/app` and `packages/desktop` are listed
- **THEN** each directory still contains only its `.gitkeep`

### Requirement: Dependency direction and browser safety
`@harness/protocol` SHALL have no dependency on any other `@harness/*` package and SHALL NOT import `node:*`, `bun:*`, or any filesystem, process, network or crypto module. `@harness/core` MAY depend on `@harness/protocol` only among internal packages. No package SHALL import another package's non-exported internals.

#### Scenario: Forbidden import is detected
- **GIVEN** a source file in `packages/protocol/src` that imports `node:crypto`
- **WHEN** the architecture test scans protocol sources
- **THEN** the test fails and reports the file and import

#### Scenario: Core depends only on protocol
- **GIVEN** the manifests and sources of `@harness/core`
- **WHEN** internal dependencies are collected
- **THEN** the set equals `{@harness/protocol}`

### Requirement: Package-local test and typecheck commands
Each populated package SHALL provide `typecheck` and `test` scripts that run from the package directory. The repository root SHALL NOT run package tests directly through `bun test`; it SHALL delegate through Turborepo.

#### Scenario: Tests run from a package directory
- **GIVEN** an installed workspace
- **WHEN** `bun test` is run inside `packages/core`
- **THEN** the core test suite executes and exits 0 when all tests pass

### Requirement: Attribution of adapted OpenCode material
Every source or configuration file adapted from the OpenCode repository SHALL begin with a comment naming the OpenCode source path, the OpenCode commit identifier, and the MIT license. A root `NOTICE` file SHALL list each adapted file, its OpenCode origin, and the OpenCode copyright and permission notice. No file SHALL import code from the OpenCode repository at runtime.

#### Scenario: Adapted file lacks attribution
- **GIVEN** a file listed in `NOTICE` whose first lines do not name its OpenCode source path
- **WHEN** the attribution check runs
- **THEN** the check fails naming the file

#### Scenario: No runtime dependency on OpenCode
- **GIVEN** the dependency graph of the workspace
- **WHEN** it is searched for packages whose name starts with `@opencode-ai/` or paths pointing to the OpenCode checkout
- **THEN** no such dependency or path exists
