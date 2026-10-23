# Spec Delta: cli-run-entrypoint

## ADDED Requirements

### Requirement: Judge Finding Execution via CLI
The CLI `run` command SHALL support executing or submitting a candidate finding markdown file against an immutable snapshot using `--finding <path> --snapshot <id>`. When run with `--mock`, it SHALL use deterministic mock doubles without contacting real providers or live databases.

#### Scenario: Running Judge via CLI
- **WHEN** user executes `bun run cli:run --finding ./finding.md --snapshot snap-123`
- **THEN** the CLI validates the finding file and snapshot existence, dispatches through the Judge pipeline, and prints the resulting verdict and run ID

#### Scenario: Missing snapshot when finding specified
- **WHEN** user executes `bun run cli:run --finding ./finding.md` without `--snapshot`
- **THEN** the CLI exits with code 1 and error `--snapshot <id> is required when --finding is provided`

### Requirement: Structured Judge Verdict View
The CLI `view` command SHALL recognize Judge runs and format the structured verdict details, including validity, verification status, severity/confidence, summary, reasoning, and cited evidence spans.

#### Scenario: Viewing completed Judge run
- **WHEN** user executes `bun run cli:view --id <judgeRunId>`
- **THEN** the output includes a dedicated `Judge Verdict` block displaying `validity`, `verificationStatus`, `confidence`, `reasonCode`, `reasoning`, and each `citesEvidence` item with file path and line span
