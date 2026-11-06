# Spec Delta

## MODIFIED Requirements

### Requirement: Provider profile and run-limit settings
The configuration loader SHALL accept and validate the following settings:

- `MODEL_OUTPUT_TOKENS_FIELD` (`max_tokens` or `max_completion_tokens`, default `max_tokens`);
- `MODEL_INPUT_COST_PER_MTOK` and `MODEL_OUTPUT_COST_PER_MTOK`, non-negative numbers that are only valid together;
- `HARNESS_SNAPSHOT_DIR`;
- run limits for steps, tool calls, total tokens and wall-clock timeout.

Invalid values SHALL fail fast with the setting's name. Effective output field, prices and non-cost limits SHALL be recorded in the run configuration/`run.started` event where applicable. The loader SHALL NOT accept a per-run cost-ceiling setting; model pricing remains optional usage metadata and does not affect run admission.

#### Scenario: Invalid output field fails fast
- **GIVEN** `MODEL_OUTPUT_TOKENS_FIELD=max_output`
- **WHEN** the configuration is loaded
- **THEN** loading fails with a validation error naming `MODEL_OUTPUT_TOKENS_FIELD`

#### Scenario: Half-specified price is rejected
- **GIVEN** `MODEL_INPUT_COST_PER_MTOK` set without `MODEL_OUTPUT_COST_PER_MTOK`
- **WHEN** the configuration is loaded
- **THEN** loading fails naming the missing setting

#### Scenario: Effective settings are recorded per run
- **GIVEN** `MODEL_OUTPUT_TOKENS_FIELD=max_completion_tokens` and a step limit of 5
- **WHEN** a multi-turn run starts
- **THEN** its `run.started` event records the output field `max_completion_tokens` and a step limit of 5

#### Scenario: Legacy cost-ceiling configuration is ignored
- **GIVEN** `HARNESS_MAX_COST_USD` or `--max-cost-usd` is supplied
- **WHEN** CLI arguments and environment configuration are resolved
- **THEN** the cost-ceiling setting is not applied to the run and no cost-based stop is configured
