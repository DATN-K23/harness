# Agent Loop Protocol Contracts Delta

## MODIFIED Requirements

### Requirement: Boundary ports
The protocol SHALL define the ports through which the loop reaches other tracks: tool registry, security filter, ingestion, sanitizer, source snapshot reader, run store, clock, random source, sleep, and cancellation. Execution and verification operations SHALL be owned by core capability contracts. The protocol SHALL retain safe event and configuration data and SHALL NOT export the legacy operational sandbox contract. The source snapshot port SHALL expose read-only operations. The run store port SHALL require a claim token and expected state version on every mutation. No port SHALL expose ground-truth labels, adjudication reports or scoring metadata to agent-visible paths.

#### Scenario: Run store mutation requires a claim
- **GIVEN** the run store port type
- **WHEN** an append-event call is written without a claim token
- **THEN** the call does not typecheck

#### Scenario: Snapshot port is read-only
- **GIVEN** the source snapshot port type
- **WHEN** its members are enumerated
- **THEN** none of them writes, deletes, renames or executes
