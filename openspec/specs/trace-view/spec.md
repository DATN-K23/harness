# trace-view Specification

## Purpose

Defines the downloadable desktop's trace-first interaction blueprint and wireframe acceptance criteria for connecting to the local runtime, submitting, reconnecting, monitoring, and explaining Judge runs safely.

## Requirements

### Requirement: Submission and asynchronous state wireframes

The blueprint SHALL define the information architecture, local-runtime discovery/health/compatibility states, fields, validation feedback, snapshot selection, provider/model selection, idempotency behavior, `run_id` navigation, polling, reconnect, and distinct accepted, queued, running, and terminal screen states.

#### Scenario: Long-running flow is reviewed

- **GIVEN** the submission and run-view wireframes
- **WHEN** a reviewer follows a valid request that remains running
- **THEN** the generated-client contract returns immediately to a `run_id` view, exposes committed partial state, survives desktop reconnect, and never presents a partial verdict as final

### Requirement: Ordered trace presentation

The blueprint MUST define how ordered model steps and tool calls show timestamps, durations, context allocation, token usage, cost, bounded arguments/results, error state, and truncation/redaction/security markers without exposing prohibited originals.

#### Scenario: Blocked and transformed event is rendered

- **GIVEN** a trajectory containing a blocked path attempt and a redacted tool result
- **WHEN** the trace wireframe maps those events
- **THEN** it distinguishes both conditions, displays safe explanations and rule versions, and contains no ground truth, secret, or unredacted blocked argument

### Requirement: Verdict and evidence presentation

The blueprint SHALL define completed verdict, severity, confidence, prominent unverified status, rationale, aggregate latency/cost, and authorized evidence navigation, plus failed, cancelled, and budget-exhausted terminal states.

#### Scenario: Terminal states are compared

- **GIVEN** examples for every terminal state
- **WHEN** they are reviewed against the component-state matrix
- **THEN** only completed runs show a final verdict and every other state shows its safe terminal reason and committed trace

### Requirement: Runtime connection and recovery presentation

The blueprint MUST define distinct safe desktop states for runtime starting, unavailable, unauthorized-local, incompatible-version, reconnecting and ready. Submission or mutation controls MUST remain disabled when runtime identity or contract compatibility is unverified. Reopening a compatible desktop MUST rebuild the run view from committed API resources/events rather than treating renderer cache as authoritative.

#### Scenario: Runtime restarts while a trace is open

- **GIVEN** the desktop is displaying a non-terminal run and the local daemon becomes temporarily unavailable
- **WHEN** the connection is restored with a compatible identity and contract digest
- **THEN** the view resumes cursor polling from the last committed sequence, de-duplicates events, shows no fabricated progress, and preserves explicit recovery feedback throughout the interruption

### Requirement: Thin desktop security presentation

The desktop renderer and native shell MUST use only the generated local-runtime client for Judge data. Wireframes and component contracts MUST NOT depend on direct provider, database, source-tool or scorer access. Raw host repository paths MAY appear transiently in the native repository picker, but MUST NOT appear in provider/model-visible content, run routes, trajectories, ordinary logs, exported traces or persisted desktop view state.

#### Scenario: Registered repository is displayed after submission

- **GIVEN** an operator selected a host directory and the runtime registered an immutable source snapshot
- **WHEN** the run and trace views render that source
- **THEN** they display the opaque snapshot identity, revision and digest rather than the raw host path, and all file navigation remains bounded to authorized evidence returned by the runtime

### Requirement: Least-authority native-shell bridge

The blueprint MUST define an explicit per-window capability and permission allowlist for every renderer-to-native operation. The native bridge SHALL expose only typed operations required for runtime discovery/start-or-attach, protected local request mediation, repository selection, notifications and coordinated update preparation. Generic filesystem, shell, process, environment, arbitrary-URL, raw-credential and direct updater primitives MUST remain unavailable to renderer code; adding a new native authority requires an explicit security review and contract change rather than a permissive default.

#### Scenario: Untrusted rendered content attempts native execution

- **GIVEN** model, source or trace content displayed by the renderer attempts to invoke an undeclared filesystem, shell, process, credential or updater operation
- **WHEN** the request reaches the renderer-to-native boundary
- **THEN** no callable permission or generic command exists, the operation is denied without exposing secret or host data, and the denial is available as a safe local diagnostic without changing the Judge run trajectory

#### Scenario: Repository selection uses a narrow native command

- **GIVEN** the operator explicitly requests repository registration from a permitted desktop window
- **WHEN** the allowlisted native picker command returns a selected path
- **THEN** the path is held only as short-lived sensitive control-plane input, is sent through the generated registration operation, and grants neither arbitrary renderer filesystem access nor model/tool authority

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
