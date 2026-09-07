## Context

See proposal.md for motivation. The blueprint defines a modular-monolith architecture (ADR-005) with an accepted technology stack (ADR-001: Python/PostgreSQL runtime, React/TypeScript/Vite renderer, Tauri 2 native host). The `physical-repository-layout.md` document specifies the exact directory tree, capability ownership, allowed import graph, table ownership, and composition-root deny matrix. ADR-007 selects Tauri 2 as the native shell and requires a ten-case readiness spike before release claims.

This design covers the structural scaffold and tooling pipelines only. All seven capability modules will contain interface stubs; none will contain business logic.

## Goals / Non-Goals

**Goals:**
- Stand up the complete directory tree from `physical-repository-layout.md` so all six tracks can begin parallel work.
- Make the import graph enforceable from day one with automated architecture tests.
- Prove the three core toolchains (Python/uv, Rust/Tauri, Node/pnpm) work together on a single developer machine and across three operating systems.
- Establish the contract generation pipeline so future capability work produces typed clients automatically.
- Provide fixture files (tool schemas, security policies, evaluation profiles) that downstream WPs can test against immediately.

**Non-Goals:**
- No business logic, state machine, or agent loop (WP-02).
- No real provider adapter or API call (WP-03).
- No database tables beyond migration infrastructure (WP-06).
- No desktop UI screens beyond the React skeleton (WP-07).
- No evaluation, scoring, or experiment execution (WP-08/09).

## Decisions

### D1: Python project managed with `uv`
**Choice**: Use `uv` for Python dependency management with `pyproject.toml` and `uv.lock`.
**Rationale**: `uv` is fast, lockfile-based, and supports the monorepo layout. ADR-001 accepts Python as the runtime language.
**Alternatives considered**: Poetry (slower resolver, heavier), pip-tools (no native lockfile), conda (overkill for non-scientific Python).

### D2: Architecture boundary tests via import analysis
**Choice**: Write Python tests under `tests/architecture/` that parse AST or use `importlib` to scan each module's imports and verify against the allowed graph in `physical-repository-layout.md`.
**Rationale**: Catching illegal imports at CI time prevents the modular-monolith from degrading into a big ball of mud. No external tool required.
**Alternatives considered**: `import-linter` (external dependency, custom config), manual code review (error-prone, doesn't scale).

### D3: Contract generation via code-generation scripts
**Choice**: Write a `scripts/generate-contracts.py` script that reads JSON Schemas from `contracts/schemas/`, generates Pydantic models via `datamodel-code-generator`, and generates TypeScript types via `json-schema-to-typescript` (or equivalent).
**Rationale**: Keeps generation reproducible and auditable. Drift detection compares generated output against committed files.
**Alternatives considered**: Manual type writing (drift risk), protobuf (overengineered for JSON-based contracts).

### D4: Tauri 2 minimal host with explicit capability restrictions
**Choice**: The `src-tauri/` scaffold contains only `main.rs` (bootstrap), `lib.rs` (command/plugin registration), `tauri.conf.json`, and `capabilities/main-window.json` with a restrictive allowlist. No business commands are registered in WP-01.
**Rationale**: ADR-007 requires proving the native host compiles and starts. Restricting capabilities from the start prevents permission creep. Commands will be added incrementally in WP-07.
**Alternatives considered**: Full Tauri scaffold with all commands (premature, violates scope audit), Electron (rejected by ADR-007).

### D5: PostgreSQL migration via Alembic
**Choice**: Use Alembic (`runtime/migrations/env.py`, `registry.py`) with a module-aware migration registry that enforces single-table-owner semantics.
**Rationale**: Alembic is the standard SQLAlchemy migration tool. The registry pattern ensures each migration is attributed to exactly one capability module.
**Alternatives considered**: Django migrations (wrong ORM), raw SQL files (no dependency tracking), Flyway (Java ecosystem).

### D6: Composition-root stubs enforce deny matrix at import time
**Choice**: Each entrypoint stub (`daemon.py`, `worker.py`, `evaluator.py`, `scorer.py`) explicitly imports only allowed capabilities and includes a test that verifies denied modules are unreachable from the entrypoint's transitive closure.
**Rationale**: The deny matrix from `physical-repository-layout.md` is a critical security boundary (e.g., scorer must not reach agent_runtime). Testing it structurally at scaffold time ensures it is never accidentally violated.
**Alternatives considered**: Runtime import hooks (fragile, performance cost), documentation only (unenforceable).

### D7: Table-owner test via migration registry metadata
**Choice**: The migration registry (`registry.py`) maps each migration to a capability owner. An architecture test scans this registry and verifies every table is owned by exactly one module. In WP-01 the test runs against the empty registry — it will become meaningful as WP-06 adds real tables.
**Rationale**: Blueprint acceptance evidence explicitly requires "table-owner tests". Building the test harness now means WP-06 contributors get immediate feedback.
**Alternatives considered**: Manual ownership comments in SQL (unenforceable), separate ownership file (drift risk).

### D8: ADR-007 readiness plan as a documentation deliverable
**Choice**: Produce `docs/adr007-readiness-plan.md` mapping all ten readiness cases (R01–R10) to their target WP, owner, and earliest timeline window. This is a planning document, not implementation.
**Rationale**: Blueprint WP-01 dependencies state "R01–R07 and R09 planned before native release work". A dedicated document ensures no case is forgotten when later WPs begin.
**Alternatives considered**: Inline in tasks.md (loses visibility), defer entirely (violates blueprint gate).

## Risks / Trade-offs

- **[Tauri three-OS builds require CI infrastructure]** → Mitigation: Accept local build logs from team members' machines as initial evidence; formalize CI later in WP-10.
- **[Interface stubs may need revision as WP-02–WP-07 discover requirements]** → Mitigation: Public interfaces are designed to be minimal (Protocol classes with abstract methods). Adding methods is backward-compatible; removing them will be caught by dependent tests.
- **[Contract generation tool choice may not cover all edge cases]** → Mitigation: Start with `datamodel-code-generator` for Python and validate against the verdict/trajectory schemas from the blueprint. If gaps appear, the generation script is isolated and replaceable.
- **[uv is relatively new]** → Mitigation: `uv` is stable for lockfile-based workflows; fallback to `pip-compile` if a blocking issue arises.
- **[ADR-007 readiness cases R02–R07 not proven in WP-01]** → Mitigation: WP-01 only needs them "planned", not "implemented". The readiness plan document tracks assignment to future WPs; actual evidence is produced in WP-07/WP-10.
- **[Ancillary directories (config/flags, datasets) initially empty]** → Mitigation: `.gitkeep` files ensure Git tracks them; downstream WPs (WP-03, WP-05, WP-08) populate them with real content.
