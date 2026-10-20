# Sprint 6 Task 3 — Production Context Engine operations

Status: implementation completed with verification limitations noted below.

## Decisions and implementation

- Reused `ContextEnginePort`; no separate request planner was added because the current port exposes only context items. `ProductionContextEngine` is additive, leaving `FakeContextEngine` and `PassThroughContextEngine` intact for existing doubles.
- Added the production engine around the approved `js-tiktoken@1.0.21` `o200k_base` adapter. It estimates the JSON-serialized context-item envelope, emits deterministic content/request SHA-256 digests, applies safety/output reserves and total-token/window guards, and fails closed with `context_budget`.
- `record` adds provider-reported total usage and returns a stateless prompt count delta; it does not synthesize missing usage.
- `shapeToolResult` works on caller-provided already-sanitized content, keeps a contiguous complete-line prefix, respects token and line limits, and provides truncation/continuation metadata.
- Exported production engine and tokenizer factory from `packages/core/src/context/index.ts`.
- Corrected misleading pre-existing OpenCode attribution headers on touched files: the requested object `3f393d78bf` is unavailable; checkout inspected by Task 1 was `5542415b6424aa9bad8827dc72e8cd0630b2c0ab`. This implementation is Harness-owned and does not copy the OpenCode algorithm.

## TDD and verification

- `context-engine.test.ts` was run before implementation and failed because `ProductionContextEngine` was not exported.
- `bun test --test-name-pattern='ProductionContextEngine' packages/core/test/context/context-engine.test.ts`: pass, 4 tests / 14 assertions.
- `bun test --test-name-pattern='matches o200k|counts Unicode|does not interpret|returns zero' packages/core/test/context/o200k-tokenizer.test.ts`: pass, 4 tests / 9 assertions.
- `bun test packages/core/test/context/fake-context-engines.test.ts packages/core/test/context/context-engine.test.ts packages/core/test/context/o200k-tokenizer.test.ts`: pass, 8 tests / 23 assertions (Bun reports 2 files because fake-context test path is absent in this checkout).
- `bun run --cwd packages/core typecheck`: still blocked by pre-existing `src/tool/handlers/grep.ts` Worker `.once` errors (TS2339 x3 and implicit `code` TS7006); no errors reported in changed engine files.
- `bun run --cwd packages/core test`: fails in existing suite with two `expect(...).toContain` and one `expect(...).toBe` assertion errors. Failure output under this runtime omits test names; this has not been attributed to these changes.
- `git diff --check`: pass.
- No schema/database suite was run.

## Scope limitations / concerns

- Protocol `ContextEnginePort.prepare` does not carry the exact assembled provider request or tool definitions. Consequently the current production accounting serializes/digests `items` only; Task 4 must bind the final prepared provider request and include tool schema/output fields for complete wire-request accounting. The emitted `requestDigest` is explicitly an item-envelope digest, not a claim of provider-wire identity.
- Pinning and tool call/result atomicity are preserved by returning original items unchanged; this engine does not perform history compaction, masking, or grouping transformations.
- Provider usage absence is represented outside `record` by not calling it; the port currently requires actual usage, so nullable usage recording needs an additive contract change if runner telemetry is to encode missing usage directly.
- The request digest and token estimate cover serialized items, not provider-specific chat framing overhead. The fixed safety factor remains an approximation.
