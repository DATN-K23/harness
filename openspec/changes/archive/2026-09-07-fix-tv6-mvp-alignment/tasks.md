## 1. Contract & Database Schema Alignment

- [x] 1.1 Update `packages/contracts/src/enums.ts` and `verdict.ts` to implement `judge-verdict-v1` schema and verify contract build passes <!-- owner: TV6, evidence: pnpm --filter @audit-harness/contracts build passes -->
- [x] 1.2 Update Alembic migration `06a7129eb2cb_update_verdict_schema_to_v1.py` to use lowercase `'valid', 'invalid'` for `verdictvalidity` enum <!-- owner: TV6, evidence: migration file matches SQLAlchemy VerdictValidity StrEnum -->

## 2. Client SDK & SSE Protocol Alignment

- [x] 2.1 Update `packages/sdk/src/client.ts` to send query param `from_step` and dispatch canonical SSE events `thought`, `tool_call`, `status_changed`, `verdict`, `completed` <!-- owner: TV6, evidence: pnpm --filter @audit-harness/sdk build passes -->
- [x] 2.2 Add unit test suite in `packages/sdk/src/__tests__/client.spec.ts` verifying `subscribeRunStream` dispatches all 5 event types and handles reconnection cursor <!-- owner: TV6, evidence: pnpm test passes all unit tests -->

## 3. Desktop UI & Configuration Hardening

- [x] 3.1 Restore Content Security Policy (CSP) in `apps/desktop/src-tauri/tauri.conf.json` with safe directives <!-- owner: TV6, evidence: tauri.conf.json contains explicit CSP protecting WebView -->
- [x] 3.2 Add fallback rendering `{thought.thought || thought.content}` in `apps/desktop/ui/src/components/trace/ThoughtCard.tsx` <!-- owner: TV6, evidence: ThoughtCard renders either field without blank cards -->
- [x] 3.3 Harden `load_flags()` in `runtime/src/harness/modules/config/flags.py` to validate dict type and safely handle non-dict YAML <!-- owner: TV6, evidence: flags loading verified against edge cases -->

## 4. Monorepo Verification & E2E Pipeline

- [x] 4.1 Create `vitest.e2e.config.ts` and provide an e2e test suite for Slice 1 <!-- owner: TV6, evidence: pnpm test:e2e:slice1 passes -->
- [x] 4.2 Run Prettier across the monorepo to fix code style issues <!-- owner: TV6, evidence: pnpm run format:check passes with exit code 0 -->
- [x] 4.3 Run full Monorepo verification and OpenSpec validation <!-- owner: TV6, evidence: pnpm verify and openspec validate --all pass exit 0 -->
