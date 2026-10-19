## Context

The multi-turn chain is complete inside `@harness/core`:

```
disk snapshot (A) → ToolRegistry (B) → MultiTurnRunner (C) → ModelGatewayPort
```

It is tested with `ScriptedModelGateway` only. Track D owns the two ends that touch the outside world: `@harness/llm` (`RealModelGateway`, message converter, pricing, error normalisation) and `@harness/cli` (composition root).

**Current state, read on 2026-10-18:**

- **`RealModelGateway`:**
  - It builds `{ model, messages, temperature?, seed? }` only: no `tools`, no `tool_choice`, no output limit.
  - It ignores `toolsDisabled`, `tools`, `maxToolCalls` and `maxOutputTokens`, although all of them are in `ModelAttemptRequest`.
- **`convertToChatMessages`:**
  - It maps each `tool_request` item to its own assistant message, and sets that message's `content` to the argument JSON.
  - The runner stores `req1, res1, req2, res2` per turn, so parallel calls are replayed as separate assistant turns.
  - The text the model wrote next to its tool calls is never stored as a context item, so it is missing from the next request and from the trajectory.
- **Response mapping:**
  - Invalid argument JSON becomes `{ raw }`.
  - `tool_calls` is checked before `length`.
  - Every other finish reason becomes `stop`.
- **Pricing:** `calculateModelCost` returns 0 for unknown models, and `model_attempts.cost_usd` is `NOT NULL`.
- **CLI:**
  - `run` drives `SingleTurnRunner` only.
  - `view` prints raw events.
  - `MODEL_MAX_OUTPUT_TOKENS` is validated but never used.
  - `executeRunCommand` silently builds a scripted gateway when no API key is injected.

**Reference:** OpenCode `packages/llm` at `3f393d78bf` (MIT). Its `protocols/openai-chat.ts` already solves these request and response problems. It is written against Effect v4 beta, ships as a private package and streams over its own HTTP route layer.

**Constraints:**
- The gateway never throws.
- `maxRetries: 0`.
- No ground truth in requests or events.
- Every result-affecting option is a config flag recorded in `run.started` (Rule R1).
- Track D must not change research artifacts: evaluation controls, corpus and scorer.

**Owners:**
- Track D: `packages/llm` and `packages/cli`.
- Track C: approves the runner seam (D6 to D8) and `run-queries.ts`.
- Track A: `SnapshotManager` is consumed unchanged.

## Goals / Non-Goals

**Goals:**
- A real OpenAI-compatible model sees the tool definitions, calls tools, receives the results with matching call IDs, and answers.
- History is replayed exactly as the model produced it.
- Every provider outcome is typed: tool request, final answer, truncation, invalid output, or error.
- Usage and cost are honest: an unpriced model is never shown as free.
- `repo add` → `run --snapshot` → `view` works across processes against PostgreSQL. Missing configuration fails fast.
- Integration cases run offline on recorded responses.

**Non-Goals:**
- Streaming.
- Native Anthropic, Gemini, Responses or Bedrock adapters. These are deferred to the RQ3 stage, but D2 keeps one seam per protocol.
- The trace UI and the HTTP server.
- Changes to evaluation controls, corpus manifests, scorers or research decisions.
- Provider retries. Retry policy stays in `provider-retry-policy` and is unchanged.

## Decisions

### D1. Port OpenCode functions; do not depend on `@opencode-ai/llm`

The relevant functions are copied as plain TypeScript, each file with the attribution header `// Adapted from OpenCode packages/llm/src/<path> @ 3f393d78bf (MIT License). See NOTICE.`

| OpenCode source | Harness target | What is kept |
|---|---|---|
| `protocols/openai-chat.ts` `lowerTool`, `lowerToolChoice` | `llm/src/gateway/tool-lowering.ts` | `{type:"function",function:{name,description,parameters}}`, `auto`/`none` |
| `protocols/utils/tool-schema.ts` `openAI` | `tool-lowering.ts` | Root `type: "object"`, `anyOf` flattening, null-variant removal |
| `openai-chat.ts` `lowerAssistantMessage`, `lowerToolMessages` | `gateway/message-converter.ts` (rewritten) | One assistant message per turn with `content` text or `null` and all `tool_calls`, then one `tool` message per result |
| `openai-chat.ts` `mapFinishReason`, `finishEvents`; `shared.ts` `parseToolInput`, `totalTokens` | `gateway/response-mapping.ts` | Finish-reason table, `stop` + tool calls → tool calls, strict JSON parsing, optional token totals |
| `provider-error.ts` `isContextOverflow` | `errors/provider-error.ts` | The overflow message patterns and exclusions |

**Alternatives considered:**
- Importing `@opencode-ai/llm` was rejected:
  - the package is private and runs on Effect v4 beta;
  - it brings its own transport, auth and retry layers, which would conflict with the OpenAI SDK, the zero-retry rule and the never-throw gateway.
- Rewriting on the Vercel AI SDK was rejected: it adds a new dependency and still needs the same mapping rules.

### D2. Keep non-streaming Chat Completions through the OpenAI SDK; one lowering module per wire protocol

- The non-streaming `choice.message.tool_calls` already carries complete arguments, so OpenCode's stream accumulator (`ToolStream`, `Lifecycle`) is not needed. Its rules are kept: parse once, fail explicitly, treat `stop` with tool calls as tool calls.
- The lowering and mapping functions take a profile so that `anthropic-messages` and `gemini` modules can be added at the RQ3 stage without changing the port.
- **Alternative considered:** streaming now. Rejected: it adds partial-result persistence questions that belong to the context and agent-loop stage.

### D3. Rebuild assistant turns from history, grouped by step

- **Lowering:** the converter groups context items by `turn`. For each turn that contains `tool_request` items, it emits:
  1. one assistant message with `content` set to that turn's `assistant_reasoning` text, or `null`;
  2. `tool_calls` listing every request of the turn in call order, where each call's `arguments` is the stored argument string;
  3. then one `tool` message per `tool_result`, in the same order.
- **Runner seam (Track C):** the runner persists the model's text for a tool-calling turn as an `assistant_reasoning` item before the turn's `tool_request` items. The persisted trajectory then equals what the model said.
- An orphan `tool_result` with no matching request in the same turn is a lowering error and fails the attempt before any network call. This mirrors OpenCode's refusal of malformed tool order.

### D4. Output-token field chosen by the provider profile

- `maxOutputTokens` is sent as `max_tokens`, the OpenCode default for Chat Completions. `MODEL_OUTPUT_TOKENS_FIELD=max_completion_tokens` switches it for models that reject `max_tokens`.
- The value and the field name are recorded in `run.started`, and every request carries the limit.
- **Alternative considered:** detecting the field from the model name. Rejected: proxies rename models, and a hidden guess breaks Rule R1.

### D5. Tool choice and parallel calls

- When `toolsDisabled` is set or `tools` is empty, the gateway sends neither `tools` nor `tool_choice`. In the disabled case it sends `tool_choice: "none"` only if the history already contains tool messages (some providers require tool definitions or a choice to be present when the history has tool calls).
- When `maxToolCalls === 1`, the gateway sends `parallel_tool_calls: false`.
- Both behaviours derive from existing runner limits, so they need no new flag.

### D6. Strict argument parsing: invalid JSON is reported, never guessed

`ModelToolCall` gains `argumentsError?: string`. When the argument string is not a JSON object:

- the gateway returns the call with `arguments: {}`, `argumentsError` set to a short parser message, and the raw argument string sanitized (full tier) and capped at 2,000 characters;
- the runner (Track C) does not dispatch the call. It persists the `tool_request` item with the raw string, then an error `tool_result` saying "Tool arguments were not valid JSON: …", and records `tool.failed` with `failureKind: "invalid_arguments"`;
- the call counts toward `maxToolCalls`, so a model that keeps sending broken JSON is still bounded.

**Alternative considered:** failing the whole attempt with an `invalid_provider_output` error, which is what OpenCode does. Rejected as the default because Harness measures agent robustness, and letting the model repair one bad call is cheaper than ending the run. This decision is gate G1, confirmed by Track C before tasks 3.x.

### D7. Finish reasons and error classification

| Provider finish | Tool calls present | Harness result |
|---|---|---|
| `tool_calls` / `function_call` | any | `tool_calls` |
| `stop` | yes | `tool_calls` |
| `stop` | no | `stop` |
| `length` | any | `length`; tool calls are dropped and not dispatched |
| `content_filter` | any | `error`, category `invalid_request`, classification `content_filter` |
| missing or unknown | any | `error`, category `invalid_request`, classification `invalid_provider_output` |

- `ModelAttemptError` gains an optional `classification`: `context_overflow`, `content_filter` or `invalid_provider_output`. Categories are unchanged, so the runner's terminal-reason mapping keeps working (`invalid_request` → `provider_permanent`).
- Context overflow is detected with the ported OpenCode patterns on 400 and 413 responses.
- **Runner seam:**
  - a `length` response without usable tool calls ends the run `completed`, with `outputTruncated: true` in the run result and the `run.completed` payload;
  - a `length` response is never treated as a tool request.

### D8. Priced versus unpriced usage

- **Protocol:** `ModelUsage` gains `pricing: "priced" | "unpriced"`. `costUsd` stays a number (0 when unpriced) so budget arithmetic and existing doubles keep compiling.
- **Gateway:** sets `unpriced` when the pricing registry has no entry. `MODEL_INPUT_COST_PER_MTOK` and `MODEL_OUTPUT_COST_PER_MTOK` can price a proxy model explicitly; both values are recorded in `run.started`.
- **Persistence:**
  - a migration makes `model_attempts.cost_usd` nullable and adds `pricing text not null default 'priced'`;
  - the store writes `NULL` for unpriced attempts;
  - `runs.cost_usd` is `NULL` when any attempt of the run is unpriced.
- **Runner:**
  - on an unpriced profile the cost ceiling cannot be enforced; `run.started` records `costBudgetEnforced: false`, and the cost pre-call guard is skipped (consistent with design D12 of `harden-snapshot-tools-runner`);
  - the run result's usage carries `pricing: "unpriced"` once any attempt is unpriced.
- **CLI:** prints "unknown" and a warning at run start, never `$0.000000`.
- **Alternative considered:** `costUsd: number | null` in the protocol. Rejected: it touches every budget comparison in core for no extra information.

### D9. CLI composition

- **`repo add <path> [--include-root <dir>]... [--snapshot-id <id>]`:** calls `SnapshotManager.ingestRepository` into the storage directory, which is `HARNESS_SNAPSHOT_DIR`, defaulting to `<repo>/data/snapshots`. It prints the snapshot ID, the file count and the skipped counts by reason.
- **`snapshot list`:** reads the manifests in the storage directory and prints ID, file count, tree digest, ingestion policy version and creation time.
- **`run --snapshot <id> --prompt <text>`:**
  - wiring: `DiskSourceSnapshot` + `ToolRegistry({ snapshot, snapshotId })` + `MultiTurnRunner` + `RealModelGateway` + `PostgresRunStore`;
  - limit flags: `--max-steps`, `--max-tool-calls`, `--max-output-tokens`, `--max-total-tokens`, `--max-cost-usd`, `--timeout`. Each flag overrides the environment, which overrides the defaults;
  - prints the run ID, the terminal state and reason, usage and cost (or "unknown"), and the output.
- **`run` without `--snapshot`:** stays the single-turn direct baseline (RQ1 arm X).
- **`--mock`:** swaps in the in-memory store and a scripted gateway that calls `read_file` once and then answers. It is the only path to a scripted gateway; the silent fallback in `executeRunCommand` is removed.

### D10. Multi-turn `view`

- `view --id <runId>` detects multi-turn runs by their `context.item_added` and `tool.*` events, and renders from `getMultiTurnExecutionSummary` plus the attempt rows:
  - a header with state, terminal reason, snapshot ID, prompt digest, effective limits and observed limits;
  - one block per step with model, finish reason, tokens, cost or "unknown", and latency;
  - the step's tool calls: name, arguments, status, duration, truncation flag, and the first 300 characters of the result or the error.
- `--json` prints the same structure for scripts.
- Single-turn runs keep today's view.
- `run-queries.ts` (Track C) adds per-step attempt data to the summary.

### D11. Offline integration cases on recorded responses

- `RealModelGatewayOptions.client` already allows injecting a client. Tests use a recording client that captures the request body and replays JSON fixtures in `packages/llm/test/fixtures/recordings/` (the idea is taken from OpenCode `http-recorder`; the Effect code is not used).
- Fixtures cover:
  - a tool call followed by a final answer;
  - two parallel tool calls;
  - malformed arguments;
  - `length` during a tool call;
  - `content_filter`;
  - 401, 429 with `Retry-After`, 500 and 400 context overflow;
  - a timeout.
- CLI tests drive `runCli` with the same client through an injectable gateway factory.

### D12. Live smoke run is human-gated

One run against the team's real provider (`repo add` on a small Solidity fixture → `run --snapshot` → `view` from a new process) is task G2. It needs the user's key and spends money, so it runs only after explicit approval, with `--max-cost-usd` set.

## Risks / Trade-offs

- **[Risk] The proxy (9router) rejects `parallel_tool_calls` or `tool_choice` for some backends.**
  → Both are sent only when needed (D5). Errors surface as typed `invalid_request` results. A per-profile switch can be added if the live smoke run (G2) shows the problem.
- **[Risk] Re-sending raw invalid argument text could leak a host path the model invented.**
  → The raw string is sanitized with the full tier and capped before it is stored or replayed (D6).
- **[Risk] Grouping by `turn` breaks on histories written before D3, which have no `assistant_reasoning` item.**
  → The converter treats a missing text as `null`. Old histories still lower correctly, only without the text.
- **[Trade-off] An unpriced profile disables the cost ceiling.**
  → This is recorded per run (`costBudgetEnforced: false`) and warned in the CLI. Evaluation runs can require priced profiles later; that is a research decision outside this change.
- **[Risk] The migration changes a `NOT NULL` column.**
  → The change only relaxes it, existing rows default to `priced`, and rollback is `ALTER COLUMN … SET NOT NULL` after back-filling 0.
- **[Trade-off] No streaming, so long answers wait for the whole response.**
  → `MODEL_TIMEOUT_MS` bounds the wait. Streaming is deferred (D2).

## Migration Plan

1. Land the protocol additions (`pricing`, `argumentsError`, `classification`). They are optional or defaulted in doubles, so existing tests keep compiling.
2. Add the migration `0002_attempt_pricing.sql`, apply it with `bun run db:migrate`, and keep it backward-compatible.
3. Ship the gateway, then the runner seam, then the CLI.
4. Rollback: revert the commits and the migration. Older runs stay readable because `pricing` defaults to `priced`.

## Provider probe (2026-10-18)

A local 9router `0.5.104` was set up with the user's Codex account only. It was bound to `127.0.0.1:20128` with `REQUIRE_API_KEY=true` and auto-update off. Seven direct calls were made, and one call through `RealModelGateway` + `SingleTurnRunner`.

| Check | Result | Consequence for this change |
|---|---|---|
| Missing API key | 401 | Key enforcement works |
| `cx/gpt-5.5` | 400 "not supported when using Codex with a ChatGPT account" | Use `cx/gpt-6-luna` |
| Plain prompt, about 8 tokens | 200, `prompt_tokens` 2,494 | About 2,490 hidden prompt tokens are injected upstream. The pre-call estimate (`estimatePromptTokens`) undercounts them, but the post-response token budget still uses the reported usage. The persisted trajectory is not byte-identical to what the model saw; runbook and run reports must state this |
| `max_tokens: 16` / `max_completion_tokens: 16` | Both ignored (403 completion tokens, `stop`) | D4 still sends the field (spec checks the captured request). On this provider the output cap is enforced only by the runner's post-response budget. The runbook must state this |
| `tools` + forced tool use | `tool_calls` with call ID and JSON arguments | Tool calling works through 9router |
| Tool-result round trip | Correct answer from the tool content | Call-ID linkage works |
| Pricing | `cx/...` absent from the registry | Unpriced unless G3 prices are set |

## Open Questions

- **G1 (Track C):** confirm D6, which reports invalid arguments to the model rather than failing the attempt. Default: D6 as written. **Resolved 2026-10-18:** the user approved D6 as written.
- **G2 (team):** which provider, model and budget to use for the live smoke run, and whether the model needs `MODEL_OUTPUT_TOKENS_FIELD=max_completion_tokens`. **Resolved 2026-10-18:** 9router with `cx/gpt-6-luna` on the user's Codex credits, which the user allows to be used freely for this project. Output fields are ignored by this provider, so the default `max_tokens` stays.
- **G3 (team):** whether explicit per-model price variables (D8) are acceptable for proxy models, or whether the pricing table must be edited in code instead. Default: variables, recorded in `run.started`.
