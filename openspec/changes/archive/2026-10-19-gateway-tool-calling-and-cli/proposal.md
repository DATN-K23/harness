## Why

Tracks A, B and C of Sprint 3 are done and hardened. The runner, source tools and snapshot can run a multi-turn model–tool chain, but only against a scripted gateway. The real gateway (`packages/llm`) and the CLI are the missing half of the Sprint 3 goal: "đăng ký repository → tạo snapshot → model thật yêu cầu đọc/tìm source → runtime chạy tool → model nhận kết quả và trả lời", persisted and viewable after a restart.

An explore pass on 2026-10-18 read the gateway, the CLI and OpenCode `packages/llm` at `3f393d78bf`. It found that a real model can never call a tool today:

- **Request side:**
  - `RealModelGateway` sends no `tools`, ignores `toolsDisabled` and `maxToolCalls`, and sends no output-token limit.
  - `MODEL_MAX_OUTPUT_TOKENS` is validated by the CLI but never reaches the runner or the provider.
  - The message converter puts tool arguments into the assistant's text content and splits parallel tool calls into separate assistant turns. OpenAI accepts that history, but other providers reachable through the same proxy may reject it, and it misrepresents what the model said.
- **Response side:**
  - Malformed tool-argument JSON is silently turned into `{ raw }` and dispatched as a normal call.
  - A response cut by the output limit while emitting a tool call is reported as `tool_calls`.
  - `content_filter` and unknown finish reasons become `stop`.
- **Cost:** an unpriced model reports `costUsd: 0`, so "unknown" cannot be told apart from "free".
- **CLI:** it has no repository registration and no snapshot selection. `run` only drives the single-turn runner, and `view` prints raw events with no per-step model, tool and usage breakdown.

This change completes Track D:

- the gateway supports real tool calling;
- the CLI covers register source → run → view again;
- configuration, limits and errors can be checked end to end from the CLI to the provider.

It serves RQ1:
- the direct-model arm (X) stays the single-turn `run`;
- the Harness arm (Y) becomes runnable on a real provider;
- the cost per run becomes honest.

It also prepares the provider seam for RQ3. It produces no experimental result.

## What Changes

- **Gateway request lowering** (ported from OpenCode `protocols/openai-chat.ts`, `utils/tool-schema.ts` and `shared.ts` as plain TypeScript, without Effect):
  - **Tool definitions:** sent as `tools[]`, with the JSON Schema projected for OpenAI-compatible endpoints.
  - **Tool choice:**
    - `toolsDisabled` maps to `tool_choice: "none"` with no tools sent;
    - `maxToolCalls: 1` maps to `parallel_tool_calls: false`.
  - **Output limit:** `maxOutputTokens` is sent in the field named by the provider profile, `max_tokens` (default) or `max_completion_tokens`.
  - **Assistant turns:** one assistant message per turn carries the turn's text (or `null`) and every tool call of that turn. Each `tool` result message follows it, in call order.
- **Gateway response mapping:**
  - Tool arguments are parsed strictly. Invalid JSON yields a tool call marked with an argument error, never a guessed object.
  - A cut tool call is reported as `length`, not `tool_calls`.
  - `content_filter` and unknown finish reasons become typed errors.
  - Usage keeps provider-reported tokens. Pricing reports `priced` or `unpriced`, and an unpriced attempt is never shown or stored as a cost of 0.
  - Context-window overflow is detected from provider messages (OpenCode `provider-error.ts`) and reported as `invalid_request` with a `context_overflow` classification.
- **Runner seam (with Track C):**
  - A tool call with an argument error is not dispatched. It becomes a `tool.failed` event plus an error tool result, so the model can correct itself in the next turn.
  - A final answer cut by the output limit completes the run with `outputTruncated: true`.
  - A run on an unpriced profile records that the cost budget is not enforced.
- **CLI:**
  - **New commands:** `repo add <path>` ingests a repository into a snapshot through Track A, and `snapshot list` lists stored snapshots.
  - **`run`:** `run --snapshot <id>` drives `MultiTurnRunner` with a `ToolRegistry` bound to that snapshot and the real gateway, with per-run limit flags. `run` without `--snapshot` stays the single-turn direct baseline.
  - **`view`:** shows the snapshot, every model step (model, finish reason, usage, cost or "unknown"), every tool call with its result or error, the stop reason and the observed limits. It reads from a fresh process.
  - **Configuration:** missing or invalid settings fail fast. No silent fallback to a scripted gateway unless `--mock` is given.
  - **Onboarding:** `.env.example` and a runbook.
- **Integration cases on recorded responses (no network):**
  - tool call then answer;
  - wrong configuration;
  - 401, 429 and 5xx errors;
  - timeout;
  - malformed tool arguments;
  - truncation.

  One live provider smoke run is a human-gated task.
- **BREAKING (internal):**
  - `ModelUsage` gains a `pricing` field.
  - `ModelToolCall` gains an optional `argumentsError`.
  - `model_attempts` gains a `pricing` column (migration). Existing rows are read as `priced`.

## Capabilities

### New Capabilities

None. All behaviour extends existing capabilities.

### Modified Capabilities

- `provider-abstraction`:
  - real tool-calling request lowering and response mapping;
  - provider output-token field selection;
  - strict tool-argument parsing;
  - finish-reason mapping;
  - priced and unpriced usage;
  - context-overflow classification.
- `multi-turn-runner`:
  - handling of tool calls with invalid arguments;
  - final answers cut by the output limit;
  - runs on an unpriced profile.
- `cli-run-entrypoint`:
  - repository registration and snapshot listing;
  - the multi-turn `run --snapshot` command;
  - the multi-turn `view`;
  - fail-fast configuration without a silent mock;
  - the runbook.
- `runtime-configuration`: new provider-profile settings (output-token field name, and per-run step, tool-call and cost limits from the environment), recorded in `run.started`.

## Impact

- **Code:**
  - `packages/llm/src/gateway/*` and `packages/llm/src/errors/provider-error.ts`, plus new `tool-lowering.ts` and `response-mapping.ts` with OpenCode attribution headers;
  - `packages/protocol/src/model-gateway.ts`;
  - `packages/core/src/runner/multi-turn-runner.ts` and `run-queries.ts`;
  - `packages/schema/src/db/schema.ts` with a new migration;
  - `packages/cli/src/{index,config}.ts` and `commands/*`, plus new `commands/repo.ts` and `commands/snapshot.ts`.
- **Dependencies:** none new. OpenCode code is ported function by function; `@opencode-ai/llm` and Effect are not imported.
- **Owners:**
  - Track D owns the gateway and the CLI.
  - Track C reviews the runner seam and the summary query.
  - Track A's `SnapshotManager` is used unchanged.
- **Non-goals:**
  - streaming;
  - additional native providers (Anthropic, Gemini, Responses API), deferred to the RQ3 stage, though the lowering layout leaves room for them;
  - the trace UI;
  - any change to evaluation controls, corpus manifests, scorer code or research decisions.
- **Controls kept:**
  - no ground truth reaches requests or events;
  - the gateway never throws and keeps `maxRetries: 0`;
  - every new result-affecting option is a config flag recorded in `run.started`.
