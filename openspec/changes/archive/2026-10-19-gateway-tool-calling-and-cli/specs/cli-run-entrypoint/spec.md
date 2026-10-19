## ADDED Requirements

### Requirement: Repository registration and snapshot listing
The CLI SHALL provide `repo add <path>`. This command SHALL ingest the repository into the snapshot storage directory through the snapshot manager, with optional repeated `--include-root` values and an optional `--snapshot-id`. It SHALL print the snapshot ID, the file count and the number of skipped paths per reason.

The CLI SHALL also provide `snapshot list`, which SHALL print, for every stored snapshot, its ID, file count, tree digest and ingestion policy version.

Neither command SHALL write anything inside the source repository.

#### Scenario: Register a repository
- **GIVEN** a temporary repository containing `src/Vault.sol` and `.env`
- **WHEN** the user runs `repo add <path>`
- **THEN** the CLI exits 0 and prints a snapshot ID, 1 file, and 1 skipped path with reason `denied`, and the source repository is unchanged

#### Scenario: List snapshots
- **GIVEN** a storage directory holding one registered snapshot
- **WHEN** the user runs `snapshot list`
- **THEN** the CLI prints that snapshot's ID, file count and tree digest

### Requirement: Multi-turn run against a snapshot
The CLI SHALL provide `run --snapshot <id> --prompt <text>`. It SHALL execute the multi-turn runner with a tool registry bound to that snapshot, the real gateway and the configured store. It SHALL accept per-run overrides for steps, tool calls, output tokens, total tokens, cost and timeout.

It SHALL print:

- the run ID;
- the terminal state and reason;
- token usage;
- the cost, or "unknown" when unpriced;
- the output.

An unknown snapshot ID SHALL fail with exit code 1 before any model call. `run` without `--snapshot` SHALL remain the single-turn direct-model run.

#### Scenario: Model reads a file and answers
- **GIVEN** a registered snapshot and a recorded provider that first requests `read_file` on `src/Vault.sol` and then answers
- **WHEN** the user runs `run --snapshot <id> --prompt "Summarise Vault"`
- **THEN** the CLI exits 0 and prints state `completed`, one tool call, the answer and the token usage

#### Scenario: Unknown snapshot is refused
- **WHEN** the user runs `run --snapshot snap_missing --prompt "x"`
- **THEN** the CLI exits 1 with a snapshot-not-found message and the provider is never called

#### Scenario: Unpriced cost is printed as unknown
- **GIVEN** a recorded provider for a model absent from the pricing registry
- **WHEN** a multi-turn run completes
- **THEN** the CLI prints the cost as "unknown" together with a warning, and never prints a cost of 0

### Requirement: Multi-turn run inspection
For a multi-turn run, `view --id <runId>` SHALL show:

- the snapshot ID;
- the effective and observed limits;
- for every model step: the model, finish reason, tokens, cost or "unknown", and latency;
- for every tool call: name, arguments, status, duration, truncation flag and a bounded preview of its result or error;
- the terminal state and reason.

`--json` SHALL print the same data as JSON. The command SHALL produce the same output from a new process reading the persistent store.

#### Scenario: View a multi-turn run from a new process
- **GIVEN** a multi-turn run with one tool call, persisted by an earlier process
- **WHEN** a new process runs `view --id <runId>`
- **THEN** it prints the snapshot ID, two model steps with their usage, the tool call with its result preview, and the terminal reason

### Requirement: No silent mock in real runs
A command run without `--mock` SHALL NOT use a scripted gateway or an in-memory store. When the provider or store configuration is missing, it SHALL exit 1 and name the missing settings. With `--mock`, the CLI SHALL use the in-memory store and a scripted gateway that performs one `read_file` call and then answers.

#### Scenario: Missing key does not fall back to a mock
- **GIVEN** no `MODEL_API_KEY` and no `--mock`
- **WHEN** the user runs `run --snapshot <id> --prompt "x"`
- **THEN** the CLI exits 1 naming `MODEL_API_KEY`, and no run is created

### Requirement: Track D runbook and offline integration cases
The repository SHALL document the full flow in `docs/environment-setup.md`, together with an updated `.env.example`. The flow is: configuration, migration, `repo add`, `snapshot list`, `run --snapshot` and `view`.

Offline integration cases on recorded provider responses SHALL cover:

- a tool call followed by an answer;
- an invalid configuration;
- authentication, rate-limit and server errors;
- a timeout.

#### Scenario: Integration cases run without network
- **WHEN** the CLI and gateway test suites run with no network access
- **THEN** each listed case passes using recorded responses only
