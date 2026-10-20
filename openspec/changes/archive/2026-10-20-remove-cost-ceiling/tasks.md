# Tasks

## 1. Remove cost ceiling from contracts and runtime

- [x] 1.1 Remove cost-ceiling fields from current protocol run limits, budgets, context inputs, run snapshots, and event schemas; preserve cost usage/pricing fields and legacy read compatibility, verified by protocol tests and `bun run --cwd packages/protocol typecheck` (Owner: core/protocol team; Gate: implementation; evidence: protocol suite and typecheck pass).
- [x] 1.2 Remove CLI `--max-cost-usd`, `HARNESS_MAX_COST_USD`, and the `$5` fallback from run-limit resolution; verify old flag is rejected/not applied, the legacy environment variable does not set a limit, and supported CLI/config tests pass (Owner: CLI team; Gate: implementation; evidence: CLI tests).
- [x] 1.3 Remove cost-based stop evaluation and context preflight branches, plus unpriced-specific cost-ceiling telemetry/warnings; preserve recorded cost/pricing status and unknown-cost display, verified by focused core/CLI tests for priced and unpriced usage (Owner: core/runner team; Gate: implementation; evidence: runner and CLI tests).

## 2. Update user-facing contracts and validate integration

- [x] 2.1 Update runtime documentation, `.env.example`, CLI help/examples, and relevant OpenSpec main specs to remove cost-ceiling controls while clarifying that cost reporting remains and spend is not capped; verify a repository search finds no active configuration references (Owner: docs/specs team; Gate: implementation; evidence: docs review and scoped search).
- [x] 2.2 Run protocol, core, CLI, schema persistence tests and workspace typecheck; verify historical run records with legacy cost fields remain readable and new run snapshots/events omit the ceiling (Owner: integration owner; Gate: completion; evidence: protocol 147, core 802, CLI 52, schema 31 and LLM 39 tests pass; protocol typecheck passes; workspace typecheck remains blocked only by pre-existing `grep.ts` Worker typing errors; legacy cost-limit snapshots parse and DB schema is unchanged).
