## ADDED Requirements

### Requirement: Desktop SSE connection state management

The desktop client UI state store (`run.store.ts`) SHALL manage connection status states (`connecting`, `connected`, `reconnecting`, `offline`) and expose them to the UI layer via the `sseStatus` field.

#### Scenario: Displaying network disconnection and automatic retry

- **WHEN** the SSE stream drops (EventSource fires `onerror`)
- **THEN** desktop UI transitions `sseStatus` to `reconnecting`
- **AND** the client closes the failed EventSource, waits with exponential backoff (500ms base, max 30s, 10 max attempts), then opens a new EventSource at the stream URL with `from_step = (lastKnownStepIndex + 1)` to avoid replaying already-rendered steps.
- **AND** on successful reconnect, `sseStatus` transitions to `connected`.
- **AND** if the maximum retry count is exceeded, `sseStatus` transitions to `offline` and auto-retry stops.

#### Scenario: Tracking last known step index

- **WHEN** the client receives a `thought` or `tool_call` event with `stepIndex = N`
- **THEN** the client tracks `lastKnownStepIndex = max(lastKnownStepIndex, N)` so that the next reconnect attempt correctly requests `from_step = N + 1`.

### Requirement: Tool call and thought event deduplication

The desktop trace UI store SHALL filter incoming streaming events by unique ID and step index to prevent duplicate list entries during stream recovery.

#### Scenario: Stream replay yields existing tool call ID

- **WHEN** an event with an already-rendered `tool_call` ID is received during reconnect replay
- **THEN** the store ignores the duplicate item and preserves current list state (`appendToolCall` checks `toolCalls.some(e => e.id === tc.id)`).

#### Scenario: Stream replay yields existing thought at same step

- **WHEN** a `thought` event arrives with the same `id` or `(stepIndex, eventType)` combination already in `modelEvents`
- **THEN** the store ignores the duplicate and preserves current list state.
