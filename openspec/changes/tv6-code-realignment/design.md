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
