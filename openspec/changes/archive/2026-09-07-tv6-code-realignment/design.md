## Context

See `proposal.md` for overall motivation. Existing TV6 codebase on `feat/frontend` has implemented the Daemon API, SQLite ORM models, SDK TS client, and Zustand store for Desktop UI. This design document formalizes the technical approach, architecture, and mitigations for identified technical risks.

## Goals / Non-Goals

**Goals:**

- Formalize SSE Live Streaming architecture via `EventBus` in FastAPI `runs.py`.
- Ensure 1-to-1 schema compatibility between TypeScript (`@harness/contracts`) and Python Pydantic (`RunSchema`, `VerdictSchema`, `ToolCallSchema`).
- Establish SSE Reconnection handling with `from_step` query parameter in Client Zustand store.
- Define explicit Handoff Boundary from `mock_agent_loop` to TV1's out-of-process Worker engine.

**Non-Goals:**

- Modifying Worker Engine internal logic (owned by TV1).
- Modifying Security Source Tools implementation (owned by TV3/TV4).

## Decisions

### Decision 1: PubSub EventBus for SSE Live Streaming

- **Decision**: Use `asyncio.Queue`-backed `EventBus` in `runtime/src/harness/modules/events/bus.py` for real-time event broadcasting instead of HTTP polling.
- **Rationale**: Eliminates redundant database polling overhead, providing low-latency real-time trace timeline updates.
- **Alternatives Considered**: 1-second HTTP polling (rejected due to high query latency and server load).

### Decision 2: Desktop UI Deduplication & Reconnection Offset

- **Decision**: Client Zustand Store handles reconnection via `from_step` offset and filters duplicate events by ID (`toolCalls.some(...)`).
- **Rationale**: Guarantees consistent timeline UI rendering even during network drops or daemon restarts.

## Risks / Trade-offs

- [Risk: EventBus Memory Leak] → **Mitigation**: Set `maxsize=100` for asyncio Queues and discard unsubscribed queues in `finally` blocks.
- [Risk: SQLite Deadlock under Async Workloads] → **Mitigation**: Utilize scoped `SessionLocal` sessions per async task generator execution.

### Conscious MVP Trade-offs (Deviations from Canonical Specs)

- **SQLite Database**: The canonical `trajectory-persistence` spec requires PostgreSQL for durable execution. The MVP uses SQLite for rapid iteration, which lacks proper daemon restart survival. The `DATABASE_URL` environment variable is used to ensure a smooth transition to PostgreSQL planned for the production evaluation phase (C17-C18).
- **No-Auth Loopback Binding**: The canonical `asynchronous-run-api` spec requires an installation-scoped access credential. The MVP implements a single-user loopback binding (`127.0.0.1:3000`) without explicit authentication, deferring the credential layer as it falls outside the current `bootstrap-judge-mode-mvp` scope defined in `openspec/config.yaml`.
- **SSE-First Delivery**: The canonical spec prescribes cursor-based polling-first retrieval. The MVP prioritizes Server-Sent Events (SSE) for low-latency real-time tracing, with the polling-first fallback mechanism deferred to future resilience improvements (C09).

### Handoff Boundary to TV1 Worker

- **Boundary Definition**: The boundary between TV6 Daemon (API/Persistence) and TV1 Worker (Agent Execution) is defined through the PostgreSQL (or SQLite MVP) database.
- **Mechanism**: The daemon accepts runs and places them in a `QUEUED` state. The out-of-process TV1 Worker polls the database, claims the run (changing status to `RUNNING`), executes the agent loop, and writes `ModelEvent`, `ToolCall`, and `Verdict` records back to the database.
- **Mock Replacement**: The current `mock_agent_loop` simulates this boundary by performing the required dual-writes (persisting to DB, then publishing to the `EventBus`). When TV1 integrates, this mock will be replaced by the actual out-of-process worker, which must adhere to the same dual-write contract so that the frontend's SSE streams and reconnection logic function seamlessly.
