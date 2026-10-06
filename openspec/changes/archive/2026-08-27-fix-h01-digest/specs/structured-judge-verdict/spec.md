## MODIFIED Requirements

### Requirement: Source-grounded evidence contract

The blueprint SHALL require at least one evidence item with an authorized relative path and a valid one-based inclusive line span. The system's Orchestrator MUST independently compute the content digest for the referenced source span against the immutable source snapshot. The schema SHALL NOT require the agent to generate the content digest. The blueprint SHALL define rejection of missing, prohibited, or unresolved evidence paths/ranges.

#### Scenario: Evidence cannot be resolved

- **GIVEN** a proposed verdict whose evidence points outside the source root or to an invalid line range
- **WHEN** evidence validation rules are applied
- **THEN** the blueprint prevents completed status and records a schema/evidence validation outcome suitable for bounded repair

#### Scenario: Orchestrator computes content digest

- **GIVEN** a proposed verdict with a valid path and line span
- **WHEN** evidence resolution occurs
- **THEN** the Orchestrator successfully reads the source snapshot, computes the exact SHA-256 content digest, and attaches it to the final verdict without requiring the agent to hallucinate hashes
