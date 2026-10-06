## ADDED Requirements

### Requirement: Daemon Router Layering and Schema Isolation

The local daemon API router SHALL delegate request/response validation to dedicated Pydantic schema modules (`harness.entrypoints.daemon.schemas.runs`) and background simulation execution to dedicated service modules (`harness.services.simulation`), maintaining complete behavioral compatibility across all endpoints (`/api/v1/runs`, `/api/v1/runs/judge`, `/api/v1/runs/{id}/stream`).

#### Scenario: Clean controller routing and contract preservation

- **GIVEN** a running local daemon API server
- **WHEN** client dispatches POST to `/api/v1/runs/judge` or GET to `/api/v1/runs/{id}/stream`
- **THEN** the request validation SHALL occur via decoupled schemas in `schemas/runs.py`
- **AND** the background audit execution SHALL be executed via `mock_agent_loop` in `services/simulation.py` with dual-write to SQLite and EventBus preserved.
