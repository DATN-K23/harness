# provider-abstraction Specification

## Purpose

Defines the provider-neutral blueprint contract needed to compare models without leaking vendor-specific behavior into Judge orchestration or evaluation records.

## Requirements

### Requirement: Normalized provider port
The blueprint MUST define versioned request, response, message, structured-output, tool-call, usage, model-capability, and error schemas without importing provider SDK types into orchestration contracts. The `model_gateway` capability MUST own the port, profiles and all real/deterministic provider adapters; other runtime capabilities MAY import only its public contract, and the desktop MUST have no provider-SDK or credential-resolution path.

#### Scenario: Adapter design is checked
- **GIVEN** a candidate provider's native request and response examples
- **WHEN** an implementer maps them to the provider port
- **THEN** every required normalized field has a documented mapping, unsupported capability behavior, and loss-of-fidelity note

#### Scenario: Provider dependency placement is reviewed
- **GIVEN** a provider SDK mapping, credential resolver, deterministic adapter or provider-specific error
- **WHEN** its physical owner and import path are checked
- **THEN** it resides behind `model_gateway` outbound adapters, exposes only project-owned public types, and is unavailable to Judge/domain internals, desktop code and scorer-only logic except through declared public operations

### Requirement: Identity, usage, latency, and cost metadata
The blueprint SHALL define provider, immutable model identifier/version, endpoint or region when exposed, request identifiers, context limit source, sampling parameters and seed support, native and normalized usage, latency boundaries, pricing version, estimated cost, and credential exclusion.

#### Scenario: Reproduction metadata is reviewed
- **GIVEN** a representative provider attempt
- **WHEN** its planned trajectory fields are compared with the provider contract
- **THEN** all reproducibility and fairness metadata is retained while credentials and secret headers are explicitly prohibited

### Requirement: Error and retry normalization
The blueprint MUST define transient and permanent error categories, retry eligibility, maximum attempts, backoff representation, provider-attempt telemetry, and accounting against wall-clock and cost budgets.

#### Scenario: Permanent error is modeled
- **GIVEN** an authentication, validation, or unsupported-feature failure
- **WHEN** the error mapping table is applied
- **THEN** the blueprint classifies it as non-retryable and identifies the terminal event without consuming transient retry attempts

### Requirement: MVP conformance profiles and expansion seam
The blueprint SHALL define one real-provider profile and two deterministic profiles that use the same conformance cases for orchestration, tools, verdicts, metadata, errors, and trajectories. Additional real adapters and the cross-provider matrix MUST remain a later implementation change.

#### Scenario: Provider scope is reviewed
- **GIVEN** the MVP provider conformance matrix
- **WHEN** acceptance coverage is counted
- **THEN** one real profile and two deterministic profiles cover identical contract categories without claiming RQ3 is complete

### Requirement: Versioned real-provider profile and call-authorization gate
The blueprint MUST define a provider profile separately from the provider-integration ADR. Each profile SHALL record a stable profile ID and version, provider family, API transport, pinned SDK version, immutable model snapshot rather than a floating alias, knowledge cutoff and source, context limit and source, capability-map version/digest, pricing version/source, credential-owner reference, paid-call ceiling, and approval status. The MVP `real-primary` profile SHALL target OpenAI Responses API, but it MUST NOT authorize a network call until every required field and approval is present. A profile change MUST create a new profile version without rewriting the accepted provider-port architecture.

#### Scenario: Incomplete real profile is selected
- **GIVEN** the OpenAI `real-primary` profile is missing its exact model snapshot, knowledge-cutoff evidence, pricing version, credential owner, paid-call ceiling, capability digest, or approval
- **WHEN** a run or fidelity spike requests that profile
- **THEN** the blueprint requires rejection before network activity or provider cost, while both deterministic profiles remain usable and the direct official-SDK strategy remains the accepted integration boundary

### Requirement: Observable single-attempt provider boundary
Each provider-port invocation defined by the blueprint MUST execute at most one externally billable provider attempt and return one normalized response or error. Provider-side automatic retries MUST be disabled where configurable; otherwise the adapter SHALL expose each native attempt without loss and MUST fail conformance when attempt count, usage, latency, cost, or retry behavior cannot be observed accurately. Retry policy and subsequent attempts belong outside the adapter and count against immutable run budgets.

#### Scenario: SDK retry behavior is inspected
- **GIVEN** a provider SDK whose default transport can retry automatically
- **WHEN** the adapter configuration and attempt trajectory are reviewed
- **THEN** automatic retry is disabled or every native attempt is surfaced separately, and no recorded single attempt hides additional latency, usage, cost, or failure outcomes

### Requirement: Local tool custody in Judge mode
The Judge provider request MUST advertise only versioned local tool definitions owned by the run's immutable tool registry. Provider-hosted web search, code execution, file search, shell, computer use, MCP, or other provider-executed tools MUST NOT be enabled, treated as equivalent local tools, or accepted as Judge evidence.

#### Scenario: Provider-hosted tool call is returned
- **GIVEN** a provider response containing a provider-executed or unregistered hosted-tool event
- **WHEN** the response crosses the provider boundary
- **THEN** the adapter or orchestrator rejects it as a non-conforming capability outcome, records a safe error without dispatching it locally, and does not continue or complete a verdict from that result

### Requirement: Real model gateway execution and timeout management
The provider gateway SHALL provide a concrete adapter `RealModelGateway` implementing `ModelGatewayPort`.
- `executeAttempt` MUST transform incoming `ModelAttemptRequest` context items and prompts into provider API calls without importing provider SDK types into orchestrator contracts.
- `executeAttempt` MUST bind external `AbortSignal` timeouts to the provider request and handle signal cancellation gracefully.
- Provider-side SDK internal retry loops MUST be disabled (`maxRetries: 0`) so every attempt corresponds to exactly one externally billable API call.
- Provider failures MUST resolve as `ModelAttemptResponse` with `error` populated and MUST NOT reject the returned Promise.

#### Scenario: Successful model completion attempt
- **GIVEN** a valid `ModelAttemptRequest` with prompt context and active API credentials
- **WHEN** `executeAttempt` is invoked
- **THEN** it returns a `ModelAttemptResponse` with `finishReason: "stop"`, non-empty `content`, structured `usage`, and positive `latencyMs`.

#### Scenario: Provider attempt timeout via AbortSignal
- **GIVEN** a `ModelAttemptRequest` with an aborted or timed-out `AbortSignal`
- **WHEN** `executeAttempt` is called
- **THEN** it resolves without throwing, returning a `ModelAttemptResponse` with `finishReason: "error"`, `error.category: "transport"`, and `error.isTimeout: true`.

### Requirement: Model pricing registry and cost calculation
The provider gateway SHALL maintain a model pricing registry and calculate `costUsd` on every attempt.
- For `gpt-4o-mini`, input token pricing MUST be calculated at $0.150 per 1,000,000 tokens and output token pricing at $0.600 per 1,000,000 tokens.
- Total `costUsd` in `ModelUsage` MUST accurately reflect `(promptTokens * inputRate) + (completionTokens * outputRate)`.

#### Scenario: Exact cost calculation for token usage
- **WHEN** a provider attempt reports 1,000 prompt tokens and 500 completion tokens for `gpt-4o-mini`
- **THEN** `usage.costUsd` is computed as exactly 0.000450 USD with non-negative integer token counts.

### Requirement: Error classification and credential protection
The provider gateway SHALL classify all provider HTTP and network errors into standard categories (`transport`, `rate_limit`, `authentication`, `invalid_request`), determine `isRetryable`, and scrub credentials.
- HTTP 401 and 403 errors MUST be classified as `authentication` with `isRetryable: false`.
- HTTP 429 and quota errors MUST be classified as `rate_limit` with `isRetryable: true`.
- HTTP 400 errors or context length violations MUST be classified as `invalid_request` with `isRetryable: false`.
- Network disconnections, socket timeouts, and 5xx errors MUST be classified as `transport` with `isRetryable: true`.
- Error messages MUST NOT contain raw API keys, bearer tokens, or sensitive endpoint secrets.

#### Scenario: Authentication error classification and key redaction
- **GIVEN** an invalid API key `sk-secret-test-key-1234` causing an HTTP 401 error
- **WHEN** `executeAttempt` handles the response
- **THEN** `error.category` is `"authentication"`, `error.isRetryable` is `false`, and `error.message` does not contain `sk-secret-test-key-1234`.

### Requirement: Tool definitions and tool choice reach the provider
The real gateway SHALL send every tool definition of an attempt request in the provider's tool field. Each definition SHALL keep its name and description, and its parameters SHALL be projected to an object JSON Schema the endpoint accepts. When tools are disabled or the request has no tools, the gateway SHALL send no tool definitions. When the request allows at most one tool call, the gateway SHALL disable parallel tool calls. Tool definitions SHALL still pass the read-only tool policy before any network call.

#### Scenario: Tool definitions are sent
- **GIVEN** an attempt request with the `read_file` and `grep` definitions
- **WHEN** the gateway executes it against a recording client
- **THEN** the captured request lists both tools as functions with their names, descriptions and object parameter schemas

#### Scenario: Disabled tools are not sent
- **GIVEN** an attempt request with `toolsDisabled` set and tool definitions present
- **WHEN** the gateway executes it
- **THEN** the captured request contains no tool definitions

#### Scenario: Single tool call disables parallel calls
- **GIVEN** an attempt request with `maxToolCalls` 1
- **WHEN** the gateway executes it
- **THEN** the captured request sets parallel tool calls to false

### Requirement: Output-token limit reaches the provider
When an attempt request carries `maxOutputTokens`, the gateway SHALL send it on every attempt in the output-limit field configured for the provider profile. The field is `max_tokens` by default and `max_completion_tokens` when configured.

#### Scenario: Default output field
- **GIVEN** an attempt request with `maxOutputTokens` 512 and the default profile
- **WHEN** the gateway executes it
- **THEN** the captured request has `max_tokens` 512 and no `max_completion_tokens`

#### Scenario: Configured output field
- **GIVEN** a gateway configured with output field `max_completion_tokens`
- **WHEN** it executes a request with `maxOutputTokens` 512
- **THEN** the captured request has `max_completion_tokens` 512 and no `max_tokens`

### Requirement: Faithful history lowering
The gateway SHALL convert persisted history into provider messages, grouped by turn. For each turn with tool requests it SHALL emit exactly one assistant message containing:

- the model's text for that turn, or no text when there was none;
- every tool call of the turn, in call order, with its call ID, name and stored argument string.

That assistant message SHALL be followed by one tool message per result, carrying the matching call ID. Tool argument text SHALL never appear as assistant text. A tool result whose call ID has no request in the same turn SHALL fail the attempt before any network call.

#### Scenario: Parallel calls stay in one assistant message
- **GIVEN** a history in which one turn has assistant text and two tool calls `c1` and `c2`, stored as request, result, request, result
- **WHEN** the next request is lowered
- **THEN** it contains one assistant message with that text and the tool calls `c1` then `c2`, followed by the tool messages for `c1` then `c2`

#### Scenario: Orphan tool result is rejected
- **GIVEN** a history containing a tool result for call `c9` with no matching request in its turn
- **WHEN** the gateway executes the attempt
- **THEN** it returns an `invalid_request` error and the client is never called

### Requirement: Typed response mapping
The gateway SHALL map every provider response to one of these outcomes:

- a tool request;
- a final answer;
- an answer cut by the output limit;
- an error.

The mapping rules are:

- **Tool request:** a response finishing with tool calls, or with `stop` while carrying tool calls, SHALL be a tool request.
- **Cut answer:** a response finishing with `length` SHALL be reported as `length` and SHALL carry no tool calls, even when partial tool calls were returned.
- **Errors:**
  - a content-filter finish SHALL be an `invalid_request` error classified `content_filter`;
  - a missing or unknown finish reason SHALL be an `invalid_request` error classified `invalid_provider_output`.

#### Scenario: Stop with tool calls is a tool request
- **GIVEN** a recorded response with finish reason `stop` and one tool call
- **WHEN** it is mapped
- **THEN** the result has finish reason `tool_calls` and that call

#### Scenario: Truncated tool call is not dispatched
- **GIVEN** a recorded response with finish reason `length` and a tool call whose arguments are cut
- **WHEN** it is mapped
- **THEN** the result has finish reason `length` and no tool calls

#### Scenario: Content filter is an error
- **GIVEN** a recorded response with finish reason `content_filter`
- **WHEN** it is mapped
- **THEN** the result has finish reason `error`, category `invalid_request` and classification `content_filter`

### Requirement: Strict tool-argument parsing
The gateway SHALL parse each tool call's arguments as one JSON object. When parsing fails or the value is not an object, the gateway SHALL return the call with empty arguments, an `argumentsError` message and the raw argument text. The raw text SHALL be sanitized with the full model-visible tier and capped at 2,000 characters. It SHALL NOT guess the arguments.

#### Scenario: Malformed arguments are flagged
- **GIVEN** a recorded tool call whose arguments are `{"path": "src/A.sol"`
- **WHEN** it is mapped
- **THEN** the call has empty arguments, a non-empty `argumentsError`, and raw text equal to the sanitized original

### Requirement: Priced and unpriced usage
Every attempt response SHALL report provider token usage and a pricing status of `priced` or `unpriced`:

- A model found in the pricing registry, or priced by explicit per-token configuration, SHALL be `priced`, with the computed cost.
- Any other model SHALL be `unpriced`.

An unpriced attempt SHALL be persisted with no cost value and SHALL never be displayed as a cost of zero. When the provider reports no usage, the token counts SHALL be zero and the attempt SHALL be `unpriced`.

#### Scenario: Unknown model is unpriced
- **GIVEN** a gateway calling a model absent from the pricing registry with no price configuration
- **WHEN** a response with 100 prompt and 20 completion tokens is mapped
- **THEN** the usage carries those token counts and pricing `unpriced`, and the stored attempt has no cost value

#### Scenario: Configured price makes a proxy model priced
- **GIVEN** a gateway configured with explicit input and output prices per million tokens
- **WHEN** a response with known usage is mapped
- **THEN** the usage is `priced` with the cost computed from those prices

### Requirement: Context-overflow classification
The gateway SHALL classify a provider error whose status is 400 or 413 and whose message matches a known context-window overflow pattern as an `invalid_request` error with classification `context_overflow`. Rate-limit and throttling messages SHALL be excluded from this classification. Errors SHALL remain sanitized and the gateway SHALL never throw.

#### Scenario: Overflow message is classified
- **GIVEN** a recorded 400 error whose message says the input exceeds the model's maximum context length
- **WHEN** the gateway executes the attempt
- **THEN** it resolves with category `invalid_request` and classification `context_overflow`

#### Scenario: Rate limit is not overflow
- **GIVEN** a recorded 429 error whose message mentions too many tokens per minute
- **WHEN** the gateway executes the attempt
- **THEN** it resolves with category `rate_limit` and no `context_overflow` classification
