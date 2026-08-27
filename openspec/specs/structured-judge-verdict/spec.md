# structured-judge-verdict Specification

## Purpose

Defines the versioned verdict-and-evidence blueprint that future Judge implementations must validate identically across all provider adapters.

## Requirements

### Requirement: Canonical verdict schema
The blueprint MUST provide a machine-readable schema and normative semantics for `valid` or `invalid`, normalized severity, confidence in the inclusive range zero through one, rationale, evidence, label-normalization version, and `verification_status`. Valid findings SHALL use `low|medium|high|critical`; invalid findings SHALL use `none`.

#### Scenario: Verdict examples are schema-checked
- **GIVEN** valid, invalid, confidence-edge, and severity-mismatch examples
- **WHEN** they are checked against the blueprint schema and semantic table
- **THEN** the conforming examples pass and every contradictory validity/severity combination fails with a defined reason

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

### Requirement: Explicit unverified status and future verification seam
The blueprint MUST fix every Judge MVP verdict to `verification_status: unverified` and MUST define an extension boundary for later PoC evidence without representing model reasoning as executable verification.

#### Scenario: Reasoning-only verdict is presented
- **GIVEN** a schema-valid Judge conclusion with source evidence but no executed PoC
- **WHEN** it is persisted, exported, or displayed
- **THEN** the blueprint requires a prominent `unverified` status and forbids a verified or PoC-passed claim
