## ADDED Requirements

### Requirement: Snapshot binding and resume identity
The runner SHALL refuse to start, before any provider attempt, when its tool registry is bound to a snapshot ID different from the run's snapshot ID. When resuming an existing run it SHALL verify that the stored snapshot ID and prompt equal the supplied input, and SHALL fail with `invalid_input` otherwise.

#### Scenario: Registry bound to another snapshot
- **GIVEN** a run input for snapshot `S1` and a registry bound to snapshot `S2`
- **WHEN** the run is executed
- **THEN** it ends `failed` with reason `invalid_input` and the gateway is never called

#### Scenario: Resume with a different snapshot is rejected
- **GIVEN** a stored run created for snapshot `S1`
- **WHEN** it is resumed with input snapshot `S2`
- **THEN** it ends `failed` with reason `invalid_input` and no provider attempt is made

### Requirement: Two-tier model-visible sanitizer
The runner SHALL sanitize all model-visible text in two tiers before persisting it or assembling a provider request. In both tiers, URLs such as GitHub permalinks SHALL stay intact.

- **Full tier:** applies to the prompt, every string value inside model-supplied tool arguments, tool error messages and generated initial source information. It SHALL remove Windows drive paths, UNC paths, POSIX absolute paths, credential patterns, and ground-truth or scoring markers.
- **Credential tier:** applies to content read from the snapshot (successful `read_file`, `grep`, `glob` and `list_dir` results). It SHALL remove only credential patterns and SHALL otherwise keep the content exactly as stored.

#### Scenario: Snapshot content keeps its path-like comments
- **GIVEN** a snapshot file containing the line `// see /docs/spec.md for details`
- **WHEN** the model reads it with `read_file`
- **THEN** the tool result given to the model contains that line unchanged

#### Scenario: Credential in snapshot content is redacted
- **GIVEN** a snapshot file containing an `sk-` style API key
- **WHEN** the model reads it with `read_file`
- **THEN** the result and the persisted history contain a redacted form and not the raw key

#### Scenario: Windows path in tool arguments never persists
- **GIVEN** a model tool call whose `path` argument is `D:\repo\Vault.sol`
- **WHEN** the call is dispatched and the run's events and next request are inspected
- **THEN** the string `D:\repo` appears in no event payload and no later provider request

#### Scenario: Permalink in the prompt survives
- **GIVEN** a prompt containing `https://github.com/org/repo/blob/abc/src/Vault.sol#L10`
- **WHEN** the request is assembled
- **THEN** the permalink appears unchanged in the request

### Requirement: Post-response and resumed budget enforcement
The runner SHALL enforce its limits at these points:

- **After every model response:** before tool approval or dispatch, it SHALL evaluate the wall-clock, token, cost, model-turn and tool-call limits again, and SHALL dispatch no tool when a limit is exhausted.
- **Before every provider attempt:** it SHALL stop with the total-token reason when the remaining token budget is smaller than the configured maximum output tokens.
- **On a final text answer:** a final answer that exhausted a limit SHALL complete the run, and every exhausted limit SHALL be recorded in the terminal event telemetry.
- **On resume:** it SHALL restore the run start time from the persisted `run.started` event and the completed tool-call count from history.
- **On input:** it SHALL enforce the configured maximum prompt length before any snapshot access.

#### Scenario: Remaining budget cannot cover the output reserve
- **GIVEN** a total-token budget of 10,000 with 9,500 tokens already used and a maximum of 1,024 output tokens
- **WHEN** the runner prepares the next provider attempt
- **THEN** no attempt is made and the run ends `budget_exhausted` with the total-token reason

#### Scenario: Cost ceiling crossed by a tool-calling response
- **GIVEN** a cost ceiling of 0.01 USD and a model response costing 0.02 USD that requests a tool
- **WHEN** the response is processed
- **THEN** no tool is dispatched and the run ends `budget_exhausted` with the cost reason

#### Scenario: Resumed run keeps its tool-call count
- **GIVEN** a run with a tool-call cap of 3 that completed 3 tool calls before the worker stopped
- **WHEN** a new worker resumes it and the model requests another tool
- **THEN** the tool is not dispatched and the run ends with the tool-call exhaustion reason

### Requirement: Initial source information reports unreadable files and run tool limits
The runner's initial source information SHALL list, bounded to at most 20 entries plus a total count, the snapshot files that were skipped as `too_large` or `binary`, and SHALL state that those files exist but cannot be read. It SHALL NOT list paths skipped as `denied` or `symlink`. The `run.started` event SHALL record the effective tool limits reported by the tool registry.

#### Scenario: Oversized file is announced, denied file is not
- **GIVEN** a snapshot whose manifest skipped `src/Flattened.sol` as `too_large` and `.env.local` as `denied`
- **WHEN** the first request is assembled
- **THEN** the request mentions `src/Flattened.sol` as present but unreadable and does not mention `.env.local`

#### Scenario: Tool limits are recorded per run
- **GIVEN** a registry configured with a grep timeout of 1,500 ms
- **WHEN** a run starts
- **THEN** the `run.started` event records a grep timeout of 1,500 ms

### Requirement: Crash-consistent tool and attempt persistence
For each tool call the runner SHALL persist the request item and the result item before the `tool.completed` or `tool.failed` event that references them. It SHALL write the attempt record before the corresponding `provider.attempted` event. When resumed history cannot be hydrated, the run SHALL end `failed` with `persistence_failure` without a provider attempt. Run-history reconstruction SHALL identify tool calls by step and call ID.

#### Scenario: Crash after a tool result keeps the result
- **GIVEN** a worker that stops right after a tool result is persisted
- **WHEN** a new worker resumes the run
- **THEN** the history contains the real result for that call, not an interruption error

#### Scenario: Reused call ID across steps
- **GIVEN** a provider that returns call ID `c1` in step 1 and again in step 2
- **WHEN** the execution summary is reconstructed
- **THEN** both calls and both results appear, each bound to its own step

### Requirement: Provider error classification and never-reject execution
Provider failures with category `rate_limit` or `transport` SHALL end the run with `provider_transient_primary`, and those with category `authentication` or `invalid_request` with `provider_permanent`. The run action SHALL never reject: an unexpected error from any port SHALL be converted into a terminal failure result, attempting a `failed` transition with `persistence_failure`.

#### Scenario: Rate limit is classified as transient
- **GIVEN** a gateway that returns a `rate_limit` error
- **WHEN** the run processes it
- **THEN** the run ends `failed` with terminal reason `provider_transient_primary`

#### Scenario: Store failure does not reject
- **GIVEN** a run store whose `claim` throws
- **WHEN** the run is executed
- **THEN** the returned promise resolves with a `failed` result and does not reject
