# Python Runtime

This is the Python modular monolith for the Audit Harness, replacing the NestJS API.
It includes the following entrypoints as per ADR-006:
- `daemon`: The Local API daemon for the desktop client.
- `worker`: The background worker (Judge logic).
- `evaluator`: The evaluation process.
- `scorer`: The isolated scoring process.

## Stack
- FastAPI (API)
- SQLAlchemy + Alembic (PostgreSQL Persistence)
- uv (Package Manager)
