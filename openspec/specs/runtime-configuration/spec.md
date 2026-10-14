# runtime-configuration Specification

## Purpose

Defines environment configuration loading, schema validation, safe secret handling, and execution limit controls for database and model provider access.

## Requirements

### Requirement: Environment configuration template and schema validation
The repository SHALL provide a `.env.example` template declaring all environment variables required for local execution. The runtime configuration loader SHALL validate present environment variables against a defined schema at startup before any database connection or model invocation occurs.

#### Scenario: Valid environment loads successfully
- **WHEN** all required environment variables (`DATABASE_URL`, `PROVIDER_NAME`, `MODEL_NAME`, `MODEL_API_KEY`) are present and conform to type constraints
- **THEN** configuration loading succeeds, returning a strongly-typed configuration object

#### Scenario: Missing required configuration fails preflight with clear message
- **WHEN** a required environment variable (such as `DATABASE_URL` or `MODEL_API_KEY`) is missing or blank
- **THEN** the loader fails fast with an exit code of 1 and an error message naming the missing key without crashing with an unhandled exception

### Requirement: Secret isolation and redaction
Configuration values categorized as secrets (such as `MODEL_API_KEY` or credentials embedded in `DATABASE_URL`) SHALL NOT be printed in plain text to terminal logs, error traces, trajectory events, or persisted run metadata.

#### Scenario: Sensitive credentials are never echoed in logs or error envelopes
- **WHEN** an error occurs during preflight validation, network transport, or provider authentication
- **THEN** the error output redacts credential values and displays only masked tokens or key names

### Requirement: Default budget and execution limits
The configuration loader SHALL enforce default or user-configured limits for model execution timeout and maximum output tokens.

#### Scenario: Configured timeout and token limits are applied
- **WHEN** execution parameters are resolved from environment or CLI overrides
- **THEN** timeout defaults to at most 30,000 milliseconds and max output tokens defaults to at most 4,096 tokens unless explicitly configured within allowable bounds
