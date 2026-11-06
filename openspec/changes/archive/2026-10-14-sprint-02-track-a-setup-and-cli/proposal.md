# Proposal

## Why

Sprint 2 establishes the core real-world execution baseline: taking a prompt, invoking a real LLM provider, persisting the result or error into PostgreSQL, and retrieving the run by ID after restart (`docs/sprint-02.md`). While the repository already has an in-memory Agent Loop core in `@harness/core` proven against scripted fakes, all packages required for real external operations (`packages/cli`, `packages/schema`, `packages/llm`, `packages/server`) remain unconfigured placeholders containing only `.gitkeep` markers.

Track A is the operational entrypoint and foundation for Sprint 2: it sets up package manifests across the workspace so packages can install and import public exports cleanly, introduces unified configuration validation with safe secret handling and `.env.example`, provides the CLI entrypoints for prompt execution and historical run inspection, and provides setup instructions for database migrations and runtime execution. Without Track A, the upcoming runner (Track B), persistence adapter (Track C), and real LLM gateway (Track D) cannot be wired together, configured safely, or executed by developers.

This change serves RQ1 (direct baseline vs. Harness) by enabling the first measurable execution pipeline with real model calls and reproducible configuration, while preserving non-negotiable research controls (no ground-truth data in agent context, no API keys in logs or stored payloads).

## What Changes

- **Monorepo workspace expansion (`monorepo-workspace-bootstrap`)**:
  - Configure package manifests (`package.json`, `tsconfig.json`) for `packages/cli`, `packages/schema`, `packages/llm`, and `packages/server` within the Bun workspace.
  - Define explicit public exports and dependency boundaries for newly populated packages:
    - `@harness/cli` depends on `@harness/core`, `@harness/protocol`, `@harness/schema`, and `@harness/llm`.
    - `@harness/schema` depends on `@harness/protocol` and database drivers (`drizzle-orm`, `postgres` / `pg`).
    - `@harness/llm` depends on `@harness/protocol` and provider SDKs.
    - `@harness/server` depends on `@harness/protocol`, `@harness/schema`, and `@harness/core`.
  - Add root scripts to `package.json` for CLI operations (`cli:run`, `cli:view`, `db:migrate`).

- **Runtime configuration and validation (`runtime-configuration`)**:
  - Provide `.env.example` with standard defaults for PostgreSQL connection string (`DATABASE_URL`), provider selection (`PROVIDER_NAME`), model identifier (`MODEL_NAME`), credentials (`MODEL_API_KEY`), timeout (`MODEL_TIMEOUT_MS`), and token limits (`MODEL_MAX_OUTPUT_TOKENS`).
  - Introduce typed configuration loading and schema validation using Zod in `@harness/core` or `@harness/cli`.
  - Emit clear, actionable diagnostic errors when required configuration keys are missing or invalid, without exposing secret values.

- **CLI execution and inspection entrypoints (`cli-run-entrypoint`)**:
  - Implement a command-line interface in `packages/cli`:
    - `run` command: accepts a prompt string, validates parameters, coordinates execution, and outputs run ID, terminal status, model response text, token usage, latency, and estimated cost.
    - `view` command: accepts a `runId`, queries stored run records and ordered trajectory events, and displays execution history and outcomes.
  - Gracefully handle in-flight or failed execution, displaying error categories without leaking API keys or internal stack traces.

- **Environment and migration documentation**:
  - Provide `docs/environment-setup.md` guiding developers through local PostgreSQL setup (e.g. Docker Compose or local server), running Drizzle migrations, configuring `.env`, and executing test prompts.

### Non-Goals
- Implementing the real Drizzle schema and PostgreSQL persistence adapter (owned by Track C).
- Implementing the real LLM provider SDK adapter (owned by Track D).
- Implementing the single-turn runner orchestration logic (owned by Track B).
- Multi-turn Judge agent loop execution with finding/source tools/PoC in this CLI command (deferred to subsequent sprints; Sprint 2 CLI focuses on single-turn prompt execution).

## Capabilities

### New Capabilities
- `runtime-configuration`: Specification for environment variable loading, Zod validation, credential redaction, default execution limits (timeout, output tokens), and missing configuration preflight checks.
- `cli-run-entrypoint`: Specification for the command-line interface providing prompt submission (`run`) and historical run/event inspection (`view`), outputting structured execution metrics and status.

### Modified Capabilities
- `monorepo-workspace-bootstrap`: Expand workspace configuration to include manifests, exports, and dependency rules for `packages/cli`, `packages/schema`, `packages/llm`, and `packages/server`, updating the package directory invariant and root scripts.

## Impact

- **Affected Packages**:
  - `package.json` (root): Add scripts for CLI and workspace coordination.
  - `packages/cli/`: Populate `package.json`, `tsconfig.json`, `src/index.ts`, CLI commands.
  - `packages/schema/`: Populate `package.json`, `tsconfig.json` for Track C preparation.
  - `packages/llm/`: Populate `package.json`, `tsconfig.json` for Track D preparation.
  - `packages/server/`: Populate `package.json`, `tsconfig.json` for server boundary.
- **New Files**:
  - `.env.example`: Template for environment variables.
  - `docs/environment-setup.md`: Setup and run instructions.
- **Dependencies**: Adds CLI parsing library (e.g., `commander` or minimalist argument parser), environment loader, and leverages `zod` from root catalog.
