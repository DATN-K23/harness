## ADDED Requirements

### Requirement: Server-Sent Events live stream endpoint

The local daemon API SHALL expose an SSE streaming endpoint at `/api/v1/runs/{run_id}/stream` to deliver real-time progress events (`status_changed`, `thought`, `tool_call`, `verdict`, `completed`) to the desktop client.

#### Scenario: Subscribing to live run stream

- **WHEN** client opens an EventSource connection to `/api/v1/runs/{run_id}/stream`
- **THEN** daemon streams past events from database first, then streams live events published to the EventBus PubSub topic for `run_id`.

### Requirement: Event playback with offset filtering

The stream endpoint SHALL support an optional `from_step` query parameter to allow clients to fetch missing steps without duplicate event rendering upon reconnection.

#### Scenario: Reconnecting with step offset

- **WHEN** client reconnects with `from_step=3`
- **THEN** daemon filters historical `thought` and `tool_call` events to only yield items with `step_index >= 3`.
