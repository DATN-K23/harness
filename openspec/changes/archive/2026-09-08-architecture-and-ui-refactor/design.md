## Context

Following the initial delivery of TV6 daemon, SDK, and UI components on `feat/frontend`, several files accumulated excessive size and mixed responsibilities: `runs.py` (362 lines, embedding schemas and mock simulation), `TraceView.tsx` (383 lines, combining live SSE subscription, demo bridge mapping, and DOM rendering), and `App.tsx` (285 lines, embedding navigation markup and demo fixtures). Furthermore, the desktop UI lacked automated test coverage. This design document establishes the architectural decoupling patterns applied across both backend and frontend layers.

## Goals / Non-Goals

**Goals:**

- Establish an automated safety net for frontend state stores and reporting utilities prior to structural edits.
- Decouple Pydantic schemas into `schemas/runs.py` and simulated agent loops into `services/simulation.py`, shrinking `routers/runs.py` to a thin HTTP controller (< 140 lines).
- Extract data acquisition and event bus bridging into `useTraceData.ts`, converting `TraceView.tsx` into a pure presentation view.
- Modularize `TopNavigation.tsx` and isolate `demo.fixture.ts` from `App.tsx`.
- Standardize design tokens and achieve WCAG 2.1 AA keyboard accessibility.
- Preserve 100% behavioral immutability across all REST endpoints, SSE streams, SDK contracts, and E2E test suites.

**Non-Goals:**

- Altering REST endpoint URLs or SSE event payload schemas.
- Modifying Ground Truth isolation or TV1 out-of-process worker handoff contracts.
- Introducing heavy UI framework dependencies.

## Decisions

### Decision 1: Pure-Function Extraction for Report Formatters

- **Decision**: Separate pure data formatting functions (`generateRunsCSV`, `generateRunsJSON`) from the browser DOM download side-effects (`downloadFile`) in `apps/desktop/ui/src/utils/export.ts`.
- **Rationale**: Eliminates runtime `ReferenceError: document is not defined` when running headless unit tests under Node.js, ensuring 100% automated testability.
- **Alternatives Considered**: Mocking global `window` and `document` in Vitest (rejected due to added harness complexity and fragility).

### Decision 2: Backend Controller-Service-Schema Decoupling

- **Decision**: Split `runtime/src/harness/entrypoints/daemon/routers/runs.py` into:
  1. `schemas/runs.py`: Pydantic request/response models with camelCase aliases.
  2. `services/simulation.py`: Background agent loop simulation with dual-write contract.
  3. `routers/runs.py`: Thin route handler and SSE generator.
- **Rationale**: Enforces Single Responsibility Principle (SRP) and enables isolated schema linting and service unit testing without mounting FastAPI applications.

### Decision 3: Presentation-Hook Separation in Frontend Trace

- **Decision**: Extract `useTraceData` hook to handle REST hydration, SSE subscription, demo replay state bridging, and cleanup.
- **Rationale**: Shrinks `TraceView.tsx` from 383 lines to ~160 lines and isolates memory leak risks (cancellation flags and EventSource closures) into a single, highly auditable hook.

### Decision 4: WCAG 2.1 AA Keyboard Navigation and Semantic Tokens

- **Decision**: Introduce `:focus-visible` focus ring token (`--focus-ring`) and semantic button utility classes (`.btn-secondary`, `.btn-indigo`, `.btn-purple`) in `index.css`, and equip `DashboardView.tsx` table rows with `tabIndex={0}`, `role="button"`, and `onKeyDown` handlers.
- **Rationale**: Guarantees full keyboard accessibility and eliminates hardcoded hex color codes across components.

## Risks / Trade-offs

- [Risk: SSE Stream Disruption During Decoupling] → **Mitigation**: Kept `event_bus` publish calls and SQLite database commit sequences identical in `simulation.py`. Validated via `test:e2e:slice1`.
- [Risk: Type drift in Demo Bridge] → **Mitigation**: Typed demo events explicitly through contracts and verified via Vitest store tests.
