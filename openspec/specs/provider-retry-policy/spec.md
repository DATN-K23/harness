# provider-retry-policy Specification

## Purpose

Defines the infrastructure error classification, retry limits, exponential backoff with jitter, attempt telemetry accounting, and cooperative cancellation during retry waits.

## Requirements

### Requirement: Error classification
`RetryPolicy` SHALL classify each gateway error as `retryable`, `permanent` or `context_overflow`. Retryable errors are transport timeouts and disconnects, HTTP 429, 500 and 503 (the status list SHALL be configurable). Permanent errors are authentication failures (401), invalid requests (400) and unsupported-feature errors. Provider messages matching the context-overflow patterns SHALL be classified `context_overflow` and SHALL NOT be retried.

#### Scenario: Rate limit is retried
- **GIVEN** an attempt that fails with HTTP 429
- **WHEN** the error is classified
- **THEN** the result is `retryable`

#### Scenario: Authentication failure is permanent
- **GIVEN** an attempt that fails with HTTP 401
- **WHEN** the error is classified
- **THEN** the result is `permanent` and no retry is scheduled

#### Scenario: Context overflow is not retried
- **GIVEN** an error whose message says the prompt exceeds the context window
- **WHEN** the error is classified
- **THEN** the result is `context_overflow` and the step reports `budget_exhausted` with reason `context_budget`

### Requirement: Retry limits
The policy SHALL allow at most 5 retries for retryable errors in general and at most 3 retries (`MAX_TIMEOUT_RETRIES`) for timeout errors. When the limit is reached the last error SHALL be returned as the terminal provider failure.

#### Scenario: Timeout limit
- **GIVEN** a gateway that times out on every attempt
- **WHEN** the policy runs
- **THEN** exactly 4 attempts are made (the original and 3 retries) and the final failure is `provider_retries_exhausted`

#### Scenario: General limit
- **GIVEN** a gateway that returns HTTP 503 on every attempt
- **WHEN** the policy runs
- **THEN** exactly 6 attempts are made and the final failure is `provider_retries_exhausted`

### Requirement: Backoff with jitter
For retry number `a ≥ 1` the delay SHALL be `min(10000, 2000 × 2^(a−1)) + j` milliseconds where `j` is an integer in `[0, 1000)` drawn from the injected random source. The wait SHALL be performed through the injected sleep so tests do not wait in real time.

#### Scenario: Delay sequence
- **GIVEN** a random source that always returns 0
- **WHEN** delays for retries 1 through 5 are computed
- **THEN** they are 2000, 4000, 8000, 10000 and 10000 milliseconds

#### Scenario: Jitter bounds
- **GIVEN** a random source returning values across `[0, 1)`
- **WHEN** the delay for retry 1 is computed repeatedly
- **THEN** every value is at least 2000 and below 3000

### Requirement: Per-attempt accounting
Each attempt, including every retry, SHALL be persisted as its own `provider.attempted` event with attempt index, error category, retry decision and backoff milliseconds. Tokens and cost of every attempt that returned usage SHALL count toward run budgets. Backoff time SHALL count toward the wall-clock budget.

#### Scenario: Two failures then success
- **GIVEN** a gateway failing twice with 429 and then succeeding
- **WHEN** the step completes
- **THEN** three `provider.attempted` events exist with attempt indexes 1, 2, 3 and the first two carry non-zero backoff

#### Scenario: Backoff exhausts wall clock
- **GIVEN** a wall-clock limit shorter than the next backoff
- **WHEN** the next retry would start after the limit
- **THEN** the run ends with stop reason `wall_clock_timeout` instead of making the attempt

### Requirement: Retry can be disabled and is part of the run snapshot
With `enableInfraRetry` off, the first provider error SHALL be terminal with no retry. The retry configuration (limits, delays, retryable statuses) and the flag value SHALL be included in the run configuration snapshot and its digest.

#### Scenario: Retry off
- **GIVEN** `enableInfraRetry = false` and a gateway failing once with 503
- **WHEN** the step runs
- **THEN** exactly one attempt is made and the run fails with a provider failure reason

### Requirement: Cancellation during backoff
The policy SHALL observe the cancellation port before each retry. If cancellation has been requested the retry SHALL NOT start.

#### Scenario: Cancel while waiting
- **GIVEN** a retry scheduled after a 429 and a cancellation requested during the wait
- **WHEN** the wait ends
- **THEN** no further attempt is made and the run is committed `cancelled`
