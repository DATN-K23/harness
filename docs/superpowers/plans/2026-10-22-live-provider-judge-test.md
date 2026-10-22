# Live Provider Judge Test Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute a genuine live provider-backed Judge test through the production API, worker, PostgreSQL, and LLM gateway, completing with a valid terminal `UNVERIFIED` verdict.

**Architecture:** A standalone test runner sets up a temporary loopback PostgreSQL database (`postgres:16-alpine`), digests a minimal Solidity snapshot (`Vault.sol`), starts the local production HTTP server with Keychain auth, submits a structured narrative finding, polls the run status until completion, and verifies terminal verdict and provider attempt telemetry.

**Tech Stack:** Bun, PostgreSQL (ephemeral Docker container), macOS Keychain, OpenAI SDK (`RealModelGateway` routed to loopback `9router`), Drizzle ORM.

**Spec:** `docs/superpowers/specs/2026-10-22-judge-mvp-design.md` & `docs/tv4-judge-pipeline-proposal.md`

## Global Constraints

- **Ground-Truth Isolation (Rule R2):** No ground-truth labels, scoring keys, or adjudication reports in prompts, trajectories, or events.
- **Isolated Infrastructure:** Never use the persistent/shared `harness-postgres` database. Always spawn a fresh container with randomized loopback port and trap cleanup.
- **Credential Safety:** Never print or leak API keys, bearer tokens, or full database URLs in logs or stdout.
- **Fail-Closed Semantics:** BCE remains incomplete, PoC execution remains disabled (`enablePocExecution: false`), state probes remain disabled (`maxProbeRuns: 0`). The run MUST terminate with `validity: "unverified"` and `verificationStatus: "UNVERIFIED"`.

## Review Focus

- Provider Rate Limiting (429): Verify preflight probe checks provider readiness before provisioning DB container.
- Step & Token Budgeting: Ensure limits (`maxSteps: 8`, `totalTokenBudget: 64_000`) accommodate both forward and backward reasoning turns without premature cutoff.
- Markdown JSON Resilience: Ensure bidirectional verifier and verdict synthesizer accept LLM responses wrapped in ```json code blocks or surrounded by conversational prose.
- Schema Repair Exhaustion: Verify repair feedback prompts guide model to output valid JSON within the repair allowance.
- Ephemeral Cleanup: Confirm Docker container and temporary snapshot directories are cleanly unmounted and destroyed on both success and failure.

---

### Task 1: Pre-flight Provider Health Probe & Diagnostics

**Files:**
- Modify: `packages/server/scripts/manual-provider-judge.ts`
- Test: Manual execution via CLI

**Interfaces:**
- Input: `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_NAME` from `/Users/nguyenbaoan/codeLab/harness/.env`.
- Output: Exit with code 0 if model responds with valid 200, or clean exit with backoff wait notice if 429/503.

- [ ] **Step 1: Add a lightweight upstream probe in `manual-provider-judge.ts`** that sends a 1-token dummy completion before starting PostgreSQL or the server.
- [ ] **Step 2: Handle rate-limit (429) & unavailable (503) status codes gracefully** by printing the exact reset duration without throwing unhandled exceptions.
- [ ] **Step 3: Test probe** against local `9router` endpoint and confirm clean diagnostic output.

### Task 2: Robust Multi-Turn Parsing & Budget Tuning

**Files:**
- Modify: `packages/server/scripts/manual-provider-judge.ts`
- Modify: `packages/core/src/judge/bidirectional-verifier.ts`
- Modify: `packages/core/src/judge/verdict-synthesizer.ts`

**Interfaces:**
- Bidirectional output parser extracts JSON matching `ForwardResult` and `BackwardResult`.
- Config allows up to 8 reasoning steps and 64k tokens to complete forward, backward, and synthesis phases.

- [ ] **Step 1: Increase manual run limits** in `manual-provider-judge.ts` to `maxSteps: 8` and `totalTokenBudget: 64_000` to prevent premature `max_steps` termination.
- [ ] **Step 2: Verify `parseObject` and `parseResult`** handle raw JSON, code-fenced JSON, and prose-embedded JSON.
- [ ] **Step 3: Run existing unit test suites** `bun test test/judge/bidirectional-verifier.test.ts test/judge/verdict-synthesizer.test.ts` to confirm 100% pass.

### Task 3: Live End-to-End Execution & Artifact Logging

**Files:**
- Output: `.superpowers/sdd/2026-10-22-judge-mvp-real-pipeline/live-provider-report.md`
- Script: `packages/server/scripts/manual-provider-judge.ts`

**Interfaces:**
- POST `/v1/judge/runs` -> HTTP 202 `{ runId }`.
- GET `/v1/judge/runs/:runId` -> polling until `completed`.
- Trajectory events query -> assert `provider.attempted >= 2` and `verdict.verificationStatus === "UNVERIFIED"`.

- [ ] **Step 1: Wait for provider rate limit reset** (confirming 200 OK from Task 1 probe).
- [ ] **Step 2: Execute automated live runner:**
  ```bash
  bun run test:live-provider
  ```
  (Spawns disposable Postgres, ingests `Vault.sol`, boots server, submits run, polls to terminal state, tears down DB).
- [ ] **Step 3: Verify and record run results:**
  - `providerAttemptCount >= 2` (both forward and backward turns attempted).
  - Terminal state is `completed`.
  - Verdict is `UNVERIFIED` / `UNRESOLVED`.
- [ ] **Step 4: Update `live-provider-report.md`** with sanitized run metadata (token counts, step count, attempt latency, zero credential leakage).
