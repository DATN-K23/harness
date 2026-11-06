# Spec Delta: asynchronous-run-api

## ADDED Requirements

### Requirement: Local Judge Submission Endpoint
The system SHALL expose an authenticated HTTP endpoint `POST /v1/judge/runs` that receives a candidate finding and source snapshot ID, verifies snapshot availability, checks against prohibited ground-truth or credential keys, and admits the run asynchronously.

#### Scenario: Successful run submission
- **WHEN** an authenticated client sends a valid `POST /v1/judge/runs` with an `idempotency-key` and valid finding payload
- **THEN** the system returns HTTP 202 with headers containing `Location: /v1/judge/runs/{runId}` and JSON body `{ runId, state: "accepted", statusUrl }`

#### Scenario: Prohibited ground-truth metadata rejected
- **WHEN** a client sends a submission payload containing `adjudicationReport`, `groundTruth`, or other forbidden keys
- **THEN** the request is rejected with HTTP 400 before durable admission or execution

### Requirement: Run Status and Event Inspection
The system SHALL expose `GET /v1/judge/runs/{runId}` and `GET /v1/judge/runs/{runId}/events` allowing clients to inspect execution status, terminal verdict, and retrieve chronological events via HMAC-signed pagination cursors.

#### Scenario: Polling completed run status
- **WHEN** a client requests `GET /v1/judge/runs/{runId}` for a completed run
- **THEN** the response includes the terminal state, state version, and normative verdict payload while omitting private worker claim tokens

#### Scenario: Tampered cursor detection
- **WHEN** a client requests events with an invalid or tampered cursor signature
- **THEN** the system returns HTTP 400 with an `invalid_cursor` error code
