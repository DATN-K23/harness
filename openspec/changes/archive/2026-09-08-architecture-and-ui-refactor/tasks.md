## 1. Safety Net Testing (TV6 - Gate C07)

- [x] 1.1 Author unit test suite for `useRunStore` verifying state initialization, deduplication, and reset <!-- evidence: vitest passed 5/5 in apps/desktop/ui/src/stores/__tests__/run.store.spec.ts -->
- [x] 1.2 Decouple pure report formatters (`generateRunsCSV`, `generateRunsJSON`) from DOM download side-effects <!-- evidence: export.ts updated -->
- [x] 1.3 Author unit test suite for export utilities under headless Node.js environment <!-- evidence: vitest passed 5/5 in apps/desktop/ui/src/utils/__tests__/export.spec.ts -->

## 2. Backend Daemon Decoupling (TV6 - Gate C07)

- [x] 2.1 Extract all Pydantic request/response schemas to `runtime/src/harness/entrypoints/daemon/schemas/runs.py` <!-- evidence: schemas/runs.py created, py_compile exit 0 -->
- [x] 2.2 Extract `mock_agent_loop` simulation logic to `runtime/src/harness/services/simulation.py` with dual-write contract preserved <!-- evidence: services/simulation.py created, py_compile exit 0 -->
- [x] 2.3 Refactor `routers/runs.py` into a thin HTTP controller (< 140 lines) <!-- evidence: routers/runs.py down to 133 lines, app.routes count=7 -->

## 3. Frontend View Modularization (TV6 - Gate C07)

- [x] 3.1 Extract static fixture data from `App.tsx` into `apps/desktop/ui/src/fixtures/demo.fixture.ts` <!-- evidence: demo.fixture.ts created -->
- [x] 3.2 Extract navigation header into `apps/desktop/ui/src/components/layout/TopNavigation.tsx` <!-- evidence: TopNavigation.tsx created with semantic tags -->
- [x] 3.3 Create custom hook `useTraceData.ts` encapsulating REST hydration and SSE subscription lifecycle <!-- evidence: useTraceData.ts created, clean unmount -->
- [x] 3.4 Refactor `TraceView.tsx` into a pure presentation component using `useTraceData` <!-- evidence: TraceView.tsx down from 383 to 163 lines -->
- [x] 3.5 Refactor `App.tsx` using `TopNavigation` and `demo.fixture.ts` <!-- evidence: App.tsx down from 285 to 135 lines -->

## 4. Design Tokens & Accessibility WCAG 2.1 AA (TV6 - Gate C07)

- [x] 4.1 Introduce `--focus-ring`, `--gradient-brand`, and button utility tokens into `apps/desktop/ui/src/index.css` <!-- evidence: index.css updated with :focus-visible rules -->
- [x] 4.2 Modernize `DashboardView.tsx` with semantic button classes and accessible table headers (`scope="col"`) and keyboard row navigation (`tabIndex={0}`, `role="button"`) <!-- evidence: DashboardView.tsx updated -->

## 5. Verification & OpenSpec Validation (TV6 - Gate C07)

- [x] 5.1 Run full format, lint, typecheck, and dependency-cruiser gates <!-- evidence: pnpm run check passed with 0 errors and 0 warnings -->
- [x] 5.2 Execute Vitest unit and E2E test suites <!-- evidence: vitest 14/14 passed, e2e slice1 passed -->
- [x] 5.3 Validate OpenSpec change proposal strictly <!-- evidence: openspec validate passed -->
