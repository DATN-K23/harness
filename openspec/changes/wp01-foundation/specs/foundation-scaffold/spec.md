## Purpose

Provides the structural foundation for the modular-monolith harness: directory scaffold, shared kernel, public interface stubs for every capability module, composition roots, contract generation pipeline, architecture boundary enforcement, migration infrastructure, and Tauri three-OS build evidence that all subsequent work packages depend on.

## ADDED Requirements

### Requirement: Capability module scaffold follows physical layout
The system SHALL contain exactly seven capability module directories under `runtime/src/harness/modules/` (`run_control`, `model_gateway`, `source_access`, `agent_runtime`, `judge`, `evaluation`, `scoring`), each with at minimum `public/`, `ports/`, and `__init__.py`.

#### Scenario: All capability directories exist after scaffold
- **WHEN** a developer clones the repository and runs the project setup
- **THEN** all seven module directories exist under `runtime/src/harness/modules/` with `public/` and `ports/` subdirectories

### Requirement: Shared kernel provides cross-cutting types
The system SHALL provide a `shared_kernel/` package containing value types (IDs, enums, error hierarchy) that any capability module's `public/` surface may reference without introducing a cross-capability import.

#### Scenario: Shared kernel importable from any module
- **WHEN** any capability module imports a type from `shared_kernel`
- **THEN** the import succeeds and does not violate the architecture boundary rules

### Requirement: Public interface stubs define cross-capability contracts
Each capability module SHALL expose Python Protocol or abstract base classes in its `public/` directory that define the commands, queries, events, and value types other modules may depend on, without containing implementation logic.

#### Scenario: Public interfaces contain no implementation
- **WHEN** the architecture test suite scans `public/` directories
- **THEN** no file contains concrete business logic, database queries, or provider SDK calls

### Requirement: Import boundary enforcement
The system SHALL include architecture tests that verify the allowed capability import graph defined in `physical-repository-layout.md`. Any import outside the allowed graph MUST cause a test failure.

#### Scenario: Illegal cross-capability import detected
- **WHEN** a module imports from another module's non-public directory (e.g., `scoring` imports from `agent_runtime.domain`)
- **THEN** the architecture boundary test fails with a clear error identifying the violation

#### Scenario: Legal import succeeds
- **WHEN** `agent_runtime` imports from `run_control.public`
- **THEN** the architecture boundary test passes

### Requirement: Composition roots enforce deny matrix
The system SHALL provide entrypoint stubs for `daemon`, `worker`, `evaluator`, and `scorer` that wire only the capabilities listed in their allow column and reject imports from their deny column as defined in `physical-repository-layout.md`.

#### Scenario: Scorer entrypoint cannot import agent runtime
- **WHEN** the scorer entrypoint attempts to import `agent_runtime`
- **THEN** the composition deny-matrix test fails

### Requirement: Contract schema directory structure
The system SHALL contain a `contracts/` directory with `registry.yaml`, `openapi/local-runtime.v1.openapi.yaml`, and per-capability versioned schema directories under `contracts/schemas/`.

#### Scenario: Registry and OpenAPI files present
- **WHEN** a developer inspects the `contracts/` directory
- **THEN** `registry.yaml` and `openapi/local-runtime.v1.openapi.yaml` exist and are parseable YAML

### Requirement: Contract generation pipeline produces typed outputs
The system SHALL include a pipeline that generates Pydantic models from JSON Schemas in `contracts/schemas/` and TypeScript types for the desktop client, writing outputs to `runtime/src/harness/generated/contracts/` and `apps/desktop/ui/src/generated/runtime-client/` respectively.

#### Scenario: Generated contracts match source schemas
- **WHEN** the generation pipeline runs
- **THEN** generated Python and TypeScript files exist at the expected output paths and are importable/compilable

#### Scenario: Generated contract drift detection
- **WHEN** a source schema changes but the generation pipeline is not re-run
- **THEN** a drift detection test fails

### Requirement: PostgreSQL migration infrastructure
The system SHALL include a migration runner under `runtime/migrations/` with `env.py`, `registry.py`, and at least one empty initial migration that proves the pipeline executes without error against a PostgreSQL instance.

#### Scenario: Empty migration runs successfully
- **WHEN** the migration runner executes against an empty PostgreSQL database
- **THEN** the migration completes without error and the migration history table exists

### Requirement: Tauri host skeleton compiles on three operating systems
The system SHALL include a minimal Tauri 2 Rust host under `apps/desktop/src-tauri/` containing `Cargo.toml`, `tauri.conf.json`, `capabilities/main-window.json`, `src/main.rs`, and `src/lib.rs` that compiles successfully on Windows, macOS, and Linux.

#### Scenario: Three-OS build evidence
- **WHEN** the Tauri project is built on Windows, macOS, and Linux
- **THEN** each build produces a platform-appropriate executable and build logs are archived as evidence

#### Scenario: Main window capability restricts native authority
- **WHEN** the `capabilities/main-window.json` file is inspected
- **THEN** it does NOT grant generic filesystem, shell, process, environment, URL opener, raw secret, or direct updater permissions

### Requirement: Desktop UI skeleton serves as Tauri webview content
The system SHALL include a React/Vite skeleton under `apps/desktop/ui/` with `package.json`, `tsconfig.json`, `vite.config.ts`, and a minimal `src/app/` entry that renders in the Tauri webview.

#### Scenario: UI skeleton builds and loads in Tauri
- **WHEN** `pnpm install && pnpm build` runs in `apps/desktop/ui/`
- **THEN** the build succeeds and produces distributable static assets

### Requirement: Tool JSON Schemas for source-access
The system SHALL include JSON Schema files under `contracts/schemas/source-access/v1/` defining the input/output shapes for the four initial tools: `read_file`, `list_dir`, `search`, and `glob`.

#### Scenario: Tool schemas are valid JSON Schema
- **WHEN** each schema file is validated against JSON Schema meta-schema
- **THEN** all four schemas pass validation

### Requirement: Security policy fixtures
The system SHALL include fixture files for workspace policy, redaction rules, and native-command denial lists that downstream security tests (WP-05) can import.

#### Scenario: Policy fixtures parseable
- **WHEN** the policy/redaction/native-denial fixture files are loaded
- **THEN** they parse without error and contain at least one rule each

### Requirement: Synthetic evaluation fixtures
The system SHALL include synthetic (non-real) provider profile and experiment manifest fixtures that downstream evaluation tests (WP-08) can import for interface validation.

#### Scenario: Synthetic fixtures schema-valid
- **WHEN** the synthetic provider profile is validated against `providers/provider-profile.schema.json`
- **THEN** it passes structural validation

### Requirement: Clean bootstrap on another machine
The system SHALL be bootstrappable from a clean clone using only documented toolchain installation steps and `uv sync` / `pnpm install` / `cargo build` without undocumented manual configuration.

#### Scenario: Fresh clone setup
- **WHEN** a new developer clones the repository on a machine with only the documented toolchains installed
- **THEN** `uv sync`, `pnpm install` (in `apps/desktop/ui/`), and `cargo build` (in `apps/desktop/src-tauri/`) all succeed

### Requirement: Table ownership enforcement
The system SHALL include an architecture test that verifies each database table listed in `physical-repository-layout.md` is owned by exactly one capability module and that no module issues direct queries against another module's tables.

#### Scenario: Table ownership attributed to single module
- **WHEN** the table-owner test runs against the migration registry
- **THEN** every registered table maps to exactly one capability module and no cross-capability table query exists

### Requirement: ADR-007 readiness cases planned
The system SHALL include a readiness plan document that maps each of the ten ADR-007 readiness cases (R01–R10) to the future work package and timeline window responsible for producing its evidence, ensuring none are accidentally omitted from later implementation.

#### Scenario: All ten readiness cases assigned
- **WHEN** the readiness plan document is inspected
- **THEN** all ten cases (R01–R10) have an assigned WP, owner, and earliest timeline window

### Requirement: Complete directory scaffold includes config, datasets, and packaging
The system SHALL scaffold `config/{runtime,flags,providers,evaluation}/`, `datasets/{README.md,manifests/,synthetic/}`, and `packaging/local-runtime/{env.example,healthcheck/}` directories as defined in `physical-repository-layout.md`, even when initially empty.

#### Scenario: Ancillary directories exist
- **WHEN** a developer inspects the repository after scaffold
- **THEN** `config/runtime/`, `config/flags/`, `datasets/`, and `packaging/local-runtime/` directories exist

### Requirement: Contract examples directory
The system SHALL include `contracts/examples/valid/` and `contracts/examples/invalid/` directories containing at least one sample JSON file each, demonstrating correct and incorrect contract payloads for downstream validation testing.

#### Scenario: Example files parseable and categorized
- **WHEN** the valid example files are validated against their corresponding schema
- **THEN** all valid examples pass and all invalid examples fail validation
