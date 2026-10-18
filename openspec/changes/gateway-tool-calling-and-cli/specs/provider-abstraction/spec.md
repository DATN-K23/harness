## ADDED Requirements

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
