## ADDED Requirements

### Requirement: Assistant text of tool turns is persisted
When a model response requests tools and also carries text, the runner SHALL persist that text, sanitized with the full tier, as an `assistant_reasoning` context item for the turn. It SHALL do so before the turn's tool request items, so that the persisted trajectory and the next request contain what the model said.

#### Scenario: Text next to a tool call is replayed
- **GIVEN** a scripted response with text "I will read the vault" and one `read_file` call
- **WHEN** the next attempt request is assembled
- **THEN** it contains an `assistant_reasoning` item with that text in the same turn, placed before the turn's tool request item

### Requirement: Tool calls with invalid arguments are reported to the model
When a model tool call carries an `argumentsError`, the runner SHALL NOT dispatch it. It SHALL:

- persist the tool request item with the sanitized raw argument text;
- persist an error tool result stating that the arguments were not valid JSON;
- record `tool.failed` with failure kind `invalid_arguments`.

The call SHALL count toward the tool-call limit. The run SHALL then continue to the next model turn, subject to its limits.

#### Scenario: Model gets a chance to repair its call
- **GIVEN** a scripted gateway whose first response has a tool call with an `argumentsError` and whose second response is a final answer
- **WHEN** the run executes
- **THEN** no tool is executed, `tool.failed` records `invalid_arguments`, the second request contains the error result for that call ID, and the run completes

#### Scenario: Invalid calls are bounded
- **GIVEN** a tool-call limit of 2 and a gateway that always returns a call with an `argumentsError`
- **WHEN** the run executes
- **THEN** it ends `budget_exhausted` with reason `max_tool_calls` and no tool is executed

### Requirement: Final answers cut by the output limit
A response with finish reason `length` SHALL NOT be treated as a tool request. When it is the final response, the run SHALL complete, and both the run result and the `run.completed` payload SHALL record `outputTruncated: true`.

#### Scenario: Truncated final answer is marked
- **GIVEN** a scripted gateway returning text with finish reason `length`
- **WHEN** the run executes
- **THEN** it ends `completed` with `outputTruncated: true` and no tool is dispatched

### Requirement: Unpriced profiles do not enforce the cost ceiling
When the run's profile is unpriced, the runner SHALL:

- record `costBudgetEnforced: false` in `run.started`;
- skip the cost pre-call guard;
- report pricing `unpriced` in the run result's usage once any attempt is unpriced.

Token, step, tool-call and wall-clock limits SHALL remain enforced.

#### Scenario: Unpriced run records the disabled cost check
- **GIVEN** a gateway whose responses are all `unpriced` and a cost ceiling of 0.01 USD
- **WHEN** the run executes two steps
- **THEN** `run.started` has `costBudgetEnforced: false`, the run is not stopped for cost, and the result usage is `unpriced`
