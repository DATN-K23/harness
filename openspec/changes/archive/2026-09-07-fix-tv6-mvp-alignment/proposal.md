## Why

Following the code review on Pull Request #10 (`feat/frontend` -> `main`), independent auditing confirmed several critical runtime blockers, contract deviations, security risks, and broken verification gates. The codebase deviated from canonical `openspec/specs/` in its SSE event naming, TypeScript contracts for verdicts, and database enum definitions. Resolving these defects brings the TV6 MVP into 100% compliance with existing OpenSpec specifications and restores automated verification pipelines.

## What Changes

- **Fix SSE Protocol & Query Parameters**: Align SDK `subscribeRunStream` with FastAPI backend (`from_step` instead of `fromStep`, listen to `thought`, `tool_call`, `status_changed`, `verdict`, `completed`).
- **Synchronize TypeScript Contracts**: Update `@audit-harness/contracts` `Verdict` interface and `enums.ts` to strictly adhere to `openspec/specs/structured-judge-verdict/spec.md` (`judge-verdict-v1` schema with `validity: valid|invalid`, `verification_status: unverified`, `severity: none` for invalid).
- **Fix PostgreSQL Enum in Alembic Migration**: Match migration enum labels (`valid`, `invalid`) with SQLAlchemy `VerdictValidity` values in `runtime/alembic/versions/06a7129eb2cb_update_verdict_schema_to_v1.py`.
- **Harden Desktop UI & Tauri Security**: Re-enable Content Security Policy (CSP) in `tauri.conf.json` and add `{thought.thought || thought.content}` fallback rendering in `ThoughtCard.tsx`.
- **Harden Config Flags Loader**: Make `load_flags()` in `flags.py` defensive against non-dict YAML inputs.
- **Restore CI & Monorepo Verification**: Provide `vitest.e2e.config.ts`, expand SDK test coverage to test SSE event dispatch, format code with Prettier, and achieve green `pnpm verify`.

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- None (`skip_specs: true` set in `.openspec.yaml` as the canonical OpenSpec specifications in `openspec/specs/` are already correct; this change resolves code and contract drift against existing specs).

## Impact

- Affected Packages: `packages/contracts`, `packages/sdk`, `apps/desktop`, `runtime`.
- System Impact: Restores live streaming between Backend and Desktop UI, ensures database migration compatibility with PostgreSQL, guarantees strict contract type-safety, and enables clean `pnpm verify` execution.
