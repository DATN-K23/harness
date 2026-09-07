## 1. Specification Realignment & Validation

- [x] 1.1 Scaffold OpenSpec proposal and delta specs for TV6 capabilities on `feat/frontend` <!-- evidence: openspec validate passed 8/8 -->
- [x] 1.2 Verify 1-to-1 schema alignment between TypeScript Contracts (`@harness/contracts`) and FastAPI Pydantic Schemas <!-- evidence: vitest passed 2/2 -->

## 2. Delta Spec Accuracy (Backfill from Gap Analysis)

- [x] 2.1 Update `specs/asynchronous-run-api/spec.md` — Add dual-write requirement, REST endpoint table, from_step semantics <!-- evidence: spec updated -->
- [x] 2.2 Update `specs/trace-view/spec.md` — Add reconnect loop, exponential backoff, step tracking, deduplication scenarios <!-- evidence: spec updated -->
- [x] 2.3 Update `design.md` — Document conscious MVP trade-offs: SQLite, no-auth loopback, SSE-first delivery

## 3. Backend Bug Fixes (Dual-write Contract)

- [x] 3.1 Persist `thought` events to `model_events` table before EventBus publish in `mock_agent_loop`
- [x] 3.2 Persist `tool_call` events to `tool_calls` table before EventBus publish in `mock_agent_loop`
- [x] 3.3 Persist `verdict` to `verdicts` table before EventBus publish in `mock_agent_loop`
- [x] 3.4 Fix evidence field names — use snake_case (`start_line`/`end_line`) consistently in `mock_agent_loop` dict, matching `EvidenceSchema`
- [x] 3.5 Add Pydantic validator to enforce `severity="none"` for `validity="invalid"` verdicts

## 4. Frontend SSE Reconnection (Task 2.2 original)

- [x] 4.1 Add exponential backoff auto-retry in `useAuditHarnessClient.tsx` — close failed EventSource, wait, reconnect with `from_step = lastKnownStepIndex + 1`
- [x] 4.2 Track `lastKnownStepIndex` in `subscribeRunStream` — update on each `thought`/`tool_call` event received
- [x] 4.3 Wire reconnect retry count limit (max 10) → set `sseStatus = "offline"` when exhausted

## 5. Worker Handoff Documentation (Task 3.1 original)

- [x] 5.1 Document handoff boundary from `mock_agent_loop` to TV1 Worker in `design.md`

## 6. config/flags.yaml (Working Rule R1)

- [x] 6.1 Create `config/flags.yaml` with TV6-owned flags: `enable_sse_stream`, `enable_thought_persistence`, `enable_verdict_validation`
- [x] 6.2 Add `HARNESS_FLAGS_PATH` env var support in daemon startup, load flags at boot

## 7. Offline Demo Completeness

- [x] 7.1 Verify `demo-fixtures/run-01.json` — confirm verdict payload uses correct schema fields (`start_line`/`end_line`)
- [x] 7.2 Add `thoughts` bridge in `TraceView` demo mode — currently only renders tool_calls from replay events, not thoughts
