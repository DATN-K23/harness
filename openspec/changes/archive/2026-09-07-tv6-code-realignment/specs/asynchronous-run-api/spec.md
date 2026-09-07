## ADDED Requirements

### Requirement: Server-Sent Events live stream endpoint

The local daemon API SHALL expose an SSE streaming endpoint at `/api/v1/runs/{run_id}/stream` to deliver real-time progress events (`status_changed`, `thought`, `tool_call`, `verdict`, `completed`) to the desktop client.

#### Scenario: Subscribing to live run stream

- **WHEN** client opens an EventSource connection to `/api/v1/runs/{run_id}/stream`
- **THEN** daemon replays historical `thought` (from `model_events` table) and `tool_call` (from `tool_calls` table) events filtered by `from_step`, then subscribes to live events from the in-process EventBus.

### Requirement: Dual-write for thought events (persist + publish)

Every `thought` event produced by the agent loop SHALL be written to the `model_events` table (with `event_type = 'thought'`) **before** being published to the EventBus, so that reconnecting clients receive a complete replay from the database.

#### Scenario: Persisting thought event before live publish

- **WHEN** the agent loop emits a thought at step N
- **THEN** daemon first inserts a `ModelEvent` row (`event_type='thought'`, `step_index=N`, `content=<thought_text>`)
- **AND THEN** publishes `event: thought` to the EventBus for live subscribers.

### Requirement: Event playback with offset filtering

The stream endpoint SHALL support an optional `from_step` query parameter (default `0`) to allow clients to request only steps they have not yet received.

#### Scenario: Reconnecting with step offset

- **WHEN** client reconnects with `from_step=3`
- **THEN** daemon filters historical `thought` and `tool_call` events from DB to only yield rows with `step_index >= 3`.
- **AND** `status_changed` is always emitted once as the first event regardless of `from_step`, reflecting current run status.

### Requirement: REST endpoints for run lifecycle

The daemon SHALL expose the following REST endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/runs` | List all audit runs, ordered by `created_at DESC` |
| `GET` | `/api/v1/runs/{run_id}` | Get single run with latest verdict |
| `POST` | `/api/v1/runs/judge` | Create and start a new audit run asynchronously |
| `GET` | `/api/v1/runs/{run_id}/stream` | SSE live stream with `from_step` offset |
| `GET` | `/api/v1/runs/{run_id}/tool-calls` | Paginated tool call history |

#### Scenario: Starting a new judge run

- **WHEN** client POSTs to `/api/v1/runs/judge` with `{ repository, findingId, modelName, tokenBudget }`
- **THEN** daemon creates a `Run` record in `PENDING` state and returns `{ runId }` immediately.
- **AND** the agent loop starts asynchronously in the background.
