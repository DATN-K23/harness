# Agent Loop Demo Evidence Delta

## MODIFIED Requirements

### Requirement: Deterministic fakes for every port
`@harness/core/testing` SHALL provide fakes for every port: scripted model gateway, threshold-driven context engine, in-memory tool registry with read-only files, regex security filter, scripted ingestion/sanitizer/verification, scripted local execution, in-memory snapshot reader, in-memory run store, fake clock, seeded random, and fake sleep. The old scripted sandbox contract SHALL be removed and all connected demo/test fixtures SHALL use the replacement operations. Scripted verification SHALL remain labeled simulated evidence and SHALL NOT count as evidence of native host execution. The in-memory run store SHALL enforce unique contiguous sequences, compare-and-set transitions, claim tokens with lease expiry, and terminal immutability with the same rules as the contract. A fake context engine SHALL be labeled as a stand-in whose token estimate is not the authoritative `o200k_base` count.

#### Scenario: Store rejects what the contract forbids
- **GIVEN** the in-memory run store
- **WHEN** a test appends a duplicate sequence, writes with a stale claim token, and transitions a terminal run
- **THEN** each of the three operations is rejected

#### Scenario: Same seed reproduces the run
- **GIVEN** the same scenario, seed and flags
- **WHEN** the run is executed twice
- **THEN** the two event streams have identical types, sequences and payload digests

#### Scenario: Offline demo needs no native executor
- **GIVEN** native toolchain artifacts are absent
- **WHEN** the offline demo and fixed-seed stress suite use scripted verification/execution
- **THEN** they remain runnable offline, report simulated evidence explicitly and do not spawn host commands
