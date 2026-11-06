# Tasks

## 1. Setup and Package Configuration

- [x] 1.1 (TV1/Dev D, Sprint 2) Configure `packages/llm/package.json` with dependencies (`openai`), export map, and verify `bun install` resolves dependencies cleanly.
- [x] 1.2 (TV1/Dev D, Sprint 2) Configure tsconfig and test scripts in `packages/llm` and verify `bun run --cwd packages/llm typecheck` succeeds.

## 2. Pricing Registry and Error Normalization

- [x] 2.1 (TV1/Dev D, Sprint 2) Implement model pricing registry in `packages/llm/src/pricing/model-pricing.ts` supporting `gpt-4o-mini` and extensible model rates, verifying with unit tests.
- [x] 2.2 (TV1/Dev D, Sprint 2) Implement provider error normalization in `packages/llm/src/errors/provider-error.ts` with error categorization and secret sanitization, verifying with unit tests.

## 3. RealModelGateway Adapter Implementation

- [x] 3.1 (TV1/Dev D, Sprint 2) Implement message conversion from `ModelAttemptRequest` items to provider format in `packages/llm/src/gateway/message-converter.ts` with OpenCode attribution header, verifying role mapping.
- [x] 3.2 (TV1/Dev D, Sprint 2) Implement `RealModelGateway` in `packages/llm/src/gateway/real-model-gateway.ts` satisfying `ModelGatewayPort` with `maxRetries: 0`, AbortSignal timeout, latency tracking, and zero unhandled rejections.
- [x] 3.3 (TV1/Dev D, Sprint 2) Export `RealModelGateway`, pricing registry, and error utilities from `packages/llm/src/index.ts` and verify with `bun run --cwd packages/llm typecheck`.

## 4. Testing, CLI Integration & Verification

- [x] 4.1 (TV1/Dev D, Sprint 2) Implement test suite in `packages/llm/test/real-model-gateway.test.ts` verifying attempt execution, error handling, timeout handling, cost calculation, and secret masking.
- [x] 4.2 (TV1/Dev D, Sprint 2) Integrate `RealModelGateway` into `packages/cli/src/commands/run.ts` so `cli:run` uses `RealModelGateway` when `MODEL_API_KEY` is present in environment.
- [x] 4.3 (TV1/Dev D, Sprint 2) Update root `NOTICE` with OpenCode attribution for adapted `packages/llm/` files and verify monorepo compliance with `packages/core/test/architecture.test.ts` and `bun typecheck`.
- [x] 4.4 (TV1/Dev D, Sprint 2) Update `docs/sprint-02-gap-analysis.md` Track D checklist items and document verification status for Sprint 2 review.
