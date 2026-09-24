## 1. Foundational Documents & ADR Reconciliation

- [x] 1.1 Update `blueprint/README.md` to specify Tauri 2 for `desktop/` and reinforce dual operational modes (Audit and Judge).
- [x] 1.2 Update `blueprint/architecture/module-layout.md` to replace the legacy single-shot prompt evaluation definition with the Smart Contract Security Agent definition, and replace Electron with Tauri 2.
- [x] 1.3 Update `blueprint/decisions/architecture-decisions.md` (ADR-008) to set Renderer to `React/Vite (web) + Tauri 2 (desktop) per ADR-007` and Database to `PostgreSQL via Drizzle ORM`.
- [x] 1.4 Update `blueprint/vocabulary.md` to add `AuditRun`, `AuditReport`, finding discovery event types, and update package import conventions to `@harness/*`.

## 2. High-Level Sequence & Lifecycle Alignment

- [x] 2.1 Remove legacy RQ1 evaluation references (`Matched direct and harness calls`, `primary RQ1 profile`) from `blueprint/architecture/sequences.md`.
- [x] 2.2 Prune over-detailed OS binary update coordination (`Coordinated signed update`) from `blueprint/architecture/sequences.md` to preserve clean high-level focus.
- [x] 2.3 Add a high-level sequence diagram for Audit Mode in `blueprint/architecture/sequences.md` covering repo ingestion, snapshot creation, agent reasoning loop, and audit report generation.
- [x] 2.4 Align sequence diagram participants in `blueprint/architecture/sequences.md` with the 10 monorepo packages (`API Server`, `Core Engine`, `LLM Gateway`, `Database`).
- [x] 2.5 Clean up merger header comments (`## Source: ...`) in `blueprint/architecture/sequences.md`.

## 3. Architecture & Persistence Model Reconciliation

- [x] 3.1 Update `blueprint/architecture/system-overview.md` component map and capability table to include high-level `audit` capability alongside `judge`.
- [x] 3.2 Update ERD in `blueprint/architecture/system-overview.md` to support 1-to-many findings and `AUDIT_REPORT` from an Audit Run, and update `run.mode` to support `'audit' | 'judge'`.
- [x] 3.3 Reconcile database authority section in `blueprint/architecture/system-overview.md` with Drizzle ORM and PostgreSQL.
- [x] 3.4 Clean up academic contest-splitting artifacts and merger headers in `blueprint/architecture/system-overview.md`.

## 4. Verification & Consistency Audit

- [x] 4.1 Verify cross-file consistency across all 6 blueprint documents (Tauri 2, PostgreSQL, dual modes, no RQ1 leftovers).
- [x] 4.2 Verify document count and formatting adhere to `blueprint-structure` specification (<= 10 normative files, flat structure, high-level presentation).
