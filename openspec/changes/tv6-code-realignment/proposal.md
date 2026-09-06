## Why

The TV6 codebase (covering the Daemon API, SSE Live Streaming, SQLite Persistence, SDK, and Desktop UI) was developed directly on the `feat/frontend` branch prior to formal spec drafting. This change serves as a spec realignment (backfill), formalizing all existing code capabilities into OpenSpec while identifying and planning mitigation for technical risks such as SSE reconnection logic, IPC handoff to TV1 worker, and database concurrency.

## What Changes

- **Daemon API Realignment**: Formalize REST endpoints (`/api/v1/runs`, `/api/v1/runs/judge`, `/api/v1/runs/{id}/stream`) and the EventBus-backed SSE live streaming contract.
- **Desktop UI & Reconnection Realignment**: Formalize SSE connection status management (`connecting`, `connected`, `reconnecting`, `offline`) and automatic `from_step` offset backfill upon reconnection.
- **SQLite Persistence Schema Realignment**: Formalize relational ORM tables (`runs`, `tool_calls`, `model_events`, `verdicts`) aligned 1-to-1 between Python SQLAlchemy and TypeScript `@harness/contracts`.
- **Vulnerability Audit & Handoff Boundary**: Identify and isolate the handoff point from `mock_agent_loop` to TV1's out-of-process worker engine.

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `asynchronous-run-api`: Specifying SSE live stream endpoints, `from_step` query parameter filtering, and run cancellation semantics.
- `trace-view`: Specifying SSE reconnection handling and real-time event timeline rendering in Desktop UI.
- `trajectory-persistence`: Specifying alignment of SQLite database models with TypeScript contracts.

## Impact

- Affected Code: `apps/desktop/ui/src/`, `packages/contracts/src/`, `packages/sdk/src/`, `runtime/src/harness/entrypoints/daemon/`, `runtime/src/harness/modules/persistence/`.
- System Impact: Ensures 100% compliance with OpenSpec validation rules and prepares stable interfaces for TV1 worker integration.
