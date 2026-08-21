# ADR-001: Technology stack for the future Judge MVP

- Status: `Accepted`
- Version: `adr-001-v2`
- Decision date: 2026-08-14
- Owner: TV1/TV6
- Collaborators: TV2, TV3, TV4, TV5
- Governing requirements: API-01–API-10, ORCH-01–ORCH-08, DATA-01–DATA-06, UI-01–UI-06
- Accepted by: project owner/team lead after confirming the six-person team can work in Python and TypeScript
- Approval scope: runtime/renderer stack family; Tauri native-host selection is governed by accepted ADR-007
- Affected work packages: WP-01–WP-10

## Context

The product is a downloadable desktop client over a local, multi-process modular-monolith runtime. Judge runs outlive desktop connections, PostgreSQL is the durable work authority, canonical serialized contracts are framework-neutral, and provider/scorer boundaries must be independently testable. The team explicitly confirmed proficiency in Python, TypeScript and the considered technologies. That evidence resolves the former blocking proficiency condition.

Acceptance evidence is the approved OpenSpec design `sha256:5aea91ad544a46cc6462fc0ea67760c6d6876849c542adb6fb6a584c7e5bad2b` and proposal `sha256:4ba190a8e8639b633aa2c9f10353cd8137a60ad5977da9782791de7d29262e8f`, together with the user's 2026-08-14 confirmation. These digests identify the reviewed planning version; later blueprint digest updates do not reopen the stack family.

## Decision criteria

| Criterion | Decision consequence |
|---|---|
| Team proficiency | Python and TypeScript are both acceptable implementation languages. |
| Contract fidelity | OpenAPI 3.1 and JSON Schema 2020-12 remain canonical; generated types conform to them. |
| Async/recovery maturity | HTTP lifecycle is separate from PostgreSQL-backed work claims and worker execution. |
| Relational consistency | PostgreSQL supports transactions, outbox/jobs, CAS transitions and scorer role/schema isolation. |
| Provider ecosystem | Official asynchronous Python SDKs stay behind `model_gateway` adapters. |
| Desktop delivery | React/TypeScript/Vite provides the renderer; ADR-007 selects Tauri 2 with a narrow Rust host. |
| Reproducibility | `uv`, `pnpm`, committed lockfiles and Docker Compose define the packaging family. |
| Operational simplicity | No Redis, Kubernetes, external LLM gateway or independently deployed microservices in MVP. |

## Options considered

| Option | Disposition | Rationale |
|---|---|---|
| Python runtime + PostgreSQL work table + React/TypeScript desktop renderer | **Accepted** | Best fit for provider/data tooling, typed async boundaries, one durable datastore and team proficiency. |
| TypeScript/NestJS runtime + Redis/BullMQ + React | Rejected for MVP | Adds Redis and a second execution authority without evidence that it improves the research harness. |
| Python runtime + dedicated Redis/Celery-style queue | Rejected for MVP | Adds infrastructure and retry ambiguity around paid attempts; PostgreSQL claims are sufficient for MVP. |
| OpenCode's Bun/Effect/Solid stack | Rejected | The stack and compatibility surface are not required by Judge methodology; see ADR-004. |

## Accepted stack family

- Python 3.12 for local daemon, Judge worker, evaluator and scorer.
- FastAPI and Pydantic v2 at local HTTP and validation boundaries.
- SQLAlchemy 2.x and Alembic over PostgreSQL for relational state, outbox/jobs, claims and scorer isolation.
- React and TypeScript on Node.js LTS with Vite for the desktop renderer.
- Tauri 2 with a narrow Rust native host as selected by ADR-007; exact compatible Rust/Tauri/plugin versions are readiness/lockfile decisions.
- `uv` and `pnpm` with committed lockfiles.
- Docker Compose for reproducible local-runtime development/delivery; PostgreSQL remains a separate durable process.

Exact compatible dependency versions are pinned by the first implementation change. Patch/minor selection inside this family is a readiness decision, not permission to switch frameworks, languages, database, queue authority or product topology silently.

## Boundaries with other ADRs

- ADR-005 fixes capability-first physical source ownership.
- ADR-006 fixes downloadable desktop plus independent local runtime.
- ADR-007 is `Accepted` at architecture-choice scope for Tauri 2, least-authority native commands, independent runtime supervision, protected credential custody and coordinated signed updates; three-OS readiness remains future evidence.
- ADR-002 fixes direct official-SDK provider integration; an accepted provider profile is still required before network use.
- ADR-003 fixes evaluation methodology; an accepted experiment profile is still required before result-bearing execution.

## Consequences

- Framework/SDK types never become canonical cross-module contracts.
- PostgreSQL job claims require explicit lease/version/CAS and ambiguous-paid-attempt handling.
- The generated TypeScript client is the desktop's only Judge-data boundary.
- Desktop-shell source, installer, signing and updater work belongs to a separate implementation change and cannot claim readiness until the ADR-007 WP-01/WP-10 spike passes.
- A minimal packaging/transaction/provider-contract/client-generation/handshake slice remains WP-01 readiness evidence. Failure triggers a documented correction or superseding ADR, not an informal stack replacement.

## Supersession rule

Changing the language family, API framework, relational authority, renderer family or packaging topology requires a superseding ADR with incompatibility evidence, migration impact, TV1/TV6 review and project-owner approval. Ordinary lockfile updates do not supersede this ADR.
