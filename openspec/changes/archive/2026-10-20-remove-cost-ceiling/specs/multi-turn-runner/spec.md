# Spec Delta

## MODIFIED Requirements

### Requirement: Enforced limits with an explicit stop reason
Before starting any next provider attempt or tool dispatch the runner SHALL evaluate the model-turn count, the tool-call count, the wall-clock budget, and the token budgets. When one or more limits are exhausted the runner SHALL stop with the highest-precedence exhausted reason, record the exhausted limit in telemetry, and start no further provider or tool work.

#### Scenario: Tool-call cap is reached
- **GIVEN** a run whose tool-call cap is reached by the current tool requests
- **WHEN** the runner evaluates the next action
- **THEN** it dispatches no further tool calls and ends the run with the tool-call exhaustion reason

#### Scenario: Highest precedence wins
- **GIVEN** a run that has simultaneously reached its wall-clock limit and its tool-call cap
- **WHEN** the stop reason is resolved
- **THEN** the recorded reason is the higher-precedence one and every exhausted limit is recorded in telemetry

### Requirement: Post-response and resumed budget enforcement
The runner SHALL enforce its limits at these points:

- **After every model response:** before tool approval or dispatch, it SHALL evaluate the wall-clock, token, model-turn and tool-call limits again, and SHALL dispatch no tool when a limit is exhausted.
- **Before every provider attempt:** it SHALL stop with the total-token reason when the remaining token budget is smaller than the configured maximum output tokens.
- **On a final text answer:** a final answer that exhausted a limit SHALL complete the run. Every exhausted limit SHALL be returned in the run result (`observedLimits`) and SHALL be derivable from the persisted `provider.attempted` events together with the limits recorded in `run.started`.
- **On resume:** it SHALL restore the run start time from the persisted `run.started` event and the completed tool-call count from history.
- **On input:** it SHALL enforce the configured maximum prompt length before any snapshot access.

#### Scenario: Remaining budget cannot cover the output reserve
- **GIVEN** a total-token budget of 10,000 with 9,500 tokens already used and a maximum of 1,024 output tokens
- **WHEN** the runner prepares the next provider attempt
- **THEN** no attempt is made and the run ends `budget_exhausted` with the total-token reason

#### Scenario: Resumed run keeps its tool-call count
- **GIVEN** a run with a tool-call cap of 3 that completed 3 tool calls before the worker stopped
- **WHEN** a new worker resumes it and the model requests another tool
- **THEN** the tool is not dispatched and the run ends with the tool-call exhaustion reason

### Requirement: Prompt-aware pre-call guard
Before each provider attempt, the runner SHALL estimate the request's prompt tokens. It SHALL stop with the total-token reason when the remaining token budget is smaller than the estimated prompt tokens plus the maximum output tokens. Cost-ceiling checks are not part of run admission or execution; cost data MAY still be reported as actual or estimated usage when available.

#### Scenario: Large prompt cannot fit the remaining budget
- **GIVEN** a remaining token budget of 1,000, no output-token limit, and a next request whose estimated prompt is 1,500 tokens
- **WHEN** the runner prepares the attempt
- **THEN** no attempt is made and the run ends `budget_exhausted` with the total-token reason

#### Scenario: Unknown pricing does not change execution limits
- **GIVEN** a provider profile with unknown pricing and a run whose token, step, tool-call, and wall-clock limits have not been exhausted
- **WHEN** the runner prepares a provider attempt
- **THEN** it applies those non-cost limits normally and does not reject or stop the run because pricing is unknown

### Requirement: Unknown pricing does not affect execution
When the run's profile is unpriced, the runner SHALL report pricing `unpriced` in the run result's usage once any attempt is unpriced. Token, step, tool-call and wall-clock limits SHALL remain enforced, and the runner SHALL NOT reject or stop a run because pricing is unknown.

#### Scenario: Unpriced run uses non-cost limits
- **GIVEN** a gateway whose responses are all `unpriced` and a run whose token, step, tool-call and wall-clock limits are not exhausted
- **WHEN** the run executes two steps
- **THEN** it completes according to those limits and reports usage pricing as `unpriced`
