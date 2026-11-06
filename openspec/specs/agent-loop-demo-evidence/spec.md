# agent-loop-demo-evidence Specification

## Purpose

Defines test infrastructure, deterministic fakes, automated scenario evidence, offline demo execution, and output bundle generation that prove the Agent Loop core is crash-free, recoverable, and measurable.

## Requirements

### Requirement: Deterministic fakes for every port
`@harness/core/testing` SHALL provide fakes for every port: scripted model gateway, threshold-driven context engine, in-memory tool registry with read-only files, regex security filter, scripted ingestion/sanitizer/sandbox, in-memory snapshot reader, in-memory run store, fake clock, seeded random, and fake sleep. The in-memory run store SHALL enforce unique contiguous sequences, compare-and-set transitions, claim tokens with lease expiry, and terminal immutability with the same rules as the contract. A fake context engine SHALL be labeled as a stand-in whose token estimate is not the authoritative `o200k_base` count.

#### Scenario: Store rejects what the contract forbids
- **GIVEN** the in-memory run store
- **WHEN** a test appends a duplicate sequence, writes with a stale claim token, and transitions a terminal run
- **THEN** each of the three operations is rejected

#### Scenario: Same seed reproduces the run
- **GIVEN** the same scenario, seed and flags
- **WHEN** the run is executed twice
- **THEN** the two event streams have identical types, sequences and payload digests

### Requirement: Runnable demo with the four judge scenarios
`bun run demo` in `packages/core` SHALL execute, without network access, the four scenarios of the demo specification (confirmed exploit, missing PoC, cheating PoC, failing PoC) and print a summary of terminal state, reason, steps, tokens and cost for each. Each scenario SHALL write its output bundle to a directory under the package's demo output path.

#### Scenario: Demo runs offline
- **GIVEN** a machine with no network
- **WHEN** `bun run demo` is executed in `packages/core`
- **THEN** it exits 0 and prints four scenario summaries

#### Scenario: Early rejections cost nothing
- **GIVEN** the missing-PoC, cheating-PoC and failing-PoC scenarios
- **WHEN** their summaries are read
- **THEN** each reports 0 model tokens and the correct reason code

### Requirement: Seven-pillar output bundle
For each scenario the demo SHALL write: (1) the structured verdict as JSON, (2) a rendered audit dossier (deterministic template, no extra model call), (3) the trajectory ledger with run summary and ordered events, (4) the exploit and verification proof with PoC, raw trace, state-delta table and anti-cheat report when they exist, (5) the context allocation and token-economics report per step with tokens saved, (6) the live event stream as emitted during the run, and (7) a reliability record. Sections that do not apply to a scenario SHALL be present and state why they are empty.

#### Scenario: Confirmed exploit bundle
- **GIVEN** the confirmed-exploit scenario
- **WHEN** the bundle is listed
- **THEN** all seven artifacts exist, the verdict is `valid`/`PASS` with at least one evidence item carrying a snippet and digest, and the state-delta table is non-empty

#### Scenario: Rejected scenario bundle
- **GIVEN** the missing-PoC scenario
- **WHEN** the bundle is read
- **THEN** pillar 4 states that no execution was performed and pillar 5 shows zero tokens

### Requirement: Live event stream
The runner SHALL publish each persisted event to subscribers in sequence order during the run through an in-memory event bus. A subscriber SHALL receive stage start/finish, step start, tool request/completion and verdict-committed events without waiting for run completion.

#### Scenario: Subscriber sees progress before the end
- **GIVEN** a subscriber attached before a multi-step run
- **WHEN** the run reaches its second step
- **THEN** the subscriber has already received the stage events and the first step's events in order

### Requirement: Stop-precedence evidence
The test suite SHALL cover every pair of simultaneously exhausted limits and several triples, asserting the selected reason follows the documented precedence and that all observed limits are recorded in telemetry.

#### Scenario: Pairwise matrix
- **GIVEN** every pair drawn from the six limits
- **WHEN** both are exhausted at one boundary
- **THEN** the earlier limit in the precedence order is always selected

### Requirement: Recovery evidence
The suite SHALL include scenarios for tool-not-found, malformed arguments, denied path, thrown tool failure, transient provider errors, and worker interruption. For each, the run SHALL reach a defined terminal state or continue to a verdict, and the number of unrecovered tool failures SHALL be zero.

#### Scenario: Tool failure recovery rate
- **GIVEN** a batch of runs each injecting one of the tool failure kinds
- **WHEN** they finish
- **THEN** every run records the failure as data, none ends because of the tool failure alone, and the reported recovery rate is 100%

### Requirement: One hundred crash-free runs
A stress test SHALL execute 100 runs from a fixed base seed over a mixture of scenarios (confirmed exploit, each fast-reject, multi-step with tool failures, retry then success, compaction, step-limit forcing, schema repair, cancellation, and worker interruption with takeover), including a concurrent batch. A run is crash-free if the runner resolves without rejecting, the run reaches exactly one terminal state, its event sequence is contiguous, no unhandled rejection or uncaught exception is observed, and totals equal the sum of recorded attempts. The test SHALL write a reliability report with per-scenario counts, terminal-state distribution and the seed.

#### Scenario: All runs are crash-free
- **GIVEN** the fixed base seed and the scenario mixture
- **WHEN** 100 runs are executed
- **THEN** the report shows 100 crash-free runs and zero invariant violations

#### Scenario: Violation is detected
- **GIVEN** a deliberately faulty store fake that duplicates a sequence
- **WHEN** the stress invariants are checked
- **THEN** the check reports the violation instead of passing

### Requirement: Flag enabled and disabled evidence
For each flag in the resolved flag set, the suite SHALL include a test with the flag on and a test with the flag off demonstrating the documented behavior difference, and SHALL assert that the resolved value is present in the run snapshot event and its digest.

#### Scenario: Flag value recorded
- **GIVEN** a run started with `enableSchemaRepair = false`
- **WHEN** the `run.started` event is read
- **THEN** its snapshot lists `enableSchemaRepair: false` and the snapshot digest matches the recomputed digest
