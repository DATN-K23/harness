## Why

The `blueprint/` directory has fallen out of sync following recent architectural decisions (ADR-007 accepting Tauri 2, ADR-008 migrating to a TypeScript/Bun monorepo with Drizzle ORM, and the reorientation toward a Smart Contract Auditing & Judging Agent system). Currently, documents contain conflicting definitions (Electron vs. Tauri 2, database engine TBD vs. PostgreSQL, legacy RQ1 academic benchmark references vs. autonomous smart contract agent modes), and omit high-level representation of Audit Mode.

This change standardizes and reconciles all blueprint documents at a clean, high-level architectural abstraction without premature or overly verbose implementation details.

## What Changes

- **Harmonize Core Identity**: Eliminate outdated "RQ1 evaluation benchmark" language and "matched direct/harness arm" scheduler concepts from `module-layout.md`, `sequences.md`, and `system-overview.md`. Establish the system uniformly as a local-first AI Agent framework for Smart Contract Security operating in two primary modes: Audit Mode and Judge Mode.
- **Harmonize Technology Stack (Tauri 2 & PostgreSQL)**:
  - Reconcile `module-layout.md`, `README.md`, and ADR-008 to uniformly specify **Tauri 2** (per ADR-007) instead of Electron for the desktop wrapper.
  - Reconcile `system-overview.md` and ADR-008 to confirm **PostgreSQL** as the authoritative datastore, managed type-safely via **Drizzle ORM** in `packages/schema`.
- **Integrate Audit Mode at High Level**: Add high-level architectural representation for Audit Mode alongside Judge Mode in `system-overview.md` (components and capability mapping), `sequences.md` (high-level sequence flow), and `vocabulary.md` (`AuditRun`, `AuditReport`, finding events).
- **Streamline & De-clutter**:
  - Remove verbose and premature OS binary update coordinator flows (`Coordinated signed update`) from `sequences.md`.
  - Remove leftover merger headers (`## Source: ...`).
  - Align sequence diagram participants with the 10-package monorepo layout (`@harness/server`, `@harness/core`, `@harness/llm`, `@harness/schema`).

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `blueprint-structure`: Update blueprint structural requirements to enforce architectural consistency across runtime modes (Audit and Judge), desktop host technology (Tauri 2), and authoritative persistence (PostgreSQL via Drizzle ORM), while strictly maintaining high-level abstraction.

## Impact

- Affected documentation files:
  - `blueprint/README.md`
  - `blueprint/vocabulary.md`
  - `blueprint/architecture/module-layout.md`
  - `blueprint/architecture/sequences.md`
  - `blueprint/architecture/system-overview.md`
  - `blueprint/decisions/architecture-decisions.md`
- No runtime application code, database migrations, or dependencies are modified.
