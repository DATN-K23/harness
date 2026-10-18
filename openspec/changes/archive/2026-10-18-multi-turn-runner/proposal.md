# Proposal

## Why

Sprint 3 needs its first real end-to-end chain: register a repository → create an
immutable snapshot → a real model asks to read/search source → the runtime runs the
tool → the model receives the result and answers — all stored in PostgreSQL and
reviewable after a restart. Today the repository has a one-call baseline
(`SingleTurnRunner`) and a multi-turn loop that exists only inside
`JudgeRunner`/`JudgeStep`, where it is coupled to adjudication (verdict synthesis,
compaction, security filtering). There is no bounded, general model→tool→model runner
for the source-tools chain, and the model gateway contract cannot carry tool
definitions to a provider, so a real provider cannot be told what functions exist.

This change is Track C of `docs/sprints/sprint-03.md`: it owns the runner, run state,
and execution history for that chain. It serves RQ1 by keeping the direct single-turn
baseline (X) intact while adding a measured, bounded harness chain (Y).

## What Changes

- Add a bounded multi-turn runner (model → tool → model) for the read-only
  source-tools chain, delivered **alongside** the existing single-turn baseline and
  **without** modifying the Judge loop.
- Assemble a minimal request per turn: instruction, prompt, bounded initial source
  info, model/tool history, and the allowed tool list obtained from the read-only
  tool registry.
- Enforce limits before each next action — model turns, tool calls, wall clock, and
  output tokens — and stop with an explicit, recorded reason when a limit is reached.
- Bind each tool result to its originating tool-call id, persist requests/results in
  order, and normalize tool failures into non-throwing error results.
- Reuse the existing attempt-persistence path and extend it to the multi-turn chain so
  every provider attempt is recorded exactly once and is readable after restart.
- Extend the protocol request contract so `ModelAttemptRequest` can carry the allowed
  tool definitions and a per-run tool-call cap (additive; the single-turn baseline is
  unaffected).
- Extend persistence so a run records its linked snapshot identity and each provider
  attempt records its position in the turn sequence; tool call/result data continues to
  live in the ordered trajectory event stream.
- Reuse attributed OpenCode logic where it is small and testable: loop
  continuation/stop conditions, provider message edge cases for tool results,
  output-truncation markers, and output budget math.

## Capabilities

### New Capabilities

- `multi-turn-runner`: bounded multi-turn model→tool→model execution over an immutable
  source snapshot, with minimal per-turn request assembly, read-only tool dispatch,
  enforced limits, and history that survives a process restart.

### Modified Capabilities

- `agent-loop-protocol-contracts`: `ModelAttemptRequest` additionally carries the
  allowed tool definitions and a per-run tool-call cap, and tool-call identity is
  preserved in history. The change is additive; the single-turn baseline behavior is
  unchanged.
- `trajectory-persistence`: `runs` records the linked snapshot identity, and
  `model_attempts` records per-turn attempt identity so every provider attempt in the
  chain is stored once and readable in order.

## Impact

- **Code**: `@harness/core` (new runner, per-turn request assembly, bounded loop,
  history readback), `@harness/protocol` (request contract and limit vocabulary
  additions), `@harness/schema` (migration for the snapshot link and per-turn attempt
  identity), `@harness/llm` and `@harness/cli` as integration points owned by Track D.
- **Contracts/data**: additive protocol fields and an additive Drizzle migration; no
  change to existing single-turn or Judge behavior.
- **Controls preserved**: agent-visible content stays limited to source/tool content and
  tool descriptions; no ground-truth labels, adjudication reports, or scoring metadata;
  host paths stay out of provider requests and trajectories; every optional
  result-affecting behavior ships with a config flag, telemetry, run-snapshot value, and
  enabled/disabled tests.
- **Non-goals (track/scope boundaries, not project descope)**: no Judge or Audit
  workflow change; no context-engine extraction, compaction, or long-term memory
  (next stage); no verification/PoC execution; no provider adapter matrix or
  cross-provider work; and no interactive/pair mode or mid-run human approval gates
  (deferred to a later change). CLI command ownership and provider request/response
  conversion remain with Track D; read-only tool execution remains with Track B.
