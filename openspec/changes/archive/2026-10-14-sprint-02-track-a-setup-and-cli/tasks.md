# Tasks

## 1. Workspace Expansion and Package Manifests

- [x] 1.1 (Dev A / TV6, Sprint 2) Scaffold package manifest and TypeScript configuration for `@harness/cli` in `packages/cli/package.json` and `packages/cli/tsconfig.json` adapted from OpenCode `packages/cli`, linking catalog dependencies, initial stub, and recording attribution in `NOTICE`; verify with `bun run --cwd packages/cli typecheck`.
- [x] 1.2 (Dev A / TV6, Sprint 2) Scaffold package manifests and TypeScript configurations for `@harness/schema`, `@harness/llm`, and `@harness/server` adapted from OpenCode package layouts with initial `src/index.ts` export stubs, removing their `.gitkeep` markers and recording in `NOTICE`; verify with `bun run typecheck` across all populated packages.
- [x] 1.3 (Dev A / TV6, Sprint 2) Add root workspace scripts `cli:run` and `cli:view` to root `package.json` delegating to `@harness/cli`; verify root scripts execute with `--help` without syntax or path resolution errors.

## 2. Runtime Configuration and Secret Protection

- [x] 2.1 (Dev A / TV6, Sprint 2) Create `.env.example` template documenting `DATABASE_URL`, `PROVIDER_NAME`, `MODEL_NAME`, `MODEL_API_KEY`, `MODEL_TIMEOUT_MS`, and `MODEL_MAX_OUTPUT_TOKENS` with development defaults; verify file presence and variable completeness against `docs/sprint-02-gap-analysis.md`.
- [x] 2.2 (Dev A / TV6, Sprint 2) Implement typed configuration loader and Zod validation schema in `packages/cli/src/config.ts` enforcing limits, parsing numbers, and failing fast on missing keys; verify with unit tests in `packages/cli/test/config.test.ts`.
- [x] 2.3 (Dev A / TV6, Sprint 2) Implement secret redaction utility masking API keys and scrubbing credentials from database connection URLs, adapting redaction patterns from OpenCode with attribution header and `NOTICE` entry; verify with unit tests in `packages/cli/test/redaction.test.ts`.

## 3. CLI Run and View Commands

- [x] 3.1 (Dev A / TV6, Sprint 2) Implement CLI argument parser in `packages/cli/src/index.ts` adapted from OpenCode CLI command handling supporting `--prompt`, `--id`, `--model`, `--timeout`, and `--help`; verify with argument parsing tests in `packages/cli/test/cli-args.test.ts`.
- [x] 3.2 (Dev A / TV6, Sprint 2) Implement the `run` command coordinating prompt submission through pluggable execution hooks and formatting terminal output (run ID, state, response, token usage, latency, cost); verify with automated scenario tests in `packages/cli/test/cli-run.test.ts`.
- [x] 3.3 (Dev A / TV6, Sprint 2) Implement the `view` command retrieving run summary and chronological trajectory events from persistent storage; verify with unit tests covering both found and missing run scenarios in `packages/cli/test/cli-view.test.ts`.

## 4. Documentation and Integration Verification

- [x] 4.1 (Dev A / TV6, Sprint 2) Author `docs/environment-setup.md` documenting local PostgreSQL startup, Drizzle migration commands, `.env` file configuration, and running CLI commands; verify all documented commands match workspace scripts.
- [x] 4.2 (Dev A / TV6, Sprint 2) Verify monorepo typecheck and architecture boundary rules; verify `bun turbo typecheck` and `bun test` pass across the workspace with zero failures.
