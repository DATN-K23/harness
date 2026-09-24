## Context

The Harness project recently evolved through several pivotal architectural transitions:
1. **ADR-007**: Selected Tauri 2 with a narrow Rust host for native OS integration and secure, capability-scoped IPC.
2. **ADR-008**: Migrated from a Python/FastAPI stack to a unified TypeScript/Bun monorepo with 10 core packages (`protocol`, `schema`, `core`, `llm`, `server`, `cli`, `client`, `ui`, `app`, `desktop`), managed by Turborepo, using Drizzle ORM for database access.
3. **Thesis Reorientation**: Reoriented Harness from a generic academic evaluation testbed (answering research question RQ1 with matched direct/harness prompt pairs) to a production-grade local-first AI Agent framework specifically tailored for Smart Contract Security analysis, featuring dual core operating modes: **Audit Mode** and **Judge Mode**.

However, the existing files in `blueprint/` were only partially updated. As a result:
- `module-layout.md` still defines Harness around measuring single-shot prompt delta (RQ1) and lists an "Electron-based" desktop wrapper.
- `system-overview.md` references Python capabilities (`*.public`), restricts `run.mode` to `fixed 'judge'`, lacks `audit` capability and data relationships, and retains academic contest partitioning.
- `sequences.md` completely omits Audit Mode, contains an overly detailed OS-level binary update protocol, retains RQ1 matched-pair calls, and refers to Python components.
- `vocabulary.md` lacks terms for Audit runs, reports, and events.
- `ADR-008` mentions "Electron (desktop)" and "Database via Drizzle ORM (engine TBD)", creating an internal contradiction with ADR-007 and PostgreSQL.

This design outlines the coordinated, high-level alignment across all blueprint files.

## Goals / Non-Goals

**Goals:**
- Reconcile core identity across all blueprint files: AI Agent framework for Smart Contract Auditing & Judging.
- Eliminate all legacy RQ1 academic benchmark references ("RQ1 profile", "matched direct and harness calls", "direct arm vs harness arm").
- Unify technology stack choices: **Tauri 2** (per ADR-007) for desktop wrapper, **PostgreSQL** as authoritative datastore via **Drizzle ORM** in `packages/schema`.
- Add high-level architectural representation for **Audit Mode** in `sequences.md`, `system-overview.md`, and `vocabulary.md`.
- Keep all documentation strictly high-level, clear, and focused on system boundaries and data flows without premature implementation details.
- Clean up merger artifacts (e.g. `## Source: ...` comments).

**Non-Goals:**
- Implementing application code, tests, or Docker configs.
- Over-specifying micro-level details of Audit Mode (e.g., specific AST parsers, detection algorithms for every vulnerability type, or prompt templates).
- Detailing PoC sandbox execution (Foundry/Hardhat test runners), which is explicitly deferred beyond MVP per Invariant #8.
- Redesigning the core agent loop or budget management algorithms.

## Decisions

### Decision 1: Confirm Tauri 2 and remove Electron references
- **Choice**: Uniformly standardize on **Tauri 2** across `README.md`, `module-layout.md`, `ADR-008`, `sequences.md`, and `system-overview.md`.
- **Rationale**: Tauri 2 aligns with ADR-007, offering memory efficiency (<30MB RAM vs 150MB+), small binary size, and superior security sandboxing via per-window capabilities. Electron was an erroneous artifact in ADR-008 and `module-layout.md`.
- **Alternatives Considered**: Electron (rejected due to excessive RAM/binary bloat and weaker default sandboxing).

### Decision 2: Confirm PostgreSQL via Drizzle ORM
- **Choice**: Affirm PostgreSQL as the single authoritative persistence engine, accessed type-safely via Drizzle ORM in `packages/schema`.
- **Rationale**: Resolves ambiguity in ADR-008 ("engine TBD") while preserving the transactional integrity, outbox pattern, and CAS state-version guarantees defined in `system-overview.md`.
- **Alternatives Considered**: SQLite/LibSQL (rejected for MVP to avoid dual-engine complexity and preserve strict transaction/CAS concurrency semantics).

### Decision 3: High-Level Audit Mode Representation
- **Choice**: Represent Audit Mode alongside Judge Mode at an architectural level without deep vulnerability-specific code details:
  - In `system-overview.md`: Add `audit` capability to the component map and capability table; update ERD to allow a `RUN` to produce multiple `FINDING` entities and an `AUDIT_REPORT`. Update `run.mode` enum to support `'audit' | 'judge'`.
  - In `sequences.md`: Add a high-level sequence diagram showing: User loads Smart Contract Repo -> Server creates Snapshot -> Core Agent loops reading code & gathering vulnerabilities -> Core compiles Findings & Audit Report -> Persists to Database and displays in UI.
  - In `vocabulary.md`: Define `AuditRun`, `AuditReport`, and finding discovery events.
- **Rationale**: Balances completeness (covering both primary product modes) with conciseness (staying at blueprint level).

### Decision 4: Prune Over-Detailed and Outdated Content in `sequences.md`
- **Choice**:
  - Remove `Coordinated signed update` sequence diagram (OS binary update verification is too low-level for an AI Agent blueprint).
  - Remove `Matched direct and harness calls` section (outdated RQ1 research paradigm).
  - Align diagram participants with the 10 monorepo packages (`API Server`, `Core Engine`, `LLM Gateway`, `Database`).
- **Rationale**: Keeps `sequences.md` tightly focused on runtime and agent execution lifecycle.

## Risks / Trade-offs

- **[Risk]** Updating ERD and capability maps in `system-overview.md` could become too extensive.
  - **Mitigation**: Keep ERD additions minimal: link `RUN` to `FINDING` (1-to-many for Audit) and add an optional `AUDIT_REPORT` entity, keeping existing tables intact.
- **[Risk]** Audit Mode sequence could be interpreted as a rigid algorithmic recipe.
  - **Mitigation**: Explicitly frame the sequence as high-level orchestration across package boundaries, leaving specific prompt and tool strategies to implementation specs.
