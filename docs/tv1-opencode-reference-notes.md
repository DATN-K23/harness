# TV1 OpenCode reference notes

Status: final for the OpenCode change `bootstrap-agent-loop-core` (written for task 1.5, completed after the last unit). The adapted-file list in section 3 matches the root `NOTICE`.

Reference checkout: `D:\DATN\opencode`, commit `3f393d78bf` (full hash `3f393d78bfc3f0826b2c7080e57964c235704695`), MIT License, Copyright (c) 2025 opencode. The checkout is read-only. Nothing is imported from it and no `@opencode-ai/*` package is a dependency (enforced by `packages/core/test/architecture.test.ts`).

The TV1 design documents (`docs/tv1-agent-loop-design.md`, `docs/tv1-agent-loop-demo-spec.md`) are not edited. Where they cite paths that do not exist, this note is the correction.

## 1. Verified OpenCode paths

All paths are relative to the OpenCode repository root. Existence was checked at commit `3f393d78bf`.

| Path | Verified content | Used for |
|---|---|---|
| `packages/core/src/session/runner/index.ts`, `llm.ts`, `max-steps.ts`, `model.ts`, `publish-llm-event.ts`, `to-llm-message.ts` | The complete contents of `runner/`. `llm.ts` holds `runTurnAttempt`, the per-turn logic. | Structure of `JudgeStep` (designed from `runTurnAttempt`, not copied) |
| `packages/core/src/session/runner/max-steps.ts` | Exports `MAX_STEPS_PROMPT`. | Adapted wording for the step-limit forcing message (`packages/core/src/prompts/max-steps.v1.txt`) |
| `packages/opencode/src/session/retry.ts` | V1, Effect-based. Initial delay 2000 ms, backoff factor 2, jitter factor 0.25, max delay without headers 30 s, max 5 retries, `Retry-After` honoured, `RETRYABLE_MESSAGE_PATTERNS` list. | Source of the retryable-message patterns (`packages/core/src/runner/retry-policy.ts`) |
| `packages/core/src/util/retry.ts` | Generic `retry(fn, options)`. | Reference only |
| `packages/core/src/tool/registry.ts` | V2 tool registry; `ToolRegistry.settleWith` converts tool outcomes into results. | Model for tool-failure normalization (written fresh in `packages/core/src/step/parallel-tool-dispatcher.ts`) |
| `packages/llm/src/provider-error.ts` | Context-overflow message patterns. | Pattern list for non-retryable provider errors (`packages/core/src/runner/retry-policy.ts`) |
| `packages/schema/src/identifier.ts` | Sortable ID generator. | Adapted with injected clock and random (`packages/core/src/util/id.ts`) |
| `bunfig.toml`, `turbo.json`, `tsconfig.json`, `.editorconfig`, `package.json` | Workspace root configuration; `package.json` carries the `catalog` pattern. | Unit 1 workspace files (section 3) |
| `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/core/tsconfig.json` | Package manifest and tsconfig shapes. | Unit 1 package files (section 3) |

## 2. Paths cited in the TV1 design that do not exist

| TV1 document cites | What exists | Consequence |
|---|---|---|
| `session/runner/step.ts` | No such file. `packages/core/src/session/runner/` holds `index.ts`, `llm.ts`, `max-steps.ts`, `model.ts`, `publish-llm-event.ts`, `to-llm-message.ts`. Per-turn logic is `runTurnAttempt` in `llm.ts`. | `JudgeStep` is designed from the structure of `runTurnAttempt`. |
| `session/runner/retry.ts` | No such file. Retry lives in `packages/opencode/src/session/retry.ts` (V1, Effect) and `packages/core/src/util/retry.ts` (generic). | `RetryPolicy` adapts the V1 classification patterns into plain TypeScript. |
| `tool/runtime.ts` (tool error normalization) | Not found. Normalization is `ToolRegistry.settleWith` in `packages/core/src/tool/registry.ts` (V2) and `failToolCall` in V1 (`packages/opencode/src/session/processor.ts`). | Tool-failure-to-result conversion is written fresh, using that behavior as the model. |
| `.opencode_reference/` | Gitignored and absent from the checkout. | The reference path is `D:\DATN\opencode`. |
| Retry formula `min(10000, 2000·2^(n−1)) + random(0,1000)` | OpenCode V1: `2000·2^(n−1)` with 25% multiplicative jitter, capped at 30 s without response headers, up to 5 retries, honours `Retry-After`. | The TV1 formula governs. The difference is recorded here so nobody assumes OpenCode parity. |

## 3. OpenCode files adapted

Each entry is also listed in the root [`NOTICE`](../NOTICE), which is the authoritative list read by the architecture test. Files that can carry comments begin with an attribution header; JSON files cannot, and their attribution is the `NOTICE` entry.

| Harness file | OpenCode source | Adaptation | Attribution |
|---|---|---|---|
| [`bunfig.toml`](../bunfig.toml) | `bunfig.toml` | Kept `exact = true`, the 3-day `minimumReleaseAge` and the root test guard; dropped the `minimumReleaseAgeExcludes` list (OpenCode-specific packages). | header |
| [`.editorconfig`](../.editorconfig) | `.editorconfig` | `max_line_length` changed from 80 to 120 to match the shared `printWidth`. | header |
| [`package.json`](../package.json) | `package.json` | Kept `packageManager`, `workspaces.packages` and the `catalog` pattern; trimmed to four catalog entries; scripts `typecheck`, `test` (both delegating to Turborepo) and `demo`; `typescript` replaces `@typescript/native-preview` (tsgo). | notice-only |
| [`tsconfig.json`](../tsconfig.json) | `tsconfig.json` | Unchanged shape (`@tsconfig/bun`). | notice-only |
| [`turbo.json`](../turbo.json) | `turbo.json` | Reduced to the `typecheck` and `test` tasks; dropped OpenCode package-specific tasks and environment variables. | notice-only |
| [`packages/protocol/package.json`](../packages/protocol/package.json) | `packages/protocol/package.json` | Renamed `@harness/protocol`; single `.` export; `tsc --noEmit`; `zod` from the catalog; no Effect or schema dependency. | notice-only |
| [`packages/protocol/tsconfig.json`](../packages/protocol/tsconfig.json) | `packages/protocol/tsconfig.json` | Unchanged (DOM libs keep the package browser-safe). | notice-only |
| [`packages/core/package.json`](../packages/core/package.json) | `packages/protocol/package.json` | Same manifest shape; adds the `./testing` export and `workspace:*` dependency on `@harness/protocol`. | notice-only |
| [`packages/core/tsconfig.json`](../packages/core/tsconfig.json) | `packages/core/tsconfig.json` | Unchanged. | notice-only |
| [`packages/core/src/util/id.ts`](../packages/core/src/util/id.ts) | `packages/schema/src/identifier.ts` | Clock and random injected, per-generator state, strictly ascending IDs even when the clock stalls or goes backwards, caller-supplied prefix. | header |
| [`packages/core/src/prompts/max-steps.v1.txt`](../packages/core/src/prompts/max-steps.v1.txt) | `packages/core/src/session/runner/max-steps.ts` | `MAX_STEPS_PROMPT` reworded for the Judge: no edit or user-input language, asks for the final JSON verdict from the evidence already gathered. | header |
| [`packages/core/src/runner/retry-policy.ts`](../packages/core/src/runner/retry-policy.ts) | `packages/opencode/src/session/retry.ts` | Retryable-message patterns and backoff structure ported to plain TypeScript; the delay follows the TV1 formula with injected random and sleep; `Retry-After` is recorded, never used. | header |
| [`packages/core/src/runner/retry-policy.ts`](../packages/core/src/runner/retry-policy.ts) | `packages/llm/src/provider-error.ts` | Context-overflow message patterns copied; they return a `context_overflow` classification (never retried) instead of a failure. | header |

The two `retry-policy.ts` rows are two `NOTICE` entries for one file with one header naming both sources.

## 4. Behaviors deliberately not followed (design decision D3)

- OpenCode V2 runs tool calls eagerly with unbounded concurrency and writes results in completion order (`FiberSet` and `concurrency: "unbounded"` in `runner/llm.ts`). The Judge loop dispatches deterministically and writes results in call-index order (design D7).
- OpenCode is written in Effect (`Effect.gen`, `Layer`, `Stream`, `FiberSet`). The harness uses plain TypeScript with `async/await`, `AbortSignal`, zod and injected ports (design D2). OpenCode logic is ported, not imported.
- OpenCode V1 retry delay (2000·2^(n−1), 25% multiplicative jitter, 30 s cap, 5 retries) is replaced by the TV1 formula `min(10000, 2000·2^(n−1)) + random(0,1000)`, with randomness injected.
- OpenCode runs `tsgo` for typechecking and `oxlint`/husky hooks; the harness uses `tsc --noEmit` from the catalog `typescript` and adds no lint or hook tooling in this change.
- OpenCode's root `test` script exits with an error; the harness root `test` delegates to Turborepo, while `bunfig.toml` still prevents running `bun test` at the root.
- Behavioral patterns taken from `runner/llm.ts` are reimplemented, not copied: record the tool call before running it, one provider call per turn, tool failure becomes a model-visible result, step-limit forcing.
