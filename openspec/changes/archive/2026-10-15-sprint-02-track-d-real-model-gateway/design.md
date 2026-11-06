# Design

## Context

Sprint 2 establishes the minimal end-to-end real execution loop: receiving a user prompt, dispatching a model call to a provider, persisting the run and trajectory events in PostgreSQL via Drizzle ORM, and viewing the results across process restarts.

Currently, the monorepo has completed Track A (CLI and runtime config in `packages/cli`), Track B (single-turn runner in `packages/core`), and Track C (PostgreSQL Drizzle persistence in `packages/schema`). However, model execution is still backed only by scripted fakes (`ScriptedModelGateway`), which return hardcoded strings without contacting real model providers.

Per **ADR-008** (adopting OpenCode's module structure, conventions, and technology stack as the architectural model), the project prioritizes reusing and adapting proven code patterns, structures, and error classification routines from OpenCode (`3f393d78bf`, MIT License), porting them to plain TypeScript with attribution headers and root `NOTICE` entries.

See `proposal.md` for background motivation and `specs/provider-abstraction/spec.md` for requirement contracts.

## Goals / Non-Goals

**Goals:**
- Implement `RealModelGateway` in `packages/llm/src/gateway/real-model-gateway.ts` implementing `ModelGatewayPort` (`packages/protocol/src/model-gateway.ts`).
- Support OpenAI API and OpenAI-compatible endpoints (`gpt-4o-mini`, custom base URLs).
- Enforce the observable single-attempt provider boundary by explicitly disabling provider-internal retries (`maxRetries: 0`).
- Enforce deterministic per-attempt timeouts via `AbortSignal`.
- Implement a model pricing registry in `packages/llm/src/pricing/model-pricing.ts` for exact token usage cost calculation.
- Implement error classification in `packages/llm/src/errors/provider-error.ts` normalizing HTTP/network errors into `ModelAttemptError` with credential scrubbing.
- Export public interfaces from `packages/llm/src/index.ts`.
- Integrate `RealModelGateway` into `packages/cli` so `cli:run` can make live model calls when `MODEL_API_KEY` is configured.
- Execute via Spec-Driven Development (SDD): delegate implementation sub-tasks to subagents and conduct main-agent review against contracts and tests.

**Non-Goals:**
- Provider-hosted code execution, web search, or remote tool calling (strictly prohibited by local tool custody).
- Multi-provider cross-evaluation matrix (Anthropic, Gemini, local models) in this sprint (deferred to later research cycles C11-C12).
- Ground-truth adjudication scoring or benchmark evaluation labels.

## Decisions

### Decision 1: Official Provider SDK Selection (`openai`)
- **Choice**: Use the official `openai` SDK with exact pinned version in `packages/llm/package.json`.
- **Rationale**: The official `openai` SDK provides complete TypeScript typings, native support for `maxRetries: 0`, and seamless compatibility with both direct OpenAI endpoints and standard OpenAI-compatible proxies (OpenRouter, local gateways) through `baseURL`.
- **Alternatives Considered**: Direct `fetch` implementation. Rejected because `openai` SDK handles connection pooling, chunk parsing, and status code typing cleanly while maintaining ADR-008 conformance.

### Decision 2: Observable Single-Attempt Boundary (`maxRetries: 0`)
- **Choice**: Explicitly instantiate `OpenAI` client with `{ maxRetries: 0 }`.
- **Rationale**: Requirement 54 of `provider-abstraction` spec mandates that each invocation of `ModelGatewayPort.executeAttempt` executes at most one externally billable attempt. Automatic SDK retries would hide latency, bypass budget accounting, and violate orchestrator-level retry policy control.

### Decision 3: Context Items to Chat Completion Messages Mapping
- **Choice**: Map `ModelAttemptRequest.items` into standard OpenAI `ChatCompletionMessageParam`:
  - `system_prompt` -> `{ role: "system", content: item.content }`
  - `candidate_finding` / user input -> `{ role: "user", content: item.content }`
  - `model_call` / previous assistant turns -> `{ role: "assistant", content: item.content }`
  - `tool_result` -> `{ role: "tool", content: item.content, tool_call_id: item.toolMeta?.callId ?? "call_0" }`
- **Rationale**: Ensures clear separation of system instructions, user prompts, and conversation turns.

### Decision 4: Pricing Registry and Usage Calculation
- **Choice**: Implement an extensible pricing table in `packages/llm/src/pricing/model-pricing.ts`:
  - `gpt-4o-mini`: input $0.150 / 1M tokens ($0.00000015 / token), output $0.600 / 1M tokens ($0.00000060 / token).
  - `gpt-4o`: input $2.50 / 1M tokens, output $10.00 / 1M tokens.
  - Fallback for unrecognized models: defaults to 0 with warning.
- **Formula**: `costUsd = (promptTokens * inputRate) + (completionTokens * outputRate)`.

### Decision 5: Error Classification and Credential Scrubbing
- **Choice**: Implement `normalizeProviderError(error, secrets)` in `packages/llm/src/errors/provider-error.ts`:
  - HTTP 401 / 403: `category = "authentication"`, `isRetryable = false`.
  - HTTP 429 / quota exceeded: `category = "rate_limit"`, `isRetryable = true`.
  - HTTP 400 / context overflow: `category = "invalid_request"`, `isRetryable = false`.
  - Network timeouts (`AbortError`), socket errors, 5xx: `category = "transport"`, `isRetryable = true`.
  - Scrub all credentials (`sk-...`, connection URLs, Bearer tokens) from error messages before returning.
  - `executeAttempt` wraps all operations in `try/catch` and resolves with `{ finishReason: "error", error: ..., usage: ... }`, never throwing.

### Decision 6: Testing Strategy (Unit and Live API)
- **Choice**:
  - Unit tests in `packages/llm/test/`: verify pricing calculations, message mapping, error normalization, and mock server interactions without requiring real credentials.
  - Conditional live test: executes an actual prompt call against OpenAI only if `MODEL_API_KEY` is present in environment, skipping gracefully otherwise.

### Decision 7: Attribution and OpenCode Reuse (ADR-008)
- **Choice**: Adapt error classification and message mapping patterns from OpenCode (`3f393d78bf`):
  - Add attribution comment header:
    `// Adapted from OpenCode packages/llm/... @ 3f393d78bf (MIT License). See NOTICE.`
  - Register all adapted files in root `NOTICE`.

## Risks / Trade-offs

- **[Risk: Live API test failures in CI due to missing API key]** → *Mitigation*: Test suite uses mocked gateway tests by default, and only exercises live network calls when `MODEL_API_KEY` is explicitly provided.
- **[Risk: Secret leakage through error messages]** → *Mitigation*: Implement mandatory secret scrubbing on all error strings and payloads before resolving.
- **[Risk: Unexpected provider SDK exceptions crashing runner]** → *Mitigation*: Top-level exception boundary in `RealModelGateway.executeAttempt` guarantees a structured error response is always returned.

## Migration Plan

1. Add `openai` to `packages/llm/package.json` with exact version.
2. Implement `packages/llm/src/pricing/model-pricing.ts`.
3. Implement `packages/llm/src/errors/provider-error.ts`.
4. Implement `packages/llm/src/gateway/real-model-gateway.ts`.
5. Export components in `packages/llm/src/index.ts`.
6. Update `packages/cli/src/commands/run.ts` to instantiate `RealModelGateway` when `MODEL_API_KEY` is configured.
7. Implement unit tests in `packages/llm/test/real-model-gateway.test.ts`.
8. Update root `NOTICE` and verify with `packages/core/test/architecture.test.ts`.
