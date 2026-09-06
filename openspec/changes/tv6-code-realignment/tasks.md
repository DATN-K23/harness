## 1. Specification Realignment & Validation

- [x] 1.1 Scaffold OpenSpec proposal and delta specs for TV6 capabilities on `feat/frontend` <!-- evidence: openspec validate passed 8/8 -->
- [x] 1.2 Verify 1-to-1 schema alignment between TypeScript Contracts (`@harness/contracts`) and FastAPI Pydantic Schemas <!-- evidence: vitest passed 2/2 -->

## 2. API & SSE Resilience Improvements

- [ ] 2.1 Implement SSE Reconnection & `from_step` offset filtering in `GET /api/v1/runs/{run_id}/stream` endpoint <!-- verification: verify stream filtering logic -->
- [ ] 2.2 Add `reconnecting` status handling and automatic retry in Zustand store `run.store.ts` <!-- verification: pnpm run typecheck -->

## 3. Worker Handoff Preparation

- [ ] 3.1 Document Handoff interface from `mock_agent_loop` to TV1 out-of-process Worker queue <!-- verification: review POST /judge endpoint boundary -->
