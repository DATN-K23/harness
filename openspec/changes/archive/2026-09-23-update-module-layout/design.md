## Context

See `proposal.md` for the full motivation. This change comprehensively updates the entire blueprint directory to:
1. Add a high-level System Overview for readers (human + AI)
2. Align all documentation with the TypeScript/Bun monorepo architecture
3. Remove all team ownership metadata (TV1–TV6) from every file
4. Supersede affected ADRs to match the new architectural direction

## Goals / Non-Goals

**Goals:**
- Add a System Overview paragraph to README.md and module-layout.md that explains what Harness is, its purpose, and core research question (RQ1) at a glance.
- Remove every `Owner: TVx`, `collaborators: TVx`, and ownership table across all blueprint files.
- Add ADR-008 (Technology Stack Migration) superseding ADR-001 and ADR-004.
- Update ADR-005 from "capability-first Python modular monolith" to "package-based TypeScript monorepo".
- Update vocabulary.md to reflect the new stack terminology.
- Clean up system-overview.md ownership references while preserving domain-relevant diagrams and invariants.

**Non-Goals:**
- We are NOT scaffolding actual packages or writing code — this is documentation only.
- We are NOT rewriting system-overview.md from scratch — we trim ownership and update tech references.
- We ARE deleting the `evaluation/` directory entirely, as the enterprise-grade evaluation methodology is deemed too heavy and out-of-scope for the current thesis requirements.

## Decisions

**Decision 1: System Overview Section**
- **Rationale:** A reader (or AI agent) arriving at the blueprint has no quick way to understand what Harness does. Adding a concise overview at the top of README.md solves this. The overview describes: what Harness is, what RQ1 is, and what the system does NOT do (it is not a general coding assistant).

**Decision 2: Full Ownership Removal**
- **Rationale:** The user explicitly stated "Blueprint không cần phải chia task mà phải là tài liệu overview nhất về hệ thống." Ownership references (TV1–TV6) exist in README.md, system-overview.md, vocabulary.md, and every ADR header. All must be removed for the blueprint to serve as a clean architectural reference.
- **Scope:** Every file in `blueprint/` directory.

**Decision 3: ADR-008 — Technology Stack Migration**
- **Rationale:** ADR-001 accepted Python/FastAPI/PostgreSQL and explicitly rejected opencode's Bun/Effect stack. ADR-004 designated opencode as "reference-only, not implementation base." The user's decision to adopt opencode's module structure as the actual architecture directly contradicts both. Per user instruction: "cứ lấy quyết định mới nhất" — we supersede with ADR-008.
- **ADR-008 accepts:** TypeScript/Bun runtime, Drizzle ORM for database, Turborepo for monorepo management, 10-package structure following opencode's architecture.
- **ADR-008 supersedes:** ADR-001 (Python stack) and ADR-004 (opencode as reference-only).

**Decision 4: ADR-005 Update**
- **Rationale:** ADR-005 defined a "capability-first modular monolith" with Python-specific conventions (`harness.modules.<capability>.public`). The new architecture uses a package-based monorepo. We update ADR-005 to describe package boundaries instead of Python module boundaries, keeping the same dependency principles.

**Decision 5: Preserve Domain Knowledge**
- **Rationale:** system-overview.md contains valuable domain-specific content (context diagrams, boundary invariants, ERD, trust boundaries) that is valid regardless of tech stack. We preserve this content, only removing ownership lines and updating tech-specific references where necessary.

**Decision 6: Remove Evaluation Framework**
- **Rationale:** The evaluation methodology and experiment profiles defined in `blueprint/evaluation/` are designed for rigorous, production-grade benchmarking. For the scope of this graduation thesis, this overhead is unnecessary and distracts from core functionality.
- **Action:** Delete the entire `evaluation/` directory and remove references to it from the rest of the blueprint (e.g., `system-overview.md`).

## Risks / Trade-offs

- **Risk:** ADR-001 through ADR-007 represent significant architectural deliberation. Superseding ADR-001 and ADR-004 means the Python/FastAPI decisions are no longer authoritative.
- **Mitigation:** ADR-008 explicitly records the supersession reason, the new accepted stack, and preserves the original ADRs as historical context.

- **Risk:** system-overview.md has deep Python-specific detail (SQLAlchemy, FastAPI, Pydantic). A full rewrite would be ideal but is out of scope.
- **Mitigation:** We do a targeted cleanup (ownership removal + key tech term updates) and leave a full rewrite for a future change.
