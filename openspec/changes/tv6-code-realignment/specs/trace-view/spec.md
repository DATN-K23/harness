## ADDED Requirements

### Requirement: Desktop SSE connection state management

The desktop client UI state store SHALL manage connection status states (`connecting`, `connected`, `reconnecting`, `offline`) and automatically handle reconnection logic.

#### Scenario: Displaying network disconnection and automatic retry

- **WHEN** the SSE stream drops due to daemon restart or network interruption
- **THEN** desktop UI transitions state to `reconnecting` and attempts reconnection with the latest step index offset.

### Requirement: Tool call and thought event deduplication

The desktop trace UI store SHALL filter incoming streaming events by unique ID and step index to prevent duplicate list entries during stream recovery.

#### Scenario: Stream replay yields existing tool call ID

- **WHEN** an event with an already rendered `tool_call` ID is received
- **THEN** store ignores the duplicate item and preserves current list state.
