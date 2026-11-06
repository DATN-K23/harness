# Judge Run Lifecycle Delta

## MODIFIED Requirements

### Requirement: Zero-token fast-reject stages
The runner SHALL preserve zero-token rejection for missing PoC and non-faithful overrides when those checks do not require a provider call. These rejections SHALL complete with the corresponding schema-valid invalid verdict and no further provider or verification call. The runner SHALL NOT repair or modify a submitter PoC. Disabled verification SHALL be skipped in read-only Judge. In an enabled internal composition, denial or failure to obtain validated execution evidence SHALL produce an unverified outcome, without treating unavailable execution as an invalid finding.

#### Scenario: Missing PoC
- **GIVEN** a candidate finding for which the ingestion port reports `missing_poc`
- **WHEN** the run executes
- **THEN** the run completes with reason `MISSING_POC`, the model gateway call count is 0, total tokens are 0, and the sanitizer and verification ports are not called

#### Scenario: Anti-cheat violation
- **GIVEN** a PoC for which the sanitizer reports `cheat_detected`
- **WHEN** the run executes
- **THEN** the run completes with reason `NON_FAITHFUL_OVERRIDE` and the verification port is not called

#### Scenario: Sandbox failure
- **GIVEN** an enabled internal composition and a verification outcome without valid evidence
- **WHEN** the runner receives the outcome
- **THEN** it completes with an unverified verdict and does not enter execution-trace reasoning

### Requirement: Reasoning loop dispatch
After preflight allows the run to continue, the runner SHALL shape the available evidence through the context engine, record the transformation, build the initial pinned context, and loop on `JudgeStep` outcomes: `completed` commits the verdict and `completed` state; `budget_exhausted` commits `budget_exhausted` with the stop reason; `failed` commits `failed`; `needs_compaction` runs compaction; `continue_turn` appends tool results to the context and increments the step. The runner SHALL record all exhausted limits it observed in telemetry and exactly one terminal reason.

#### Scenario: Multi-step run completes
- **GIVEN** a scripted model that requests two tool calls and then returns a valid verdict
- **WHEN** the run executes
- **THEN** the run is `completed`, three provider attempts are recorded, and the final verdict passes schema validation

### Requirement: Cooperative cancellation
The runner SHALL poll the cancellation port before ingestion and any enabled verification stage, before each context preparation and provider call, and before each tool dispatch. On observing a request it SHALL stop new provider and tool work, commit `cancelled` by compare-and-set, and preserve all prior events. If the run is already terminal it SHALL change nothing.

#### Scenario: Cancel before provider call
- **GIVEN** a cancellation requested while step 2 is preparing context
- **WHEN** the runner reaches the next boundary
- **THEN** no provider attempt is made for step 2, the run is `cancelled`, and earlier events remain
