# Design

## Context

The repository currently contains `@harness/protocol` (defining core schemas, ports, and event contracts) and `@harness/core` (implementing the reasoning loop, retry policies, and in-memory test fakes). Four target package directories (`packages/cli`, `packages/schema`, `packages/llm`, `packages/server`) remain unconfigured directory stubs containing only `.gitkeep`.

Sprint 2 establishes the end-to-end real execution flow: prompt input → real model invocation → PostgreSQL persistence → retrieval by run ID (`docs/sprint-02.md`). Track A is responsible for the operational scaffolding: setting up workspace package manifests, defining configuration loading with safe credential handling, implementing the CLI run and inspection commands, and writing developer onboarding instructions.

## Goals / Non-Goals

**Goals:**
- Configure package manifests (`package.json`, `tsconfig.json`, `src/index.ts`) for `packages/cli`, `packages/schema`, `packages/llm`, and `packages/server`.
- Provide a standardized `.env.example` file declaring database and provider parameters.
- Implement a typed, Zod-based configuration loader (`loadRuntimeConfig`) with missing-key preflight errors and credential masking.
- Build a CLI in `packages/cli` providing `run` (submit prompt) and `view` (inspect run and events) commands.
- Expose root workspace scripts (`cli:run`, `cli:view`) delegating through Bun/Turborepo.
- Provide `docs/environment-setup.md` documenting PostgreSQL setup, migrations, and CLI usage.

**Non-Goals:**
- Authoring Drizzle tables, migration SQL, or PostgreSQL client code (Track C).
- Authoring LLM provider SDK integration or price calculation tables (Track D).
- Authoring the core single-turn execution runner or multi-turn judge loop (Track B).
- Building desktop UI or HTTP API server endpoints (deferred to subsequent sprints).

## Decisions

### 1. Scaffold all populated workspace packages with initial export stubs
- **Decision:** Create `package.json`, `tsconfig.json`, and minimal `src/index.ts` files for `packages/cli`, `packages/schema`, `packages/llm`, and `packages/server`.
- **Rationale:** Bun workspaces and Turborepo require valid package manifests to resolve dependency graphs. Scaffolding all four packages in Track A allows Tracks B, C, and D to develop against cleanly exported types and modules without encountering resolution errors.
- **Alternatives considered:** Scaffolding only `packages/cli` in Track A and leaving the others to Tracks C and D. Rejected because it fragments workspace setup and prevents repository-wide `typecheck` commands from succeeding.

### 2. Lightweight CLI argument parsing using built-in `util.parseArgs`
- **Decision:** Implement CLI command parsing using Node/Bun's built-in `util.parseArgs` in `packages/cli/src/index.ts`.
- **Rationale:** Avoids pulling in heavy third-party CLI dependencies (e.g. `commander`, `yargs`). `util.parseArgs` provides native support for flags (`--prompt`, `--id`, `--model`, `--timeout`) with zero runtime overhead and full TypeScript type inference.
- **Alternatives considered:** `commander` or `cac`. Rejected to keep dependencies minimal and aligned with OpenCode's minimalist core dependencies.

### 3. Centralized runtime configuration loading with Zod
- **Decision:** Implement runtime configuration loading in `@harness/cli` (or shared config utility) using `zod` (already cataloged in `package.json`).
- **Rationale:** Zod allows declarative schemas with transformations (e.g. parsing integer port/timeout from strings), default fallbacks, and structured error reporting. Missing keys result in exit code 1 with actionable messages.
- **Alternatives considered:** Manual `process.env` checks. Rejected because manual checks are error-prone and lack consistent error formatting.

### 4. Secret redaction at error and display boundaries
- **Decision:** Introduce a redaction utility that scrubs values of sensitive environment variables (`MODEL_API_KEY`, database passwords) from error messages and output strings.
- **Rationale:** Non-negotiable project controls forbid printing credentials in ordinary logs, trajectories, or terminal traces.

### 5. Decoupled CLI architecture with dependency injection
- **Decision:** The CLI entrypoint will accept or instantiate runner and storage interfaces adhering to `ModelGatewayPort` and `RunStorePort`. In Track A, the CLI will support running with current in-memory fakes when database or real API configuration is absent, while providing the clean hook for Track B runner and Track C/D adapters.
- **Rationale:** Enables Track A to have automated unit and scenario tests verifying argument parsing, error formatting, and output display independently of external network and database availability.

### 6. Prioritize OpenCode code and configuration reuse with attribution
- **Decision:** When applying code, prioritize adapting package manifests, configurations, CLI structures, and error/redaction utilities directly from the reference OpenCode checkout (`opencode` repository, commit `3f393d78bf`).
- **Rationale:** Speeds up delivery, aligns with existing OpenCode patterns already established in root configuration (`bunfig.toml`, `turbo.json`, `package.json`) and `@harness/core` (`retry-policy.ts`, `id.ts`), and avoids reinventing monorepo conventions.
- **Attribution and compliance:** In accordance with `monorepo-workspace-bootstrap` requirements and root `NOTICE`:
  - Every adapted TypeScript/JavaScript source file MUST begin with the attribution header comment naming the OpenCode source path, commit hash, and MIT license.
  - JSON files and manifests MUST be recorded in the root `NOTICE` under the "Adapted files" section.
  - No `@opencode-ai/*` package will be added as a runtime dependency.

## Risks / Trade-offs

- **[Risk] Missing database during early testing**: Developers running the CLI before Track C finishes Drizzle migrations will encounter database connection errors.  
  → *Mitigation*: The CLI preflight checks configuration and provides clear, actionable instructions pointing to `docs/environment-setup.md`.
- **[Risk] Sensitive credentials leaked in database connection strings**: If a PostgreSQL connection string fails, the error message may contain the embedded password.  
  → *Mitigation*: Sanitize URL strings by stripping userinfo (`user:password@`) before logging connection errors.
- **[Risk] Architecture test failures on new packages**: Existing architecture tests in `packages/core/test/architecture.test.ts` may enforce package boundaries.  
  → *Mitigation*: Verify and update architecture boundary checks to explicitly allow `@harness/cli` to depend on core, schema, and llm packages.
