# Spec Delta: cli-run-entrypoint

## MODIFIED Requirements

### Requirement: Single-turn prompt submission command
The CLI SHALL provide a `run` command that accepts a prompt string, validates execution configuration, dispatches the prompt through the execution runner, and outputs structured execution metrics upon completion. When `DATABASE_URL` is configured in the environment, the CLI MUST initialize and persist the execution using `PostgresRunStore` and cleanly close database connection pools upon completion. If required configuration is missing or invalid, the CLI MUST fail fast with informative validation diagnostics and non-zero exit code rather than silently falling back to mock fakes.

#### Scenario: Successful execution displays summary and output
- **WHEN** a user executes `bun run cli:run -- --prompt "Explain reentrancy in Solidity"` with valid configuration
- **THEN** the CLI outputs the unique `runId`, terminal state `completed`, model response text, total token usage, latency in milliseconds, and calculated cost in USD

#### Scenario: Execution error displays safe diagnostic message
- **WHEN** execution fails due to network transport, timeout, or invalid provider credentials
- **THEN** the CLI outputs the unique `runId`, terminal state `failed`, the error category, and a sanitized error message without leaking sensitive API keys or credentials

#### Scenario: Successful execution with persistent database storage
- **GIVEN** a valid `.env` with reachable `DATABASE_URL` and provider credentials
- **WHEN** a user executes `bun run cli:run -- --prompt "Explain reentrancy in Solidity"`
- **THEN** the CLI creates the run record and trajectory events in PostgreSQL, outputs the `runId`, terminal state `completed`, model response text, total token usage, latency in milliseconds, and calculated cost in USD, and closes the connection pool without hanging

#### Scenario: Missing configuration halts with explicit validation error
- **GIVEN** execution without valid environment configuration and without an explicit mock flag
- **WHEN** the user invokes `bun run cli:run -- --prompt "Test prompt"`
- **THEN** the CLI exits with status 1 and outputs a list of missing configuration variables instead of silently executing a simulated mock response

### Requirement: Historical run and event inspection command
The CLI SHALL provide a `view` command that accepts a `runId`, queries persistent storage (connecting to `PostgresRunStore` when `DATABASE_URL` is configured), and outputs the run summary alongside the chronological stream of trajectory events. The command MUST retrieve runs executed in previous CLI process instances across process restarts.

#### Scenario: View existing run outputs record and chronological events
- **WHEN** a user executes `bun run cli:view -- --id <runId>` for a previously persisted run
- **THEN** the CLI displays the original prompt, terminal state, model output or error, and each recorded trajectory event ordered by sequence number and timestamp

#### Scenario: View unknown run outputs actionable error
- **WHEN** a user executes `bun run cli:view -- --id <runId>` with an identifier that does not exist in the database
- **THEN** the CLI exits with status 1 and reports that no run record was found for the given identifier

#### Scenario: View existing run across process restart
- **GIVEN** a run ID from a previously completed run executed in a separate process instance and persisted to PostgreSQL
- **WHEN** a user executes `bun run cli:view -- --id <runId>`
- **THEN** the CLI connects to PostgreSQL, displays the original prompt, terminal state, model response or error, token usage, cost, and latency, followed by all recorded trajectory events in chronological sequence order
