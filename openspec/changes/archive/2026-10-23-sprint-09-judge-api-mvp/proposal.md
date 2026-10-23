# Proposal: Sprint 09-10 Judge API MVP

## Why

To support the research objective of empirical auditing comparisons (RQ1) and provide an integration seam for desktop and client applications, the system requires an end-to-end Judge pipeline. Findings submitted against immutable snapshots must be asynchronously admitted, executed via an out-of-process worker, evaluated by real or simulated model providers, and returned as structured verdicts with validated source line citations while strictly maintaining ground-truth isolation (Rule R2).

## What Changes

- Implement an asynchronous local-runtime HTTP API for Judge submission, status polling, cursor-based event streaming, and cooperative cancellation (`POST /v1/judge/runs`, `GET /v1/judge/runs/:id`, `GET /v1/judge/runs/:id/events`, `POST /v1/judge/runs/:id/cancel`).
- Enforce durable admission with PostgreSQL outbox pattern and strict idempotency handling via `idempotency_keys` table.
- Connect `JudgeRunner` multi-stage pipeline (Ingestion, Sanitization, Sandbox preflight, Bidirectional verifier, Step loop, Verdict synthesis) with the PostgreSQL store and RealModelGateway.
- Mandate normative JSON verdict decoding with harness-computed SHA-256 digests over source spans, guaranteeing that while BCE (Bounded Context Extraction) is incomplete, all pre-verification verdicts resolve as `unverified` / `UNVERIFIED`.
- Distinguish between domain conclusion verdicts and infrastructure/execution faults, preventing network or database errors from being misclassified as invalid findings.

## Capabilities

### Modified Capabilities
- `asynchronous-run-api`: Wire the local HTTP server to the Judge submission service, outbox worker, HMAC-signed cursor event pagination, and authenticated loopback endpoints.

## Impact

- `@harness/server`: Implementation of `createJudgeApi`, `createJudgeSubmissionService`, `createOutboxWorker`, `createJudgeRuntime`, and `startProductionLocalServer`.
- `@harness/schema`: Outbox table, idempotency keys, and transaction-safe admission.
- `@harness/protocol`: `JudgeSubmitRequestSchema` and prohibited key validation (`forbiddenKeyPaths`).
- `@harness/core`: End-to-end integration of `JudgeRunner` with snapshot validation and verdict synthesis.
