# ADR-005: Capability-first modular monolith with shallow hexagonal modules

- Status: `Accepted`
- Version: `adr-005-v1`
- Decision date: 2026-08-14
- Owner: TV1
- Collaborators: TV2, TV3, TV4, TV5, TV6
- Governing requirements: ORCH-05–ORCH-08, DATA-01, EVAL-11, API-08
- Accepted by: project owner/team lead after source-layout review
- Affected work packages: WP-01–WP-10

## Context

The runtime must remain one maintainable product without collapsing business ownership into global `domain/`, `application/`, and `adapters/` folders. The source tree must support six parallel tracks, prevent provider/filesystem/database types from leaking across boundaries, and isolate scoring without creating independently released microservices.

## Decision

Organize the Python runtime by capability first:

1. `run_control`
2. `model_gateway`
3. `source_access`
4. `agent_runtime`
5. `judge`
6. `evaluation`
7. `scoring`

Inside a capability, use only the shallow hexagonal roles that contain real artifacts: `public`, `domain`, `application`, `ports`, `adapters`, and `resources`. Do not create empty folders to imitate a template.

The daemon, worker, evaluator and scorer are separate composition roots over the same runtime source, lockfile and compatibility version. Process separation enforces lifecycle and credentials; it does not create independent services, repositories or release cadences.

## Dependency law

- Capability-to-capability imports target only `harness.modules.<depended_on>.public`.
- Internal `domain`, `application`, `ports`, `adapters`, resources and persistence metadata are never imported by another capability.
- A process entrypoint is the only wiring exception: it may import declared factories/adapters for its own composition graph, but contains no business policy and is never imported by capabilities.
- Every database table and migration contribution has one capability owner. Other capabilities use public commands/queries/events; they do not query foreign tables.
- `shared_kernel` contains only stable identifiers, time, money, `Result` and base errors.
- `platform` contains configuration, database engine, observability, secret-store and process mechanics only. It owns no business repository or query.
- Public contracts expose project-owned types, never FastAPI, SQLAlchemy, provider-SDK or desktop-shell types.

## Allowed capability graph

| Importer | Allowed capability imports |
|---|---|
| `run_control` | none |
| `model_gateway` | none |
| `source_access` | none |
| `agent_runtime` | `run_control.public`, `model_gateway.public`, `source_access.public` |
| `judge` | `run_control.public`, `agent_runtime.public`, `source_access.public` |
| `evaluation` | `run_control.public`, `judge.public`, `model_gateway.public`, `source_access.public` |
| `scoring` | `evaluation.public` only |

The graph is acyclic. A direct `judge -> model_gateway`, `evaluation -> scoring`, or any undeclared edge requires a blueprint/ADR revision.

## Options considered

| Option | Disposition | Reason |
|---|---|---|
| Repository-wide layer-first tree | Rejected | Technical folders become coupling hubs and obscure capability/table ownership. |
| Capability-first with full clean-architecture ceremony in every module | Rejected | Empty layers increase navigation and false abstraction without stronger boundaries. |
| Capability-first with shallow hexagonal roles | **Accepted** | Keeps business ownership local while preserving ports/adapters where they matter. |
| Independently deployed service per capability | Rejected for MVP | Adds distributed versioning/failure modes without scale or ownership evidence. |

## Scoring exception and isolation

`scoring` remains in the runtime repository but only the scorer composition root may wire it, its ground-truth adapter, scorer-only generated schemas and credentials. Daemon, worker, evaluator and desktop dependency closures deny the entire module. The scorer sends approved non-ground-truth output through `evaluation.public`; evaluation never imports scoring.

## Future extension seams

Audit mode and `VerificationRunner` become new capability modules/entrypoints with declared public contracts. They do not add mode conditionals, shell/network authority or PoC execution to Judge modules. Long-term memory and compaction require separate accepted changes and result-affecting flags.

## Enforcement plan

WP-01 creates architecture tests for allowed/forbidden imports, cycles, framework types in `public`, table/migration ownership, platform/shared-kernel purity, composition-root business logic and scorer dependency closures. `architecture/physical-repository-layout.md` is the normative source placement contract.

## Supersession

Changing the system-level organizing axis, adding a global business adapter/repository layer, or splitting a capability into an independently released service requires a superseding ADR with dependency/migration impact and TV1–TV6 approval.
