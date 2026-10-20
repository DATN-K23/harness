# Sprint 6 Task 4 — Multi-turn Context Engine integration

Status: implemented; three Important review findings fixed in follow-up commit.

## Changes

- `MultiTurnRunnerDeps` requires an injected `ContextEnginePort`. Real snapshot CLI runs construct `ProductionContextEngine` with the approved `o200k_base` tokenizer; `--mock` uses the explicit pass-through test engine.
- Runner assembles the sanitized, tool-enabled `ModelAttemptRequest`, passes that canonical envelope to `prepare`, persists transformation/allocation events before gateway execution, and uses the prepared request for the gateway. Production estimates and request digests include request items, tool schemas, and output settings.
- Effective output reserve is `min(policy.outputReserveTokens, request.maxOutputTokens)` when a request cap is supplied; otherwise the shared reserve is used. `W_exp` remains 16,384. The user decision and cost if incorrect are recorded in `progress.md`.
- Run-config policy and top-level flags now agree (supersede/drop remain false). This fixes the earlier generic failure: snapshot validation threw because those flags disagreed.
- `MODEL_MAX_CONTEXT_TOKENS` is an optional positive config input. Real production runs fail closed before gateway if there is no evidenced context cap; no generic 128k cap is inferred. Test engines remain explicitly non-authoritative.
- Tool result flow is sanitizer → `shapeToolResult` → append-only result persistence/history. Tool request/result pairing and relative path/range metadata are retained.
- `record` accepts nullable actual usage; failed provider responses pass `null`, not a fabricated zero. Runner owns cumulative usage/budgets. Old event parsing is preserved additively.
- Follow-up review fix: a runtime gateway response with absent/null `usage` is normalized to unavailable in the multi-turn runner, never dereferenced or added as zero. `provider.attempted` accepts nullable usage/cost additively; legacy numeric payloads still parse. Relational model-attempt rows are omitted when usage is absent because their token columns are NOT NULL.
- Follow-up review fix: multi-turn requires a ready result's `preparedRequest`; if a runtime/custom engine omits it, the run fails closed before gateway. Pass-through/scripted engines propagate the assembled request when present; the general ContextEngine contract remains optional to preserve Judge-only callers.
- Follow-up review fix: resumed runs parse `run.started.snapshot.contextPolicy` through `ContextPolicySchema` and reuse it. A malformed present policy fails closed. Compatibility strategy: if the legacy snapshot has no `contextPolicy` property at all, use the current Task 4 default because older persisted run configs did not record that policy; if a policy property exists but is invalid, fail the resumed run before any provider call. A valid persisted policy is reused without mutation.

## Root cause and tests

- Focused runner case first exposed the flag mismatch in run-config validation; the runner's recovery handler hid the exception behind a generic persistence failure. Aligning both flag sets fixed that exception.
- The remaining `context_budget` result was caused by comparing the explicit output cap (`16`) against the common reserve (`4,096`). The corrected effective reserve rule allows the explicit smaller cap while retaining the 16,384 shared window.
- Added regressions for full request digest/estimate sensitivity to tools and output options, exact prepared request to gateway, reserve behavior, fail-closed missing model limit, allocation persistence failure preventing gateway, null usage on error attempts, and sanitized shaping before persisted history.
- Follow-up regressions cover absent gateway usage, ready-without-prepared-request, exact persisted policy restoration on resume, and malformed persisted policy failing before gateway.
- Missing-usage representation is additive: `provider.attempted.usage` and `costUsd` accept null; historical numeric usage remains accepted. Multi-turn does not write a relational attempt row when usage is absent because its existing schema requires numeric token columns.
- Re-review fix: resume compatibility fallback now applies only when `contextPolicy` is genuinely absent. An explicitly present `undefined`, `null`, or malformed value fails closed before the provider call.
- `read_file` already supports `startLine`/`endLine`; no offset API change was needed.
- Final branch-review rulings: conservative estimates plus output reserve are charged to the logical context budget when usage is unavailable, without changing null provider usage or public actual-usage totals. The logical estimate is restored from persisted allocations lacking an actual-usage attempt. Explicit output caps above the shared reserve or model output cap fail before gateway; smaller caps use `min(shared reserve, request cap)`. Production prepare validates finite/coherent positive limits and returns valid stop telemetry on malformed profiles. Resume hydration rebuilds each canonical request from persisted allocation items and current run configuration, compares its request digest, and fails closed if request verification is unavailable/mismatched. Profile caps, profile ID, and request options are persisted in `run.started` and conflicts are rejected before claim. Read-file continuations use safe relative path/range/next-line markers when they fit; full continuation metadata remains actionable even when content marker must be shortened.

## Verification

- Focused request regression: `bun test packages/core/test/runner/multi-turn-runner.test.ts --test-name-pattern='prepares and sends the same full tool-enabled provider request' --reporter=dots` — 1 pass.
- Targeted request/reserve/profile tests — 3 pass.
- Multi-turn runner/integration/hardening after review fixes: 64 pass, 0 fail.
- Protocol events/context tests: 88 pass, 0 fail.
- Context engine tests: 10 pass, 0 fail; one combined invocation once hit the existing 5s test timeout during tokenizer warm-up, and the isolated test passed with a 20s timeout.
- Non-DB CLI tests (run, view, args, config, redaction, snapshot): 46 pass, 0 fail. Package-wide CLI test command includes the PostgreSQL persistence E2E; not run as requested. No database/schema suite run.
- Protocol typecheck passes. Core/CLI typecheck still reports only the pre-existing `packages/core/src/tool/handlers/grep.ts` Worker `.once` errors (TS2339 x3, TS7006).
- `git diff --check` passes.
- Final review follow-up verification: focused context, multi-turn, hydration, CLI snapshot and config tests — 83 pass, 0 fail; context/runner/hydrator/read-file/fake-engine/protocol set — 173 pass, 0 fail. Core typecheck still has only the existing `grep.ts` Worker typing errors.
- Null-usage resume review: regression seeds an allocation (`estimatedInputTokens=300`, `outputReserveTokens=100`) followed by `provider.attempted.usage=null`, expires the lease, and resumes with the same 500-token budget. Resume prepare receives `totalTokensUsed=400`; ProductionContextEngine stops the next allocation as `context_budget`, and gateway call count remains zero. The resume filter intentionally excludes only steps with non-null actual usage, so null-usage attempts retain their estimate. A normal provider error is immediately terminal (`finishRun` to failed) and cannot be retried by claiming the same run; takeover after a null-usage attempt is reachable when the worker dies after persisting the attempt but before terminal transition (for example, between a non-error response and subsequent events). Targeted resume tests: 3 pass; hydrator suite: 5 pass.

## Limitations

- Production CLI users must set `MODEL_MAX_CONTEXT_TOKENS` from an evidenced provider/model hard input cap. Missing values stop before a provider call.
- Token accounting covers the canonical sanitized request object; provider-hidden framing remains approximated by the approved 1.2 safety factor.
- No L3 history transforms, LLM compaction, or memory were enabled.
