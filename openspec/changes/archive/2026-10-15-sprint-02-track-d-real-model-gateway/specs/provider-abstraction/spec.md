# Spec Delta

## ADDED Requirements

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
