# Design: Judge API MVP Implementation

## Context

See `proposal.md` for the motivation and high-level scope. The harness uses a hexagonal architecture where `@harness/server` serves as the runtime adapter connecting HTTP loopback requests from clients to the core `JudgeRunner` orchestration via an asynchronous transactional outbox.

## Goals / Non-Goals

**Goals:**
- Provide a robust local-loopback HTTP API (`/v1/judge/runs`, `/v1/judge/runs/:id`, `/v1/judge/runs/:id/events`, `/v1/judge/runs/:id/cancel`).
- Support durable admission with idempotent conflict detection via sha256 request digests and `idempotency_keys`.
- Run Judge runs asynchronously through `outbox-worker` polling with claim leases and CAS transitions.
- Validate evidence spans using immutable snapshot citations and enforce that incomplete BCE marks verdicts as `unverified` / `UNVERIFIED`.
- Distinguish system/infrastructure errors from business verdicts (never mark execution failure as finding invalid).

**Non-Goals:**
- Live containerized PoC exploit execution (disabled in production runtime pending verified sandbox isolation).
- Cross-run long-term memory or shared agent state across runs.
- Multi-user authentication or public network exposure (strictly bound to 127.0.0.1 with local bearer token).

## Decisions

### 1. Loopback-bound Authenticated API
- **Decision:** All Judge API routes bind to `127.0.0.1` and require an installation-scoped secret bearer token via `Authorization: Bearer <token>`.
- **Alternatives Considered:** Unauthenticated localhost binding or Unix domain sockets. Bearer token provides protection against unauthorized browser origin access (DNS rebinding / CSRF).

### 2. Transactional Admission and Outbox Pattern
- **Decision:** `POST /v1/judge/runs` inserts the run in `queued` state and adds a record to the `outbox` table in a single database transaction, returning HTTP 202 immediately.
- **Alternatives Considered:** In-memory queue or synchronous execution. The outbox pattern guarantees that work survives process crashes and server restarts.

### 3. Signed Cursor-based Event Pagination
- **Decision:** `GET /v1/judge/runs/:id/events` uses HMAC-SHA256 signed tokens encoding `version`, `runId`, `afterSequence`, and `pageSize`.
- **Alternatives Considered:** Plain sequence query parameters. Signed cursors prevent unauthorized pagination manipulation across runs and tampering.

### 4. Conservative Adjudication and Unverified Stance
- **Decision:** As long as Bounded Context Extraction (BCE) is incomplete, all synthetically validated findings terminate with validity `unverified` and status `UNVERIFIED`.
- **Alternatives Considered:** Accepting candidate validity based on LLM reasoning alone. Bypassing PoC verification would violate empirical research rigor (Rule R1).

## Risks / Trade-offs

- **[Risk]** Model provider rate limits or timeouts during multi-step execution.
  → **Mitigation:** Exponential backoff with jitter on transient errors; terminal failure records typed error category without marking the finding invalid.
- **[Risk]** Concurrent worker lease race conditions.
  → **Mitigation:** Compare-and-set updates on `runs` and lease expiration on `outbox` records.
