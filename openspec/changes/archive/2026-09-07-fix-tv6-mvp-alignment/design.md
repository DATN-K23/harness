## Context

See proposal.md for motivation. The TV6 MVP encompasses TypeScript contracts (`@audit-harness/contracts`), the TypeScript SDK (`@audit-harness/sdk`), Desktop Tauri/React UI, and the Python FastAPI/SQLAlchemy daemon. Reviews on PR #10 revealed contract drift, SSE naming mismatches, and broken test verification runners.

## Goals / Non-Goals

**Goals:**

- Unify SSE event schema and query parameter naming across FastAPI daemon and TypeScript SDK.
- Align `@audit-harness/contracts` directly with `judge-verdict-v1` specification.
- Ensure PostgreSQL compatibility for the `verdictvalidity` enum in Alembic migrations.
- Restore CSP in Tauri configuration while allowing local daemon communication.
- Restore green monorepo verification (`pnpm verify`) with proper test coverage.

**Non-Goals:**

- No change to OpenSpec requirement semantics (the specs are already canonical and correct).
- No production multi-tenant auth or cloud deployment changes (retains local loopback boundary).
- No architectural refactoring of the worker loop.

## Decisions

### Decision 1: Canonical SSE Event Names & Query Parameters

- **Choice**: Match SDK event listeners to the backend router's emitted events: `thought`, `tool_call`, `status_changed`, `verdict`, `completed`. Send `from_step` as the query parameter.
- **Alternative considered**: Changing backend FastAPI router to emit `step:thought`, `step:tool_call`.
- **Rationale**: The backend implementation and `openspec/specs/asynchronous-run-api/spec.md` already explicitly specify `thought`, `tool_call`, and `from_step`. Aligning the SDK to the canonical specification and backend implementation maintains spec compliance and avoids backend regression.

### Decision 2: Verdict Contract Alignment with `judge-verdict-v1`

- **Choice**: Refactor `packages/contracts/src/verdict.ts` and `enums.ts` to implement:
  - `validity: "valid" | "invalid"`
  - `verificationStatus: "unverified"`
  - `severity: "critical" | "high" | "medium" | "low" | "none"`
  - `evidence: EvidenceItem[] | null`
- **Alternative considered**: Retaining legacy `VerdictStatus` and `confidenceScore`.
- **Rationale**: The backend database dropped legacy columns in migration `06a7129eb2cb`. Retaining legacy contracts causes runtime de-serialization failure and violates `openspec/specs/structured-judge-verdict/spec.md`.

### Decision 3: PostgreSQL Enum Values in Alembic Migration

- **Choice**: In `06a7129eb2cb_update_verdict_schema_to_v1.py`, declare `sa.Enum('valid', 'invalid', name='verdictvalidity')`.
- **Rationale**: Python `VerdictValidity(StrEnum)` uses `"valid"` and `"invalid"`. Postgres enums are case-sensitive; uppercase enum values cause unhandled DB insertion exceptions.

### Decision 4: Tauri Content Security Policy (CSP)

- **Choice**: Set a restrictive CSP in `tauri.conf.json`:
  `"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:8000 http://127.0.0.1:8000;"`
- **Rationale**: Eliminates XSS and WebView injection vectors while allowing the desktop UI to connect to the local FastAPI daemon.

### Decision 5: Test Verification Pipeline

- **Choice**: Add `vitest.e2e.config.ts` matching Monorepo structure, and create a comprehensive unit test suite in `packages/sdk` verifying SSE event dispatching.
- **Rationale**: Guarantees that `pnpm verify` passes cleanly (`exit 0`) and prevents regressions in streaming communication.

## Risks / Trade-offs

- **[Risk] Frontend components dependent on old `Verdict` interface fields** → Mitigation: Inspect `apps/desktop/ui` and update verdict rendering components to consume `validity`, `severity`, and `rationale`.
- **[Risk] SQLite vs PostgreSQL enum differences** → Mitigation: By using lowercase strings consistently across Python StrEnum, SQLAlchemy Enum, and Alembic, both SQLite and PostgreSQL handle the values identically.
