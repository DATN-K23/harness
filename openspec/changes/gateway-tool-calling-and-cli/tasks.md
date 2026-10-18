Owners follow `docs/sprints/sprint-03.md`: C = runner/history, D = gateway/CLI. Track A's `SnapshotManager` and Track B's tools are used unchanged. Every task targets Sprint 3, Track D completion, unless a gate says otherwise.

**Testing:** light, one focused test per spec scenario. Gateway and CLI tests use a recording client with JSON fixtures, never the network. The optional result-affecting behaviours are the output field and the explicit prices. Each is added with its config flag, its `run.started` record and enabled/disabled tests in the same task.

**Reuse:** each ported file carries `// Adapted from OpenCode packages/llm/src/<path> @ 3f393d78bf (MIT License). See NOTICE.` Read the source with `git -C D:/DATN/opencode show 3f393d78bf:<path>`. Do not modify the OpenCode checkout.

## 0. Gates

- [ ] 0.1 [Gate G1; Owner: C] Confirm design D6: tool calls with invalid arguments are reported to the model rather than failing the attempt.
  - Default: D6 as written.
  - Evidence: a note in this file. Tasks 3.2 and 3.3 depend on it.

## 1. Protocol and persistence contracts

- [ ] 1.1 [Owner: D with C] Extend `packages/protocol/src/model-gateway.ts`. All additions are optional or defaulted in test doubles, so existing tests keep compiling.
  - `ModelUsage.pricing: "priced" | "unpriced"`.
  - `ModelToolCall.argumentsError?: string` and `rawArguments?: string`.
  - `ModelAttemptError.classification?: "context_overflow" | "content_filter" | "invalid_provider_output"`.
  - Update `ScriptedModelGateway` helpers to emit `pricing: "priced"` by default.
  - Evidence: protocol schema tests for each field.
- [ ] 1.2 [Owner: D with C] Add migration `packages/schema/drizzle/0002_attempt_pricing.sql`.
  - `model_attempts.cost_usd` becomes nullable.
  - Add `pricing text not null default 'priced'`.
  - `PostgresRunStore` writes `NULL` cost for unpriced attempts. `runs.cost_usd` is `NULL` when any attempt is unpriced.
  - Evidence: the store contract suite still passes; an unpriced-attempt round trip test, which skips without PostgreSQL.

## 2. Gateway (ported from OpenCode `packages/llm`)

- [ ] 2.1 [Owner: D] Add `packages/llm/src/gateway/tool-lowering.ts`.
  - Port `lowerTool` and `ToolSchemaProjection.openAI` from `protocols/openai-chat.ts` and `protocols/utils/tool-schema.ts`.
  - Apply design D5: no tools when disabled or empty; `parallel_tool_calls: false` when `maxToolCalls === 1`.
  - Keep `validateAttemptRequestTools` before any network call.
  - Evidence: the three "Tool definitions and tool choice" scenarios.
- [ ] 2.2 [Owner: D] Rewrite `packages/llm/src/gateway/message-converter.ts` per design D3, porting `lowerAssistantMessage` and `lowerToolMessages`.
  - Group items by turn: one assistant message per tool turn, with text or `null` plus all calls; then tool messages in call order.
  - An orphan result is an `invalid_request` before the network.
  - Evidence: the "Parallel calls stay in one assistant message" and "Orphan tool result is rejected" scenarios; existing converter tests are updated.
- [ ] 2.3 [Owner: D] Add `packages/llm/src/gateway/response-mapping.ts`, porting `mapFinishReason`, `finishEvents`, `parseToolInput` and `totalTokens`.
  - Map finish reasons per the design D7 table.
  - Parse arguments strictly per D6: raw text sanitized with `sanitizeSystemText` and capped at 2,000 characters.
  - Evidence: the "Typed response mapping" scenarios and the "Malformed arguments are flagged" scenario.
- [ ] 2.4 [Owner: D] Wire 2.1 to 2.3 into `RealModelGateway.executeAttempt`, and add the output-limit field (design D4).
  - Option `outputTokensField: "max_tokens" | "max_completion_tokens"`, default `max_tokens`. Every request carries `maxOutputTokens` when it is set.
  - Keep `maxRetries: 0`, the timeout and never-throw.
  - Evidence: both "Output-token limit" scenarios (enabled and default); an existing timeout test still passes.
- [ ] 2.5 [Owner: D] Pricing status (design D8).
  - `getModelPricing` returns `undefined` and the gateway sets `pricing: "unpriced"`.
  - Add options `inputCostPerMTok` and `outputCostPerMTok`, only valid together, to price a proxy model.
  - With no usage from the provider: zero tokens and `unpriced`.
  - Evidence: both "Priced and unpriced usage" scenarios, with prices configured and not configured.
- [ ] 2.6 [Owner: D] Port `isContextOverflow` and its patterns into `packages/llm/src/errors/provider-error.ts`.
  - Set `classification: "context_overflow"` on matching 400/413 errors.
  - Exclude rate-limit messages.
  - Evidence: both "Context-overflow classification" scenarios.
- [ ] 2.7 [Owner: D] Add the recording client and fixtures under `packages/llm/test/fixtures/recordings/`.
  - Fixtures:
    - tool call then answer;
    - two parallel calls;
    - malformed arguments;
    - `length` during a tool call;
    - `content_filter`;
    - 401;
    - 429 with `Retry-After`;
    - 500;
    - 400 overflow;
    - timeout.
  - Evidence: one gateway test per fixture asserting the captured request body and the mapped response.

## 3. Runner seam (Track C reviews)

- [ ] 3.1 [Owner: C with D] Persist a tool turn's text as an `assistant_reasoning` item before its `tool_request` items. The text is sanitized with the full tier.
  - Evidence: the "Text next to a tool call is replayed" scenario; the existing crash-consistency tests still pass.
- [ ] 3.2 [Owner: C with D; after 0.1] Handle a tool call that carries `argumentsError`.
  - Do not dispatch it. Persist the request item with the raw text and an error result, and record `tool.failed` with `failureKind: "invalid_arguments"`.
  - The call counts toward `maxToolCalls`.
  - Evidence: both "Tool calls with invalid arguments" scenarios.
- [ ] 3.3 [Owner: C with D] Handle `length` finishes.
  - A `length` response is never a tool request.
  - A final `length` response completes the run with `outputTruncated: true` in the result and in `run.completed`.
  - Evidence: the "Truncated final answer is marked" scenario.
- [ ] 3.4 [Owner: C with D] Handle unpriced profiles (design D8).
  - `run.started` records `costBudgetEnforced: false`; the cost pre-call guard is skipped; the result usage reports `pricing: "unpriced"`.
  - Evidence: the "Unpriced run records the disabled cost check" scenario, plus a priced run that still stops for cost.
- [ ] 3.5 [Owner: C with D] Extend `getMultiTurnExecutionSummary` in `run-queries.ts` with per-step attempt data: model, finish reason, tokens, cost or `null`, pricing and latency. Keep identification by step and call ID.
  - Evidence: a summary test with two steps and one tool call.

## 4. Configuration

- [ ] 4.1 [Owner: D] Extend `packages/cli/src/config.ts` with the settings of the "Provider profile and run-limit settings" requirement.
  - `MODEL_OUTPUT_TOKENS_FIELD`.
  - `MODEL_INPUT_COST_PER_MTOK` and `MODEL_OUTPUT_COST_PER_MTOK`, both or neither.
  - `HARNESS_SNAPSHOT_DIR`, defaulting to `<repo>/data/snapshots`.
  - `HARNESS_MAX_STEPS`, `HARNESS_MAX_TOOL_CALLS`, `HARNESS_MAX_TOTAL_TOKENS` and `HARNESS_MAX_COST_USD`.
  - Record the effective values in `run.started`.
  - Evidence: the three runtime-configuration scenarios.

## 5. CLI

- [ ] 5.1 [Owner: D] Add `packages/cli/src/commands/repo.ts` for `repo add <path> [--include-root <dir>]... [--snapshot-id <id>]`.
  - Use `SnapshotManager.ingestRepository` into `HARNESS_SNAPSHOT_DIR`.
  - Print the snapshot ID, the file count and the skipped counts by reason.
  - Evidence: the "Register a repository" scenario on a temp repository, with the source tree unchanged afterwards.
- [ ] 5.2 [Owner: D] Add `packages/cli/src/commands/snapshot.ts` for `snapshot list`.
  - Print ID, file count, tree digest and ingestion policy version.
  - Evidence: the "List snapshots" scenario.
- [ ] 5.3 [Owner: D] Implement `run --snapshot <id>` in `commands/run.ts` per design D9.
  - Wiring: `DiskSourceSnapshot` + `ToolRegistry({ snapshot, snapshotId })` + `MultiTurnRunner` + `RealModelGateway` + `PostgresRunStore`.
  - Limit flags override the environment, which overrides the defaults. An unknown snapshot exits 1 before any model call.
  - Print the cost as "unknown" with a warning when unpriced.
  - `run` without `--snapshot` stays single-turn.
  - Evidence: the three "Multi-turn run against a snapshot" scenarios with a recording client injected through a gateway factory.
- [ ] 5.4 [Owner: D] Remove the silent scripted-gateway fallback from `executeRunCommand`.
  - `--mock` uses `InMemoryRunStore` and a scripted gateway that performs one `read_file` call and then answers.
  - Evidence: the "Missing key does not fall back to a mock" scenario; the existing `--mock` tests are updated.
- [ ] 5.5 [Owner: D] Extend `commands/view.ts` per design D10.
  - Multi-turn layout from 3.5, `--json` output, cost "unknown" when unpriced.
  - Single-turn runs keep their current layout.
  - Evidence: the "View a multi-turn run from a new process" scenario, using a fresh store instance over the same data, plus the existing view tests.
- [ ] 5.6 [Owner: D] Update the help text and the `cli:*` scripts in the root `package.json` for `repo`, `snapshot`, `run` and `view`.
  - Evidence: a help-output test lists every command.

## 6. Documentation and verification

- [ ] 6.1 [Owner: D] Update `.env.example` and `docs/environment-setup.md` with the full flow.
  - Flow: configuration, `db:migrate`, `repo add`, `snapshot list`, `run --snapshot`, `view`.
  - Explain the output field, explicit prices, the cost-unknown rule and `--mock`.
  - Evidence: the documented `--mock` commands run as written.
- [ ] 6.2 [Owner: D with C] Run the offline integration cases and record the results here.
  - Cases: tool call then answer, wrong configuration, auth/rate-limit/server errors, timeout.
  - Compare each gateway response with the stored attempt row and history: call IDs, finish reason, usage and pricing.
  - Evidence: the "Integration cases run without network" scenario; `bun run typecheck` reports 6/6; the `bun run test` totals are recorded.
- [ ] 6.3 [Gate G2; Owner: D with the team; human approval required] Do one live smoke run.
  - Steps: `repo add` on a small Solidity fixture, `run --snapshot` with `--max-cost-usd` set, then `view` from a new process.
  - Prerequisites: the user's provider key, and a chosen model and budget. Run it only after explicit approval.
  - Evidence:
    - the run ID;
    - the tool calls made;
    - the usage and cost;
    - which DB parts ran and which were skipped.
- [ ] 6.4 [Owner: D] Tick the Track D items and the Sprint 2 carry-over items that this change completes in `docs/sprints/sprint-03.md`. The carry-over items are output limit, usage/cost, and run evidence after G2. Add a short note per item linking this change.
  - Evidence: the diff of the sprint file.
