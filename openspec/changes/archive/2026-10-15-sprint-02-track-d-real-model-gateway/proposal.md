# Proposal

## Why

Sprint 2 establishes the core real-execution foundation: submitting a prompt, executing a live model call, persisting the run and trajectory events in PostgreSQL, and inspecting results across process restarts. Currently, `@harness/core` and `@harness/cli` rely exclusively on scripted fakes (`ScriptedModelGateway`), returning hardcoded mock strings without making actual network requests.

To fulfill Track D (Dev D) of Sprint 2 (`docs/sprint-02-gap-analysis.md` §4.4 and `docs/sprint-02.md`), we must implement the real provider gateway adapter in `@harness/llm` (`RealModelGateway`). This serves research questions RQ1 and RQ3 by enabling live model execution against real provider APIs (targeting OpenAI `gpt-4o-mini` and compatible endpoints) with observable single-attempt boundaries, exact token usage and cost accounting, deterministic timeout handling, and strict secret protection.

## What Changes

- **Prioritize OpenCode code and pattern reuse (ADR-008)**: Adapt provider error classification, message mapping, and token pricing patterns from OpenCode (`3f393d78bf`, MIT License) with standardized attribution headers and root `NOTICE` entries.
- **Configure provider SDK in `@harness/llm`**:
  - Add official `openai` SDK with exact pinned version to `packages/llm/package.json`.
  - Configure package exports (`.`, `./gateway`, `./pricing`, `./errors`) and verification scripts.
- **Implement `RealModelGateway` Adapter**:
  - Implement `ModelGatewayPort` from `@harness/protocol` (`executeAttempt(request, signal)`).
  - Convert `ModelAttemptRequest` items and system context into provider Chat Completion requests.
  - Disable provider SDK-internal automatic retries (`maxRetries: 0`) to ensure every externally billable attempt is observable and controlled by the harness orchestrator.
  - Bind per-attempt timeout signals (`AbortSignal` / `AbortController`) directly to API calls.
- **Normalized Response and Cost Accounting**:
  - Return normalized `ModelAttemptResponse` containing `attemptId`, `finishReason`, `content`, `usage` (`promptTokens`, `completionTokens`, `totalTokens`, `costUsd`), and `latencyMs`.
  - Implement a model pricing registry calculating `costUsd` for `gpt-4o-mini` ($0.150 per 1M input tokens, $0.600 per 1M output tokens) and extensible model configurations.
- **Provider Error Normalization & Secret Masking**:
  - Map HTTP/network exceptions (401, 429, 500, network timeouts, connection resets) into `ModelAttemptError` with standardized categories (`transport`, `rate_limit`, `authentication`, `invalid_request`) and `isRetryable` flags.
  - Guarantee zero credential or API key leakage in error messages and telemetry.
- **Integration with Runner and CLI**:
  - Enable `packages/cli` to instantiate `RealModelGateway` when `MODEL_API_KEY` is configured in runtime environment.
- **Research controls & scope discipline**:
  - *Research Question Served*: RQ1 (direct-model baseline vs harness evaluation) and RQ3 (provider comparison foundation).
  - *Explicit Non-Goals*: Provider-hosted web search, code execution in model provider, or hosted tools (strictly prohibited by local tool custody); multi-provider matrix (deferred to later cycles); fine-tuning or training; ground-truth contamination data (strictly isolated).
  - *Non-negotiable Controls*: Strict isolation of ground truth, zero secret persistence or display, observable single-attempt provider boundary.

## Capabilities

### New Capabilities
<!-- None. Provider integration is governed by the existing provider-abstraction capability. -->

### Modified Capabilities
- `provider-abstraction`: Add requirements for concrete real provider gateway adapter (`RealModelGateway`), token cost calculation, and observable single-attempt execution.

## Impact

- **Affected Packages**:
  - `packages/llm`: Add dependency (`openai`), implement `RealModelGateway` (`src/gateway/real-model-gateway.ts`), model pricing registry (`src/pricing/model-pricing.ts`), error normalization (`src/errors/provider-error.ts`), export in `src/index.ts`.
  - `packages/cli`: Enable CLI commands (`run.ts`) to inject `RealModelGateway` when `MODEL_API_KEY` is present.
  - `docs/sprint-02-gap-analysis.md`: Update Track D checklist items and progress status.
  - Root `NOTICE`: Add attribution entries for adapted provider and error handling files.
- **APIs & Dependencies**: Introduces `openai` SDK in `packages/llm`. No breaking changes to `@harness/protocol` or `@harness/core`.
