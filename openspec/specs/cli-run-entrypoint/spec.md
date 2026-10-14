# cli-run-entrypoint Specification

## Purpose

Provides command-line interface entrypoints to execute single-prompt runs against real models and inspect historical run records and events from persistent storage.

## Requirements

### Requirement: Single-turn prompt submission command
The CLI SHALL provide a `run` command that accepts a prompt string, validates execution configuration, dispatches the prompt through the execution runner, and outputs structured execution metrics upon completion.

#### Scenario: Successful execution displays summary and output
- **WHEN** a user executes `bun run cli:run -- --prompt "Explain reentrancy in Solidity"` with valid configuration
- **THEN** the CLI outputs the unique `runId`, terminal state `completed`, model response text, total token usage, latency in milliseconds, and calculated cost in USD

#### Scenario: Execution error displays safe diagnostic message
- **WHEN** execution fails due to network transport, timeout, or invalid provider credentials
- **THEN** the CLI outputs the unique `runId`, terminal state `failed`, the error category, and a sanitized error message without leaking sensitive API keys or credentials

### Requirement: Historical run and event inspection command
The CLI SHALL provide a `view` command that accepts a `runId`, queries persistent storage, and outputs the run summary alongside the chronological stream of trajectory events.

#### Scenario: View existing run outputs record and chronological events
- **WHEN** a user executes `bun run cli:view -- --id <runId>` for a previously persisted run
- **THEN** the CLI displays the original prompt, terminal state, model output or error, and each recorded trajectory event ordered by sequence number and timestamp

#### Scenario: View unknown run outputs actionable error
- **WHEN** a user executes `bun run cli:view -- --id <runId>` with an identifier that does not exist in the database
- **THEN** the CLI exits with status 1 and reports that no run record was found for the given identifier

### Requirement: Environment setup and onboarding documentation
The repository SHALL provide documentation in `docs/environment-setup.md` guiding developers through local PostgreSQL initialization, database migration execution, `.env` file configuration, and running initial verification commands.

#### Scenario: Developer verifies onboarding steps from documentation
- **WHEN** a developer follows the instructions in `docs/environment-setup.md` on a clean checkout
- **THEN** PostgreSQL starts, database migrations execute successfully, and the CLI execution commands run without unhandled errors
