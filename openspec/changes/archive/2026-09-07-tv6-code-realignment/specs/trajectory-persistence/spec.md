## ADDED Requirements

### Requirement: Unified relational schema for Audit entities

The persistence layer SHALL manage relational models for `Run`, `ToolCall`, `ModelEvent`, and `Verdict` using SQLAlchemy with Alembic database migrations.

#### Scenario: Querying run details with associated verdict and events

- **WHEN** client queries a specific run by ID
- **THEN** database retrieves the run object joined with its latest `Verdict` and ordered `ToolCall` steps.
