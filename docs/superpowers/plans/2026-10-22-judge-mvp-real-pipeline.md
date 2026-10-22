# Judge MVP Real Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a locally runnable Solidity/Foundry Judge MVP for narrative and submitter-PoC findings, with evidence-checked bidirectional adjudication and fail-closed execution in a real isolated sandbox.

**Architecture:** Keep `JudgeRunner` orchestration in `@harness/core` and implement Solidity ingestion/BCE, PoC policy, and Foundry Docker execution behind existing protocol ports. Compose real adapters with the existing PostgreSQL, snapshot, provider, Keychain, API and worker lifecycle; static PASS is allowed only for snapshot-validated evidence, runtime failures remain UNVERIFIED, and witness synthesis is disabled.

**Tech Stack:** Bun 1.3.14+, TypeScript monorepo/Turborepo, existing Zod protocol, OpenAI-compatible `RealModelGateway`, PostgreSQL/Drizzle, Solidity tooling selected in Task 1, Foundry in pinned Docker image, Swift Security.framework Keychain helper on macOS.

**Spec:** `docs/superpowers/specs/2026-10-22-judge-mvp-design.md`; pipeline source `docs/tv4-judge-pipeline-proposal.md`.

## Global Constraints

- Orchestration stays in `@harness/core`; external infrastructure is behind `@harness/protocol` ports.
- Rule R2: ground truth, adjudication reports and scoring metadata never enter agent context, tools, provider requests, trajectory events or logs; submission forbidden-key scan remains recursive.
- Analyze immutable snapshots only; reject absolute paths, traversal and symlink escapes before I/O.
- Docker execution must use network `none`, ephemeral filesystems, bounded resources, no host secrets, and only authorized snapshot/test inputs; inability to prove isolation disables execution.
- Narrative-only inputs do not trigger automatic witness generation in this MVP.
- `JudgeVerdict` remains the wire contract. `PASS` means validated evidence supports the claim, static or runtime; insufficient evidence or infrastructure/test failure remains `UNVERIFIED`.
- Output-affecting optional behavior is explicitly configured and recorded in immutable run config/telemetry (Rule R1).
- Reuse compatible OpenCode reference components before writing equivalents; include required attribution and `NOTICE` for adapted code, and do not port incompatible frameworks/runtimes.
- Use Bun/Turborepo commands; do not add dependencies until Task 1 documents need, compatibility, license and offline behavior.

## Review Focus

- Ground-truth/scoring metadata embedded as prohibited nested keys is rejected before admission; free-form user text remains untrusted and is never treated as system-provided truth. Test recursive rejection at the protocol/API boundary.
- Unsupported Solidity syntax, missing dependencies, or incomplete call graph never implies “not exploitable”; test every unsupported/incomplete BCE outcome as incomplete/unverified.
- A forged/mismatched citation or guard cannot produce static PASS; test line-accurate snapshot validation and unavailable/denied evidence.
- Hostile PoC constructs and Docker/setup failures never execute unsafely or become invalid verdicts; test policy rejection, timeout, nonzero test result, and infrastructure failure separately.
- Narrative-only runs never synthesize a witness; test that no sanitizer/sandbox calls occur when the configured strategy yields no submitter PoC.

---

## File map

- `packages/protocol/src/ports.ts`, `events.ts`, `verdict.ts`: minimal typed contract changes only where current ports cannot express required bounded execution/evidence outcomes.
- `packages/core/src/runner/*`, `judge/*`, `source/*`: orchestration, claim/evidence validation and correct inconclusive behavior; no Node/Docker/tool-specific dependencies in core.
- `packages/<new solidity adapter or server>/src/`: real bounded Solidity report ingestion/BCE and policy adapter, plus Docker/Foundry sandbox adapter; package boundary chosen after Task 1 reference/tool review.
- `packages/server/src/`: production composition/startup with real adapters and fail-closed dependency checks.
- `packages/**/test/`: unit/contract tests per port, deterministic runner tests, guarded Docker/Foundry integration tests, sanitized Solidity fixtures.
- `packages/server/README.md`, root `.env.example` (non-secret settings only): actual local setup, supported Solidity profile and known coverage limits.

### Task 1: Audit reuse and choose supported Solidity/BCE toolchain

**Files:**
- Create: `docs/superpowers/decisions/2026-10-22-judge-mvp-toolchain.md`
- Read: `.opencode_reference` relevant provider/context/process/sandbox modules, `JudgeRunner`, sandbox contracts, package manifests, `tv4` proposal.
- Test: none (research/decision task; do not modify production code)

**Interfaces:**
- Consumes: design spec and current `IngestionPort`, `SanitizerPort`, `SandboxPort`, `SourceSnapshotPort`.
- Produces: chosen toolchain/versions and license rationale; supported Solidity/Foundry subset; explicit install/runtime prerequisites; OpenCode reuse map with adapted paths or “not compatible”; no soundness/completeness claims.

- [ ] Inspect `.opencode_reference` for compatible pieces and write down exact reusable modules, attribution needs, incompatibilities and reasons.
- [ ] Compare available Solidity AST/call-graph candidates (including existing repo tools) for deterministic offline execution, source-line mapping, dependency handling, supported Solidity versions and license; choose one bounded MVP profile.
- [ ] Choose a pinned Foundry Docker image by digest and document required Docker controls, bind-mount semantics, non-root UID, dropped capabilities, read-only root, tmpfs, resource bounds and macOS daemon trust assumptions; if a required control cannot be demonstrated, declare runtime execution blocked rather than weakening it.
- [ ] Record decisions and explicit unsupported constructs in `docs/superpowers/decisions/2026-10-22-judge-mvp-toolchain.md`; do not add a dependency in this task.

### Task 2: Make evidence and sandbox outcomes representable

**Files:**
- Modify: `packages/protocol/src/ports.ts`, `events.ts`, `verdict.ts` only if existing contracts cannot express outcomes safely.
- Modify: `packages/core/src/runner/judge-step.ts`, `run-stages.ts`, verdict synthesis as required.
- Test: `packages/protocol/test/*`, `packages/core/test/runner/*`, `packages/core/test/judge/*`.

**Interfaces:**
- Consumes: current `SandboxPort`, `SandboxResult`, `StateProbeResult`, and `JudgeVerdict`.
- Produces: typed distinction between test/assertion outcome and sandbox infrastructure/setup/timeout outcome; bounded, sanitized execution evidence; static evidence provenance where needed. `JudgeVerdict` wire shape stays unchanged unless contract tests and a separately approved decision require otherwise.

- [ ] Add tests proving static evidence can yield `valid/PASS` only after source evidence validation and does not claim runtime execution.
- [ ] Add tests proving Docker/setup/timeout/compiler failures yield `unverified/UNVERIFIED`, never `invalid/FAIL`.
- [ ] Add tests proving actual claim assertion failure may be considered only with validated test/trace evidence; raw exit code alone cannot synthesize `invalid`.
- [ ] Run focused protocol/core tests and observe the new tests fail for the missing distinction.
- [ ] Implement the smallest port/event/core change; enforce payload and output-size bounds, redact secrets, preserve append-only semantics and credential/ground-truth rejection.
- [ ] Run focused tests and typecheck affected packages; record any approved contract change before implementation.

### Task 3: Implement claim extraction, snapshot mapping and bounded BCE

**Files:**
- Create: adapter package files selected in Task 1 (ingestion and BCE adapter modules).
- Modify: `packages/core/src/runner/run-stages.ts` only for required status behavior.
- Test: adapter tests, `packages/core/test/runner/*`, sanitized Solidity fixtures under an adapter test fixture directory.

**Interfaces:**
- Consumes: `IngestionPort.ingest({runId,snapshotId,finding}, signal)`, `SourceSnapshotPort`, selected toolchain decision.
- Produces: `IngestionResult` with structured `DeconstructedClaim`, bounded BCE slices, source citations/line ranges, and explicit incomplete/unsupported result. No adapter reads host repo paths or ground-truth sources.

- [ ] Write tests for narrative-only and PoC report extraction: valid structured claims, malformed reports, missing targets, oversized reports and unsupported syntax.
- [ ] Write tests for BCE source-map accuracy, modifiers/guards, caller/callee/state evidence where supported, denied paths, dependency absence and incomplete graph; assert missing edges never return “blocked” as a proof.
- [ ] Run focused tests and observe failures.
- [ ] Implement extraction using the chosen bounded method and configured model/tool inputs; validate output schema and target/citation mapping through `SourceSnapshotPort` before returning it.
- [ ] Ensure the adapter receives only the candidate finding and immutable snapshot port; it must not access corpus/scoring/adjudication data or absolute host paths.
- [ ] Run adapter/core tests and typechecks; document supported profile and explicit unknowns.

### Task 4: Enforce bidirectional evidence validation and no-witness narrative path

**Files:**
- Modify: `packages/core/src/runner/judge-step.ts`, `packages/core/src/judge/bidirectional-verifier.ts`, prompt templates only where required.
- Test: `packages/core/test/runner/judge-runner.test.ts`, `packages/core/test/judge/bidirectional-verifier.test.ts`.

**Interfaces:**
- Consumes: Task 3 structured claim/BCE result; existing forward/backward typed results and `JudgeVerdict`.
- Produces: consensus result eligible for static verdict only with validated citations and sufficiently complete supported BCE; otherwise it requests an available submitter PoC path or commits inconclusive. No generated witness path.

- [ ] Add tests for valid matched forward/backward evidence, a source-verified blocking guard, mismatched/fabricated citations, incomplete BCE, conflicting directions, and missing citation.
- [ ] Add tests proving narrative-only does not call sanitizer/sandbox and returns `UNVERIFIED` when runtime evidence is needed.
- [ ] Run focused runner tests and observe failures.
- [ ] Implement validation against exact snapshot lines/digests before arbiter/terminal verdict; consensus alone cannot upgrade unverified evidence.
- [ ] Preserve correct status semantics: validated static claim may be `PASS`; unresolved/incomplete/runtime-needed without safe PoC remains `UNVERIFIED`.
- [ ] Run focused tests and the full core suite.

### Task 5: Implement pre-execution PoC policy and real Docker/Foundry sandbox

**Files:**
- Create: production sanitizer/policy and sandbox adapter modules in package selected by Task 1.
- Modify: `packages/core/src/sandbox/*` only for contract-compatible shared values.
- Test: sanitizer/policy unit tests, sandbox adapter tests, Docker/Foundry integration tests guarded on prerequisites.

**Interfaces:**
- Consumes: `SanitizerPort`, `SandboxPort`, immutable snapshot ID, Task 1 toolchain/image decision, Task 2 typed outcomes.
- Produces: production adapters. Sanitizer reports policy/compile eligibility but is not an isolation boundary; sandbox executes only validated test material copied/mounted from an authorized immutable snapshot plus PoC input.

- [ ] Add policy tests for import/path escape, `vm.ffi`, external/network behavior, implementation/bytecode replacement, test-target mocking, missing/misbound assertions, malformed Solidity and resource abuse. Rejected input must never reach Docker.
- [ ] Add sandbox tests for required `network=none`, image digest pin, read-only input, no secrets/host Docker socket in container, tmpfs-only output, dropped capabilities, non-root user, CPU/RAM/time limits, cancellation/kill, bounded output and best-effort cleanup.
- [ ] Add integration tests (skip when Docker/image/Foundry unavailable) that execute a benign test, a confirmed assertion test, timeout, compile/setup error and cancellation; assert they map to distinct typed outcomes.
- [ ] Run policy tests and observe failure before implementation; keep destructive hostile integration cases inside disposable fixture containers.
- [ ] Implement adapters with fail-closed Docker invocation; use existing Bun process APIs and no shell interpolation of untrusted values. Do not treat source sanitizer as sandboxing.
- [ ] Verify an attempted unsafe fixture is rejected before process launch and the container sees only fixture snapshot/test inputs.
- [ ] Run unit, guarded integration and static checks; if any required macOS isolation property cannot be verified, keep execution disabled and record blocker.

### Task 6: Production local composition and fail-closed startup

**Files:**
- Create/modify: `packages/server/src/production-runtime.ts`, startup wiring, package export and tests.
- Modify: `packages/cli/src/config.ts`, CLI/server entrypoint and `.env.example` for non-secret settings only, as required.
- Test: `packages/server/test/*`, CLI config/startup tests.

**Interfaces:**
- Consumes: PostgreSQL `PostgresRunStore`, real provider adapter, disk snapshot storage, Task 3–5 production ports, Keychain credential provider and `startJudgeServer`.
- Produces: one documented local command/composition that validates Docker, image, PostgreSQL, snapshot root, provider configuration and Keychain before accepting requests; worker poll lifecycle stops cleanly and health handshake reports actual compatibility/capabilities.

- [ ] Add startup tests proving missing/unsupported Keychain, database, model, snapshot, Docker or image configuration fails closed before listen; no mock/scripted fallback.
- [ ] Add lifecycle tests for local-only binding, worker polling/recovery, error resilience, stop cleanup and health/API compatibility.
- [ ] Run focused tests and observe failure.
- [ ] Wire only production adapters and real infrastructure into a CLI/server process entrypoint; resolve secrets through approved Keychain boundary and never command-line args/plaintext files.
- [ ] Make effective behavior and toolchain versions part of immutable run config/telemetry; do not expose secrets.
- [ ] Run CLI/server typecheck and tests; verify the documented command reaches readiness with local dependencies and fails closed when one is absent.

### Task 7: End-to-end evidence, release gates and operations docs

**Files:**
- Modify: `packages/server/test/*`, core scenario tests and `packages/server/README.md`.
- Create: sanitized Solidity test fixture package/directory and local verification script only if existing commands cannot cover the release gate.
- Modify: `docs/superpowers/plans/2026-10-22-judge-mvp-real-pipeline.md` tracking checkboxes and release result.

**Interfaces:**
- Consumes: all production adapters and composition from Tasks 1–6.
- Produces: verified end-to-end capability statement distinguishing static PASS, runtime PASS, invalid/FAIL, and UNVERIFIED; setup/recovery/security guidance and measured supported fixture coverage.

- [x] Add an API→worker→real `JudgeRunner` scenario using real snapshot ingestion for narrative/unresolved/no-witness behavior. Full HTTP-to-Postgres and the requested additional safe-PoC/unsafe-PoC/infra-failure production adapter cases remain blocked because Task 6 does not expose production runtime and PoC policy denies all.
- [x] Assert provider request and API event projection contain no prohibited ground-truth/adjudication/scoring metadata in the deterministic runner E2E. No fixture includes such metadata.
- [x] Docker Foundry test requires both `TASK5_DOCKER_INTEGRATION=1` and `TASK5_ARTIFACT_ROOT`; its prior live evidence is Linux ARM64 only. No live PostgreSQL E2E was available.
- [x] Run `bunx turbo typecheck` and `bunx turbo test` (all six package typechecks; 878 tests pass, 0 fail), `swiftc -typecheck packages/server/native/keychain-credential.swift`, and `git diff --check`. Focused server suite: 60 pass, 1 Docker integration skipped without opt-in; Docker test was not run in this verification, PostgreSQL Judge integration is unavailable/not implemented.
- [x] Document readiness-only `bun run cli:serve`, runtime seam payload, status meanings, bounds, tool versions, coverage limits, cleanup and recovery.
- [x] Release remains BLOCKED: BCE incomplete for verdicts, policy deny-only, Docker macOS unverified, production API/worker composition absent, and PostgreSQL end-to-end path unverified. No full MVP/production claim.

## Completion criteria

The MVP is complete only when all seven tasks pass, the local production composition runs with real PostgreSQL/model/snapshot/Foundry-Docker dependencies, and the E2E tests prove both input types without scripted production adapters. If the platform cannot prove sandbox isolation, runtime PoC execution is explicitly not complete; the release must be labeled static-only/inconclusive rather than a full Judge MVP.
