# Spec Delta

## MODIFIED Requirements

### Requirement: Model gateway port contract
The protocol SHALL define `ModelAttemptRequest`, `ModelAttemptResponse` and `ModelGatewayPort.executeAttempt`. One call SHALL represent exactly one provider attempt. A provider failure SHALL be returned in the response `error` field with `isRetryable` and a `category`; the port SHALL NOT throw for provider failures. The response SHALL include `finishReason`, optional `content`, optional `toolCalls`, `usage` (prompt, completion, total tokens and `costUsd`), and `latencyMs`. `ModelAttemptRequest` SHALL additionally be able to carry the allowed tool definitions for the attempt and a per-run tool-call cap, so a caller can pass registered read-only tools without encoding them as prompt text. Carried tool definitions SHALL describe read-only operations only; the request MUST NOT carry write, delete, shell, process, package-manager, network, or arbitrary-execution tools. When no tool definitions are supplied the field SHALL be absent and the attempt SHALL behave exactly as the existing single-turn baseline.

#### Scenario: Provider error is data
- **GIVEN** a gateway implementation receiving a rate-limited response
- **WHEN** `executeAttempt` completes
- **THEN** it resolves with `finishReason: "error"` and an `error` object whose `category` is `rate_limit`

#### Scenario: Tool definitions travel as request data
- **GIVEN** a request assembled with the read-only tool definitions and a tool-call cap
- **WHEN** the request is passed to a gateway implementation
- **THEN** the gateway can read the tool definitions and the cap from request fields without parsing prompt text

#### Scenario: Empty tool set preserves baseline behavior
- **GIVEN** a request with no tool definitions
- **WHEN** it is validated and executed
- **THEN** the request is accepted and the attempt behaves exactly as the single-turn baseline

#### Scenario: Non-read-only tools are refused
- **GIVEN** a request whose tool definitions include a write, shell, or network tool
- **WHEN** the request is validated
- **THEN** validation fails before any provider call

### Requirement: Stop conditions and precedence constants
The protocol SHALL define `StopReason`, `BudgetLimits` (wall clock, cost, total tokens, max steps, an OPTIONAL max tool calls with a documented default, no-progress repeats) and the ordered precedence list `wall_clock_timeout, cost_budget_exhausted, total_tokens_exhausted, max_steps_exceeded, max_tool_calls_exceeded, context_budget_exhausted, no_progress_detected`. It SHALL define the mapping of each stop reason to the blueprint terminal reason (`wall_clock`, `cost_budget`, `total_tokens`, `max_steps`, `max_tool_calls`, `context_budget`, `no_progress`). Making `maxToolCalls` optional SHALL keep every previously frozen run configuration snapshot parseable with an unchanged canonical digest.

#### Scenario: Mapping is total
- **GIVEN** the list of stop reasons
- **WHEN** each is mapped to a terminal reason
- **THEN** every stop reason maps to exactly one blueprint terminal reason and no two map to the same one

#### Scenario: Tool-call exhaustion is distinct from step exhaustion
- **GIVEN** a run that reaches its tool-call cap while its model-turn cap is not reached
- **WHEN** the stop reason is resolved
- **THEN** the reason is `max_tool_calls_exceeded` and not `max_steps_exceeded`

#### Scenario: Older snapshot without a tool-call cap stays valid and stable
- **GIVEN** a `BudgetLimits` value produced before `maxToolCalls` existed
- **WHEN** it is parsed and canonicalized
- **THEN** it is accepted with `maxToolCalls` absent and its canonical digest is unchanged
