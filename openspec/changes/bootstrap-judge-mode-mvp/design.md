## Context

The repository contains project research documents and this OpenSpec change, but no application source. See `proposal.md` for motivation and the eight delta specs for normative blueprint requirements. The team has confirmed proficiency in Python, TypeScript and the proposed supporting languages; approved the stack family described below; selected a capability-first modular-monolith runtime; selected a downloadable desktop plus local headless-runtime product topology; selected Tauri 2 as the narrow native desktop host; and approved a direct official-SDK provider strategy with OpenAI Responses API as the first real-adapter target. A comparative review used local OpenCode snapshot `14f0bf64a19493110b51f5fdeb9c1c1bba5dd3f5` as architecture evidence, not as an implementation base: its one-turn LLM and one-call tool boundaries are relevant, while its product-scale monorepo, host-authority tools, process-local session execution, compatibility layers and framework choices are not suitable Judge security or research defaults.

The immediate deliverable is not a running Judge system. It is a durable blueprint package from which TV1–TV6 can later create coordinated implementation changes without redefining trust boundaries, data semantics, experiment rules, or cross-module contracts. Applying this change therefore means authoring and validating documentation, schemas, diagrams, examples, and decision records only.

The most important design constraint is methodological: a future Judge agent may see canonical `CandidateFinding` data and an immutable `SourceSnapshot`, but never scorer-only `GroundTruthLabel`, adjudication, or scoring metadata. That boundary must be visible and testable in every relevant blueprint view.

## Goals / Non-Goals

**Goals:**

- Produce one navigable `blueprint/` package that is detailed enough to estimate, divide, and implement later.
- Define stable logical contracts before selecting framework-specific types or SDKs.
- Freeze one stable stack family, one capability-first physical repository layout, a Tauri desktop/local-runtime distribution boundary, and enforceable import and native-capability directions so six owners can implement without reorganizing the project midstream.
- Make provider attempts, tool calls, retries, continuation, persistence and terminal transitions separately observable and assign each to exactly one owning boundary.
- Describe the multi-process modular-monolith runtime, downloadable desktop client, asynchronous worker, trust boundaries, state transitions, data model, local API, trace UX, and evaluation protocol from consistent viewpoints.
- Make exact structures machine-readable where ambiguity is dangerous and explain semantics normatively in Markdown.
- Map every OpenSpec requirement and scenario to an artifact, TV owner, validation method, and future work package.
- Record unresolved choices explicitly without allowing them to disappear into assumptions.

**Non-Goals:**

- Creating application, test, migration, infrastructure, or UI source code.
- Installing runtime packages, starting services, provisioning a database/queue, calling a provider, or executing contest data.
- Proving runtime performance, security isolation, provider conformance, or scientific results; this change defines how those will later be proven.
- Reopening the accepted stack family because another agent project uses a different language or framework; a later change may only supersede it with recorded incompatibility evidence and team approval.
- Treating the desktop as a browser-hosted SaaS client, embedding Judge execution in the desktop renderer/native host, or letting Tauri window/child-process lifecycle become the authority for Judge work.
- Selecting an exact real model snapshot, credential source, pricing source or paid-run budget without an accepted provider profile and experiment evidence.
- Designing Audit-mode internals, long-term memory, compaction, or complete PoC execution.

## Decisions

### 1. Apply produces a documentation-only blueprint package

The apply phase creates artifacts under a top-level `blueprint/` directory. It may run read-only validators against those files, but it does not create executable project scaffolding.

```text
blueprint/
├── README.md
├── manifest.yaml
├── decisions/
│   ├── ADR-001-technology-stack.md
│   ├── ADR-002-provider-contract.md
│   ├── ADR-003-baseline-protocol.md
│   ├── ADR-004-opencode-reference.md
│   ├── ADR-005-capability-first-modular-monolith.md
│   ├── ADR-006-desktop-local-runtime.md
│   └── ADR-007-desktop-shell.md
├── architecture/
│   ├── system-context.md
│   ├── containers-and-trust-boundaries.md
│   ├── components-and-ownership.md
│   ├── physical-repository-layout.md
│   ├── desktop-runtime-topology.md
│   ├── agent-runtime-boundaries.md
│   ├── judge-lifecycle.md
│   └── end-to-end-sequences.md
├── contracts/
│   ├── registry.yaml
│   ├── domain-model.md
│   ├── provider-contract.md
│   ├── tool-contracts.md
│   ├── context-and-budget.md
│   ├── judge-verdict.schema.json
│   ├── trajectory-events.schema.json
│   └── async-api.openapi.yaml
├── providers/
│   ├── provider-profile.schema.json
│   ├── real-primary.profile.yaml
│   └── deterministic-profiles.md
├── persistence/
│   ├── erd.md
│   ├── field-dictionary.md
│   └── consistency-and-idempotency.md
├── security/
│   ├── data-classification.md
│   ├── workspace-policy.md
│   ├── threat-model.md
│   └── adversarial-acceptance-catalog.md
├── evaluation/
│   ├── flags-and-ablation.yaml
│   ├── baseline-protocol.md
│   ├── experiment-profile.schema.json
│   ├── rq1-confirmatory-v1.profile.yaml
│   ├── prompts/
│   │   ├── judge-core.md
│   │   ├── direct-wrapper.md
│   │   └── harness-wrapper.md
│   ├── source-bundle-v1.md
│   ├── contest-manifest.schema.json
│   ├── scoring-and-reporting.md
│   └── examples/
├── desktop/
│   ├── information-architecture.md
│   ├── local-runtime-connection.md
│   ├── submission-and-status.md
│   ├── trace-view.md
│   └── terminal-states.md
└── delivery/
    ├── requirement-traceability.md
    ├── dependency-and-ownership.md
    ├── implementation-work-packages.md
    ├── extension-roadmap.md
    └── validation-report.md
```

This directory is a planned apply output, not a new OpenSpec artifact. The update action revises only the existing planning artifacts; the later apply action creates the listed blueprint files.

### 2. Establish an explicit authority hierarchy

The package uses this precedence when artifacts disagree:

1. OpenSpec delta requirements and acceptance scenarios define required outcomes.
2. Machine-readable schemas define exact shapes and validation constraints.
3. Normative Markdown contracts define semantics not expressible in a schema.
4. Accepted ADRs define selected implementation constraints.
5. Proposed ADRs document recommendations but do not silently become approved choices.
6. Examples and wireframes illustrate behavior and cannot weaken normative rules.

Every document states whether it is normative or explanatory and links upward to its governing requirement. `blueprint/manifest.yaml` records file role, version, status, owner, and digest so stale or missing artifacts are detectable.

### 3. Keep core contracts technology-neutral while accepting one stack family

Logical ports, events, schemas, state transitions, error categories, and trust boundaries remain project-owned and free of framework or provider SDK types. `ADR-001` compares candidate language, backend, frontend, relational database, migration, packaging, and worker/queue choices against team proficiency, provider support, async maturity, schema tooling, reproducible packaging, and operational simplicity, then records the accepted family:

- Python 3.12 for the local runtime daemon, Judge worker, scorer and evaluation code;
- FastAPI and Pydantic v2 at HTTP/validation boundaries;
- SQLAlchemy 2.x and Alembic over PostgreSQL for relational state, outbox and work claims;
- React and TypeScript on a Node.js LTS runtime with Vite for the desktop renderer/UI;
- `uv`, `pnpm`, committed lockfiles and Docker Compose for reproducible local development.

Exact compatible dependency versions are pinned by the future implementation change and may advance within this family. They are not an opportunity to switch to Bun, Effect, SolidJS, NestJS, Redis or another architecture silently.

The team-proficiency condition for the stack family is satisfied by the user's explicit confirmation, so applying this revision records `ADR-001` as `Accepted`. A minimal vertical packaging/transaction/client-generation slice remains readiness evidence for WP-01, but failure of that slice triggers a documented fix or a superseding ADR rather than an informal stack replacement. `ADR-002` is accepted at provider-integration-strategy scope as defined in Decision 18, `ADR-003` at methodology scope as defined in Decision 19, `ADR-005` for physical source organization in Decision 11, `ADR-006` for product/process topology in Decision 20, and `ADR-007` for the Tauri 2 native-host choice and authority boundary in Decision 21. Accepting ADR-007 selects an architecture; it does not claim that three-OS packaging, signing, credential integration, independent runtime supervision or rollback already works. Those remain mandatory WP-01/WP-10 readiness evidence. The separately versioned `real-primary` provider profile and `rq1-confirmatory-v1` experiment profile remain `Proposed` until their changing model, credential, pricing, budget, dataset, prompt and experiment fields are frozen and approved.

### 4. Use a capability-first modular-monolith runtime with thin desktop presentation

The blueprint describes one Python runtime codebase organized first by business capability, with shallow hexagonal boundaries inside each capability. The daemon, worker, evaluator and scorer are separate processes assembled from that same codebase, dependency graph and coordinated release; they are not independently versioned microservices. Each capability owns its domain, use cases, ports, adapters and persistence. Cross-cutting `platform/` code contains only technical primitives, while `entrypoints/` contains composition roots only. A separate TypeScript/React desktop application is a thin presentation client and cannot import runtime internals, call providers, open the database, execute tools, or resolve ground truth.

```text
Desktop renderer -> generated local-runtime client -> local daemon -> PostgreSQL work authority
                                                            |
                                                            v
                                                     Judge worker
                                              model port | source-tool port
                                                         v
                                             ephemeral source-only workspace

Scorer-only ground truth -> scorer process -> approved experiment result
                         (no edge to desktop, daemon, worker, tools, provider, or trace)
```

Microservices are rejected for the MVP blueprint because no scaling evidence justifies independent deployment, versioning and distributed ownership failure modes. A synchronous request lifecycle and renderer-owned execution are rejected because Judge runs may last minutes and must survive desktop closure, disconnect and restart.

### 5. Model cross-module behavior from multiple consistent views

The architecture set contains:

- A system-context view for people, external systems, and data ownership.
- A container/trust-boundary view for desktop renderer/shell, local daemon, worker, datastore/queue, provider, source workspace, evaluator, and scorer.
- A component/ownership view mapping ports and adapters to TV1–TV6.
- A normative run state machine and transition table.
- Sequence diagrams for acceptance, queue claim, context preflight, provider/tool loop, schema repair, completion, cancellation, budget exhaustion, provider failure, tool denial, redelivery, and scoring.
- An ERD plus field dictionary that uses the same names, identifiers, and invariants as the API and event schemas.

Mermaid diagrams are preferred because diffs remain reviewable. Each diagram must be accompanied by a textual invariant table; meaning cannot depend on rendering alone.

### 6. Use open, machine-readable contract formats

- HTTP resources use OpenAPI 3.1 with reusable schemas and complete success/error examples.
- Verdict, trajectory event, and contest manifest shapes use JSON Schema 2020-12.
- Flags and the blueprint manifest use deterministic YAML with documented canonicalization and digest rules.
- Identifiers, timestamps, money, token usage, enums, nullability, pagination cursors, and version fields have one canonical representation across formats.

Schema files may describe future executable contracts but are documentation outputs, not generated runtime classes. Framework-specific code generation is deferred to the implementation change.

### 7. Treat the ground-truth boundary as a structural invariant

The security blueprint classifies control-plane, agent-visible, scorer-only, secret, model-visible, persisted, and exportable data. It traces each class through desktop repository selection, local-runtime source registration, workspace preparation, tools, context planning, provider calls, trajectory persistence, API serialization, desktop rendering, and scoring.

The workspace policy defines canonicalization before I/O, root containment, post-symlink-resolution checks, immutable digest preflight, no shell, no network, bounded results, and redaction before persistence. The adversarial catalog provides future test IDs for absolute paths, traversal encodings, symlinks, adjacent reports, aliases, snapshot tampering, prompt injection, secret fixtures, oversized results, and network attempts.

Ground-truth isolation is never represented as a feature flag. Optional result-affecting behavior is represented in the ablation catalog only when it can be safely disabled.

### 8. Freeze evaluation semantics in the blueprint

The accepted ADR-003 methodology separates durable comparison rules from a changing experiment instance. The direct and harness arms form matched `case_id + repeat_index` pairs and share canonical candidate/source identity, one accepted provider/model profile, sampling settings, total logical-token budget, terminal output reserve, Judge-core criteria, verdict schema, scorer semantics, and safety invariants. The direct arm receives deterministic `SourceBundle v1` in exactly one provider invocation; the harness arm uses the explicit agent loop and safe tools. Only the source-access and interaction wrappers may differ, and every prompt file and intentional difference is content-addressed.

Logical-token usage is the sum of all model input and output tokens across every observable provider attempt in a cell. Repeated history, tool definitions and tool results count whenever they are included in a later model request; cached input remains part of logical usage even when it receives a billing discount. Local tool execution consumes wall-clock budget but no model tokens. Native usage and billed-cost categories remain separate evidence. The primary comparison disables orchestrator/provider retries for both arms; retry-enabled behavior is a separately versioned operational ablation and cannot be used to claim the primary harness effect.

The contest manifest assigns whole contests—and declared clone, fork or common-source families—to one split, becomes immutable after freezing, and records provenance, publication time, source revision/digest, and label-normalization version. Train data may shape prompts and tools; validation data may select budget, repeat count and thresholds; frozen test data is reserved for the final result and cannot feed adaptation. Reports distinguish `pre_cutoff`, `post_cutoff`, and `unknown` contamination; retain every repeat; account for terminal failures; and report precision, recall, completion/schema-failure rate, cost, latency, agreement/dispersion, and matched arm delta.

Contest, not a finding or repeated model call, is the independent sampling unit for uncertainty. The frozen experiment profile declares the paired contest-cluster resampling method, confidence level, seed and iteration count; all repeats remain within their contest cluster and measure stochastic variability rather than inflating sample size. Precision is the primary quality outcome, but an RQ1-supporting conclusion additionally requires the predeclared recall non-inferiority and completion-rate gates. Exact minimum precision gain, maximum recall loss and minimum completion rate are chosen on validation data and frozen before test labels are scored. Otherwise the conclusion is `mixed` or `inconclusive`; cost and latency are reported as trade-offs, not substitutes for quality gates.

This blueprint preserves interfaces for later full ablation, static-analyzer/general-agent baselines, real cross-provider comparison, PoC verification, and offline replay without claiming their execution in this change.

### 9. Make traceability the completion mechanism

`delivery/requirement-traceability.md` maps each requirement and Given/When/Then scenario to:

- one or more blueprint sections or machine-readable paths;
- the accountable TV owner and collaborating tracks;
- a review, lint, schema-example, diagram, or consistency validation method;
- a future implementation work package and acceptance evidence type;
- any ADR gate that must be accepted before coding.

No requirement is considered covered by a generic reference to an entire document. The mapping must point to a heading, schema definition, table row, or example identifier.

### 10. Define blueprint completion separately from implementation completion

This change is complete when all planned files exist, internal links resolve, schemas and examples validate, vocabulary is consistent, trust-boundary and ablation audits pass, every requirement/scenario is traced, ADR status is explicit, and `openspec validate --strict` succeeds.

Completion does not assert that the target runtime exists or works. The final validation report must say `Blueprint only — no implementation evidence` and enumerate all pre-implementation ADR gates.

### 11. Freeze the physical repository layout and inward dependency direction

`ADR-005-capability-first-modular-monolith.md` records this decision as `Accepted`. The first organizing axis is business capability, not a repository-wide technical layer. Each capability then uses shallow hexagonal/layered folders where they provide a real boundary. The blueprint defines this target layout for the later implementation change:

```text
harness/
├── README.md
├── compose.yaml
├── contracts/                         # canonical serialized boundaries
│   ├── README.md
│   ├── registry.yaml
│   ├── openapi/
│   │   └── local-runtime.v1.openapi.yaml
│   ├── schemas/
│   │   ├── shared/v1/
│   │   ├── run-control/v1/
│   │   ├── model-gateway/v1/
│   │   ├── source-access/v1/
│   │   ├── agent-runtime/v1/
│   │   ├── judge/v1/
│   │   ├── evaluation/v1/
│   │   └── scorer-only/v1/
│   └── examples/
│       ├── valid/
│       └── invalid/
├── runtime/                           # one Python modular monolith
│   ├── README.md
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── src/harness/
│   │   ├── shared_kernel/             # IDs, time, money, Result, base errors only
│   │   ├── modules/
│   │   │   ├── run_control/
│   │   │   ├── model_gateway/
│   │   │   ├── source_access/
│   │   │   ├── agent_runtime/
│   │   │   ├── judge/
│   │   │   ├── evaluation/
│   │   │   └── scoring/
│   │   ├── platform/                  # technical primitives; no business policy
│   │   │   ├── configuration/
│   │   │   ├── database/
│   │   │   ├── observability/
│   │   │   ├── secrets/
│   │   │   └── process_runtime/
│   │   ├── entrypoints/               # composition roots only
│   │   │   ├── daemon/
│   │   │   ├── worker/
│   │   │   ├── evaluator/
│   │   │   └── scorer/
│   │   └── generated/
│   │       └── contracts/
│   ├── migrations/
│   │   ├── env.py
│   │   └── registry.py                # delegates to module-owned metadata
│   └── tests/
│       ├── architecture/
│       ├── modules/
│       │   ├── run_control/
│       │   ├── model_gateway/
│       │   ├── source_access/
│       │   ├── agent_runtime/
│       │   ├── judge/
│       │   ├── evaluation/
│       │   └── scoring/
│       ├── contract/
│       ├── integration/
│       ├── adversarial/
│       └── e2e/
├── apps/
│   └── desktop/                       # downloadable thin client
│       ├── README.md
│       ├── ui/
│       │   ├── package.json
│       │   ├── pnpm-lock.yaml
│       │   ├── tsconfig.json
│       │   ├── vite.config.ts
│       │   └── src/
│       │       ├── app/
│       │       ├── modules/
│       │       │   ├── runs/
│       │       │   ├── judge/
│       │       │   ├── trace/
│       │       │   ├── settings/
│       │       │   └── evaluation/
│       │       ├── shared/
│       │       │   ├── components/
│       │       │   ├── hooks/
│       │       │   ├── formatting/
│       │       │   └── errors/
│       │       └── generated/
│       │           └── runtime-client/
│       ├── src-tauri/                 # Tauri 2 narrow Rust native host
│       │   ├── Cargo.toml
│       │   ├── Cargo.lock
│       │   ├── build.rs
│       │   ├── tauri.conf.json
│       │   ├── capabilities/          # explicit per-window allowlists
│       │   ├── permissions/           # project command permissions/scopes
│       │   └── src/
│       │       ├── commands/          # typed renderer-to-native bridge only
│       │       ├── runtime_supervision/
│       │       ├── credential_store/
│       │       ├── repository_picker/
│       │       ├── notifications/
│       │       └── update_coordinator/
│       ├── resources/
│       │   ├── icons/
│       │   └── static/
│       └── tests/
│           ├── unit/
│           ├── contract/
│           └── e2e/
├── config/
│   ├── runtime/
│   ├── flags/
│   ├── providers/
│   └── evaluation/
├── datasets/
│   ├── README.md
│   ├── manifests/
│   └── synthetic/
├── packaging/
│   ├── local-runtime/
│   │   ├── compose.yaml
│   │   ├── env.example
│   │   └── healthcheck/
│   └── desktop/
│       ├── windows/
│       ├── macos/
│       └── linux/
├── docs/
├── blueprint/
└── openspec/
```

The tree is a normative ownership map, not a requirement to create empty folders. A future implementation creates a folder only when it contains an owned artifact. Every capability that needs all hexagonal roles follows this local template; roles that are genuinely empty are omitted:

```text
modules/<capability>/
├── public/          # only cross-module commands, queries, events and value types
├── domain/          # capability invariants and models; no frameworks
├── application/     # use cases and workflows
├── ports/           # required inbound/outbound abstractions
├── adapters/        # this capability's HTTP/DB/provider/filesystem implementations
└── resources/       # owned prompts, schemas or static policy data
```

The capability ownership is fixed as follows:

| Capability | Owns | Does not own |
|---|---|---|
| `run_control` | run lifecycle, idempotency, jobs/outbox, claims/leases, status and committed event ordering | agent decisions, provider mapping, labels |
| `model_gateway` | provider profiles, normalized model contracts, provider identity/usage/cost/error mapping, OpenAI and deterministic adapters | continuation, tools, verdict semantics |
| `source_access` | source registration, immutable snapshots, workspace assembly, safe read-only tools, path security and filesystem adapter | repository-picker UI, Judge policy, ground truth |
| `agent_runtime` | generic turn loop, committed history rebuild, context allocation, budgets, continuation and stop mechanics | `valid`/`invalid` meaning, scorer access |
| `judge` | candidate semantics, Judge prompts/policy, verdict/evidence validation and Judge workflow | generic provider SDK code, filesystem mechanics, labels |
| `evaluation` | experiment protocol/profile, direct-versus-harness scheduling, manifests, aggregation and safe export | resolving labels, provider credentials |
| `scoring` | scorer-only label normalization, post-terminal join and approved scoring outputs | agent-visible context, API presentation, provider calls |

The initial allowed capability graph is acyclic and explicit:

| Importing capability | Allowed capability imports |
|---|---|
| `run_control` | none |
| `model_gateway` | none |
| `source_access` | none |
| `agent_runtime` | `run_control.public`, `model_gateway.public`, `source_access.public` |
| `judge` | `run_control.public`, `agent_runtime.public`, `source_access.public` |
| `evaluation` | `run_control.public`, `judge.public`, `model_gateway.public`, `source_access.public` |
| `scoring` | `evaluation.public` only |

All capabilities may use the minimal `shared_kernel`; that use is not a capability edge. Any new edge, including a direct Judge-to-provider edge or evaluation-to-scoring edge, requires a blueprint/ADR revision before implementation rather than an ad hoc import.

`contracts/` is the canonical serialized boundary. `shared_kernel/` is deliberately tiny and cannot contain capability-specific models or services. `platform/` supplies database engines, configuration loading, observability, secret access and process mechanics but cannot define a business repository or query a capability table. `entrypoints/` wire processes and contain no business rules. Every module owns its persistence adapter, table metadata and migration contribution; another module cannot query those tables directly.

Capability-to-capability imports may target only `harness.modules.<capability>.public`. Importing another capability's `domain`, `application`, `ports`, `adapters` or database metadata is forbidden. Process entrypoints are the sole wiring exception: a composition root may import the declared application factories and concrete adapters that it wires for its process, but it cannot contain policy, be imported by a capability, or bypass the process-specific deny matrix. A public contract cannot expose FastAPI, SQLAlchemy, provider-SDK or native-shell types. The blueprint maps an exact allowed dependency graph and future architecture tests; cycles and undeclared public dependencies fail the gate.

Daemon and worker reuse the same capability behavior rather than duplicating business rules. Only the scorer composition root may import the `scoring` capability, its outbound ground-truth adapter, scorer-only generated schemas, credential reference or database grants. Daemon, worker, evaluator and desktop import-deny lists include the entire `scoring` module and all scorer-only artifacts. The scorer crosses back only by sending an approved non-ground-truth result into a versioned `evaluation.public` command/event contract; evaluation never imports scoring. Later Audit mode and PoC verification enter through new capability modules/ports and separate composition roots instead of mode conditionals scattered through Judge code. The desktop renderer consumes `contracts/openapi/local-runtime.v1.openapi.yaml` only through `apps/desktop/ui/src/generated/runtime-client/`; it cannot import Python, database, provider, filesystem-tool or scorer internals.

### 12. Make the agent loop explicit one provider turn at a time

The orchestrator owns the whole continuation lifecycle:

```text
reload committed run state
-> context preflight and attempt intent
-> one provider attempt
-> persist normalized response/events
-> settle each requested local tool call exactly once
-> persist tool results
-> rebuild context from committed history
-> continue, stop, or validate verdict
-> atomically commit a terminal outcome
```

A provider-adapter invocation represents exactly one observable provider attempt. The adapter does not continue the agent loop, execute tools, or hide retries; provider SDK automatic retries are disabled where possible, and otherwise every native attempt must be surfaced with identity, usage, latency, cost, and outcome. Retry policy belongs to the orchestrator and each retry is persisted as a new attempt.

The tool dispatcher validates and settles one local registry call but cannot invoke providers, persist lifecycle transitions, or decide continuation. Judge mode does not accept provider-hosted tools or hidden web-search, code-execution, shell, computer-use, or retrieval loops. Context for every next turn is rebuilt from committed history so a late provider response or a restarted process cannot silently overwrite a terminal run.

### 13. Make PostgreSQL the durable execution authority

The MVP uses PostgreSQL for run state, append-only events, idempotency records, outbox/job records, work claims, claim version/lease metadata, and compare-and-set transitions. The API commits the run plus durable handoff record before returning acceptance. A separately started worker claims work and commits observable progress; process memory may cache data but is never the source of truth.

SQLite, Redis, and a process-local queue are not MVP execution authorities. One PostgreSQL deployment may serve multiple concerns, but roles and schema access must enforce the scorer boundary. The first API contract is polling-first with finite cursor pages and partial-state semantics. SSE or another streaming transport is a later projection over committed events, not a second lifecycle authority. Redelivery, cancellation, expired claims, duplicated jobs, provider-result races, and terminal immutability are defined through transaction and compare-and-set rules.

### 14. Make excluded tool authority structurally absent

The Judge registry contains only versioned, bounded, source-snapshot operations: `read_file`, `list_dir`, `glob`, and text search. Generic shell, file mutation, host filesystem traversal, network access, provider-hosted tools, MCP/plugin tool discovery, and arbitrary code execution are absent from both the registry and worker composition root. Security does not depend on prompt instructions, UI hiding, or a human approval dialog for capabilities that should not exist.

The agent workspace contains only an immutable, digest-verified source snapshot and no ground truth. A later PoC change may define a separate `VerificationRunner` port backed by an isolated process or container, but it is not exposed as a Judge tool and cannot be smuggled into this change as shell access.

### 15. Isolate scorer and ground truth physically

Scoring runs after a Judge run is terminal through the `scorer` entrypoint/process identity and the top-level `scoring` capability. Sharing a PostgreSQL deployment is permitted, but scorer-only tables use a separate role/schema or an equivalently enforceable credential boundary. Daemon, worker and evaluator composition roots/dependency closures MUST NOT import or wire the `scoring` module and are not given scorer credentials, grants, concrete ground-truth adapters, scorer-only generated schemas or ground-truth configuration. The desktop cannot request, receive or render a ground-truth contract. Only approved non-ground-truth score output crosses into `evaluation.public`; there is no reverse import from evaluation to scoring.

The join crosses the boundary only through canonical case/run identifiers and writes approved scoring outputs; it never augments the stored model-visible request, tool workspace, trajectory payload, or verdict with labels or adjudication. Blueprint component, deployment, data-classification, ERD, API, and delivery views must all show the same physical boundary.

### 16. Use contract-first generation and drift checks

Top-level `contracts/` promotes the accepted OpenAPI and JSON Schemas from the blueprint into the canonical serialized interface during the later implementation change. Pydantic models must conform to those contracts, while the TypeScript local-runtime client is generated into `apps/desktop/ui/src/generated/runtime-client/`, committed or reproducibly generated according to ADR-001, and never edited manually. Scorer-only schemas are excluded from the daemon OpenAPI and desktop generation input by an explicit allowlist.

CI evidence planned by the blueprint includes schema fixture validation, OpenAPI validation, canonical example/digest checks, generated-client drift detection, Python contract conformance, and import-boundary checks. Generation is an implementation concern: applying this change documents sources, destinations, ownership, and validation commands but does not create runtime classes or clients.

### 17. Treat OpenCode as a reference, not a foundation

`ADR-004-opencode-reference.md` records the reviewed local snapshot and this disposition:

| Disposition | Relevant ideas |
|---|---|
| Adopt | One provider turn per invocation; one tool call per settlement; explicit schema/protocol boundaries; inward dependencies; durable, inspectable event concepts. |
| Adapt | OpenCode's session/event timeline becomes a non-streaming, PostgreSQL-backed polling trace; its tool registry becomes an immutable source-only Judge registry; its broad provider abstraction becomes the smaller project-owned contract required by TV1/TV5. |
| Reject | Forking or copying OpenCode; its Bun/Effect/Solid stack; product-scale monorepo surface; host-authority bash/write/network tools; SQLite or process-local execution authority; V1/V2 compatibility baggage; hosted provider tools and hidden provider loops. |

The ADR is `Accepted` at blueprint level and references the clean local snapshot `14f0bf64a19493110b51f5fdeb9c1c1bba5dd3f5`. It contains a provenance matrix with one row per considered pattern and these mandatory fields: snapshot-relative evidence path, observed behavior, `adopt`/`adapt`/`reject` disposition, Judge rationale, destination blueprint contract or architecture section, forbidden carry-over, and future validation evidence. A label such as "inspired by OpenCode" is insufficient without this row-level trace.

OpenCode is review input, not a build or runtime input. The blueprint and later implementation MUST NOT add the OpenCode repository as a fork, Git submodule/subtree, workspace/package dependency, generated-code source, vendored directory, or copied source set under this ADR. The blueprint acceptance evidence inventories application/package/lock/submodule files and records that none imports or embeds OpenCode source or packages. The local path used during review is not a portable project dependency.

The reviewed snapshot is immutable evidence. There is no automatic upstream synchronization and no floating branch reference. Reviewing a newer OpenCode commit creates a new ADR-004 version and a provenance delta; the current architecture remains authoritative until that review is accepted. Replacing an accepted Harness boundary requires a superseding ADR with project-specific evidence and team approval, not merely proof that upstream OpenCode changed.

The snapshot's MIT license is recorded as provenance, but this ADR authorizes no source copying. If a later change proposes copying a substantial source portion or importing an OpenCode package, that change must identify exact files/packages, preserve required notices, perform dependency/security/license review, and supersede the no-copy decision explicitly. Learning an architectural idea and implementing it independently remains the selected path.

### 18. Accept direct official-SDK provider integration and separate changing profiles

`ADR-002` becomes `Accepted` for this durable integration strategy:

- the project-owned `ModelProvider` port is the only provider contract imported by orchestration, context, evaluation, persistence, or API modules;
- the first real adapter targets OpenAI Responses API through the official asynchronous Python SDK and lives only under `runtime/src/harness/modules/model_gateway/adapters/outbound/providers/openai/`;
- the adapter performs one non-streaming, observable external attempt, with SDK automatic retry and automatic function execution disabled; the Judge orchestrator alone owns retry, continuation, budgets and terminal decisions;
- every attempt supplies the exact committed model-visible context explicitly; provider conversation/thread state, persisted reasoning, background execution, or a previous-response chain cannot be the authoritative history or a prerequisite for recovery;
- only normalized custom function definitions from the immutable local Judge registry may be advertised; OpenAI hosted tools, programmatic tool execution, MCP, Agents SDK orchestration and other provider-owned loops are excluded;
- native structured output is independently checked against the project JSON Schema, and native identity, usage, latency, error and safe request metadata are retained before normalization;
- LiteLLM or another in-process gateway, and any external LLM proxy, are rejected for the MVP because a second normalization/retry layer weakens attempt, error, usage and cost fidelity without providing needed value for a single real adapter. A later gateway may exist only behind `ModelProvider` and must pass the same conformance suite without changing the core contract.

The long-lived ADR does not freeze rapidly changing experiment data. `providers/provider-profile.schema.json` defines separately versioned profiles. `providers/real-primary.profile.yaml` records `provider_family: openai` and `transport: responses_api`, but remains `Proposed` and call-ineligible until it contains an immutable model snapshot, pinned SDK version, knowledge cutoff/source, context limit/source, capability digest, pricing version/source, credential-owner reference, paid-call ceiling and approval. A changed model, price, capability or credential owner creates a new profile version rather than rewriting ADR-002.

`deterministic-scripted` and `deterministic-faults` implement the same project port without network access and are not blocked by the real-profile gate. The direct and harness arms must select the same accepted provider profile and adapter; their intentional difference is orchestration/tool behavior, not a separate vendor integration path. Exact model selection is reconciled with contest publication dates and the baseline protocol under ADR-003 before any result-bearing run.

### 19. Accept the baseline methodology while gating each experiment instance

`ADR-003` becomes `Accepted` for the durable RQ1 methodology:

- each direct/harness observation is a matched pair over the same `case_id`, `repeat_index`, canonical candidate, source snapshot, provider/model profile, sampling settings, verdict schema and safety invariants;
- one content-addressed Judge core defines classification, severity, evidence, abstention and structured-output semantics; direct and harness wrappers differ only in deterministic `SourceBundle v1` versus safe-tool/agent-loop instructions;
- both arms receive the same total logical-token budget, counted across all model inputs and outputs including cached or repeated context, while wall-clock, native usage and billed cost are retained separately;
- provider/SDK automatic retries remain disabled under ADR-002, and the orchestrator performs no retry for either arm in the primary comparison; any retry-enabled run is a separately named ablation;
- the frozen schedule contains the same case/repeat pairs for both arms, uses a declared seed to interleave or randomize arm order, and rejects resume or reuse when any identity or digest drifts;
- train, validation and test are split by whole contest plus declared source-family groups; model-visible execution never receives `GroundTruthLabel`, and test results cannot feed prompt, tool, budget or threshold selection;
- reports retain all scheduled cells and repeats, treat contest as the uncertainty cluster, and use the experiment-profile confidence procedure rather than treating findings or repeats as independent samples;
- precision is primary, but a positive RQ1 claim additionally requires predeclared precision-gain, recall non-inferiority and completion-rate gates; failure of any gate yields `mixed` or `inconclusive`, while cost and latency remain explicit trade-offs.

The accepted ADR fixes rules, not changing experiment values. `evaluation/experiment-profile.schema.json` defines those values, and `evaluation/rq1-confirmatory-v1.profile.yaml` remains `Proposed` and result-ineligible until TV5 freezes and approves the contest/source-family manifest digest, exact accepted provider profile, prompt/schema/flag digests, logical-token and wall-clock budgets, validation-derived repeat count and conclusion thresholds, schedule/bootstrap seeds and iterations, pricing version, credential owner, paid-call ceiling, and planned execution window. A changed field creates a new profile version rather than rewriting ADR-003. Deterministic dry packets may validate contracts before this gate, but they are not scientific results.

### 20. Distribute a desktop client over an independent local runtime

`ADR-006-desktop-local-runtime.md` is `Accepted` for product topology. The MVP is delivered as a downloadable desktop client plus a local headless runtime bundle under one compatibility and release policy. It is not a hosted web product, and the React/Vite UI is a renderer inside the desktop application rather than a public browser application.

The runtime bundle owns daemon, worker, evaluator, scorer and PostgreSQL lifecycle contracts. The daemon exposes the canonical asynchronous API only through a loopback-bound endpoint or OS-equivalent local IPC. Endpoint discovery uses an installation-scoped, OS-protected rendezvous record; each request uses an installation-scoped access credential or equivalent OS access control. This is local process access control, not a claim of production multi-user authorization. Public-interface binding, remote access and multi-tenancy are outside the MVP and are disabled by default.

Before ordinary API use, the desktop and daemon perform a health and compatibility handshake containing runtime/API version, contract digest, build version and supported capability set. Major or contract-incompatible mismatches fail closed with an actionable update/restart state; they never fall through to direct database or provider access. The local API remains the only desktop-to-runtime boundary.

Closing, crashing or upgrading the desktop does not cancel or own a run. Daemon/worker processes reconstruct legal work from committed PostgreSQL state and the desktop reconstructs presentation by polling committed resources and events after reconnect. Desktop notifications and cached view state are projections only. Runtime shutdown, cancellation and update are explicit control-plane actions with safe worker-boundary semantics, not side effects of closing a window.

Repository selection is also split by custody. The native shell may return an operator-selected host path as short-lived control-plane input to source registration. `source_access` canonicalizes, validates, snapshots and digests it; subsequent run contracts use only an opaque `source_snapshot_id` and digest. The shell neither authorizes model tools nor exposes arbitrary files to the model, and raw host paths are excluded from provider payloads, trajectories, ordinary logs, run retrieval and desktop trace rendering.

PostgreSQL remains the durable authority rather than desktop storage or an embedded SQLite fallback. `packaging/local-runtime/` documents the supported local process/database bundle and health checks; `packaging/desktop/` documents platform packaging inputs. A single-file, database-free installer is not promised by this ADR. Coordinated versioning and upgrade/rollback rules must be specified before distribution evidence can pass.

### 21. Accept Tauri 2 as a least-authority native desktop host

`ADR-007-desktop-shell.md` becomes `Accepted` at architecture-choice scope. React, TypeScript, Vite and the local-runtime API remain the accepted renderer and data boundary from ADR-001/ADR-006; Tauri 2 and a narrow Rust host supply windows, runtime discovery/start-or-attach, repository picker, protected local credential mediation, notifications, signing and coordinated update integration. Exact compatible Tauri, Rust and plugin versions are pinned by the later implementation lockfiles and reproducible-build evidence rather than floating in the ADR.

The Tauri host is an OS adapter, not another business capability or an alternate Judge composition root. `apps/desktop/ui/` owns presentation and imports only the generated TypeScript runtime client. `apps/desktop/src-tauri/` owns native integration behind typed commands and explicit per-window capability/permission allowlists. No renderer window receives generic Tauri shell, filesystem, process, environment, arbitrary-URL, raw-credential or direct-updater access. Project commands are deny-by-default and limited to runtime discovery/start-or-attach/status, protected authenticated request mediation, explicit repository selection, notifications and update preparation. A new native authority requires a reviewed permission/command change and cannot be enabled by displayed model/source content, a remote URL, configuration alone or a permissive plugin default.

The Python runtime is packaged as an independently supervised or detached local process set. A bundled executable may be distribution payload, but it cannot remain an ordinary Tauri child whose handle or shutdown follows the window/native-host lifecycle. The Rust host discovers an OS-protected rendezvous record, starts or attaches through a platform lifecycle adapter, performs the version/contract/capability handshake, and then treats PostgreSQL plus runtime work records as authoritative. Closing every Tauri window or crashing/restarting the host never issues implicit run cancellation or runtime termination.

Installation credentials remain behind an OS-protected credential-store adapter and are never returned as a long-lived renderer value. Windows/macOS/Linux backends, access scope and rotation behavior must be declared; absence of an approved secure backend fails closed rather than falling back to plaintext. Tauri Stronghold or another encrypted store is not presumed equivalent to an OS credential manager and may be selected only when its threat model and custody evidence meet the same requirement. Repository paths likewise cross the host only through the explicit picker and registration flow and are discarded after the runtime returns an opaque snapshot identity.

Tauri's signed updater is only the native transport for update artifacts, not the complete product update protocol. A project-owned update coordinator verifies OS code signing plus update-artifact signature, release/channel and desktop/runtime/API/contract/database compatibility; reports active or ambiguous work; permits only `reject_if_active` or explicitly confirmed `quiesce_then_stop`; and verifies health/compatibility after installation with documented rollback. Signing private keys remain release-CI/operator secrets and are unavailable to renderer and runtime processes.

Electron is rejected as the primary host because its bundled Chromium/Node and preload/IPC surface add privilege and update maintenance that this thin local client does not need; its rendering consistency is not sufficient to outweigh that cost here. A Python-hosted shell is rejected because no candidate demonstrated an equally mature React/Vite, permission, signing and three-OS updater boundary. Either alternative requires a superseding ADR with measured incompatibility evidence; it is not an automatic fallback.

The applied ADR must preserve an official-documentation evidence table rather than reducing the choice to bundle-size claims:

| Evidence | Official source | Decision use and limit |
|---|---|---|
| Tauri capabilities and permissions | `https://v2.tauri.app/security/capabilities/`, `https://v2.tauri.app/security/permissions/` | Supports explicit window/webview command allowlists; the project must still inspect the effective merged permission graph and project-command defaults. |
| Tauri dialog | `https://v2.tauri.app/plugin/dialog/` | Supports native repository selection; it does not grant runtime/model filesystem authority. |
| Tauri updater | `https://v2.tauri.app/plugin/updater/` | Supports signed update artifacts on Windows/Linux/macOS; it does not by itself coordinate Python runtime, PostgreSQL migration, active work or rollback. |
| Tauri Stronghold | `https://v2.tauri.app/plugin/stronghold/` | Demonstrates encrypted secret storage, but is not assumed equivalent to each OS credential manager. |
| Electron security and safe storage | `https://www.electronjs.org/docs/latest/tutorial/security`, `https://www.electronjs.org/docs/latest/api/safe-storage` | Shows Electron can be hardened and use OS cryptography, but also makes preload/IPC/Node and Linux-backend fallback review project responsibilities. |
| Electron updater | `https://www.electronjs.org/docs/latest/api/auto-updater` | Documents built-in macOS/Windows updating and the absence of an equivalent built-in Linux path, increasing three-OS release variance for this project. |

Acceptance records the project owner's explicit choice, but it does not waive readiness evidence. Before native distribution is considered ready, the WP-01/WP-10 packaged spike must build on every claimed OS and demonstrate: discover/start-or-attach of a dummy runtime; compatible and incompatible handshakes; OS-protected credential use with no renderer persistence or insecure fallback; picker-to-registration custody; desktop close/reopen while committed work persists; renderer denial of undeclared native commands; signed update, active-work preflight, failure and rollback states; clean-machine reproducibility; and measured startup, memory and bundle evidence. Failure pauses distribution and requires remediation or a superseding ADR; it does not silently change the accepted stack.

## Risks / Trade-offs

- [A detailed blueprint is mistaken for working software] → Label the package and validation report as documentation-only and prohibit runtime claims in the completion rubric.
- [The same concept drifts across diagrams, schemas, API, and data dictionary] → Use canonical terminology, manifest versions, bidirectional links, and a cross-artifact consistency review.
- [OpenCode inspiration turns into an undeclared fork, dependency, or moving architecture target] → Pin a clean commit, require row-level provenance and destination mapping, prohibit copy/import/sync under ADR-004, inventory the blueprint for carry-over, and require a versioned review or superseding ADR for any later reuse.
- [The accepted stack family conceals a concrete incompatibility] → Require a minimal packaging, transaction, provider-contract, and client-generation readiness slice; replace the decision only through a superseding ADR with evidence and team approval.
- [Accepted ADRs are mistaken for authorization to spend or claim an RQ1 result] → Mark `ADR-002` and `ADR-003` accepted only at strategy/methodology scope, keep `real-primary.profile.yaml` and `rq1-confirmatory-v1.profile.yaml` visibly `Proposed`, and reject real or result-bearing calls before network activity until both profiles are complete and approved.
- [The harness appears better because it receives retries, more model-visible tokens, a richer Judge prompt, or pseudo-replication from related findings/repeats] → Disable retry symmetrically in the primary comparison, count total logical tokens, share one Judge core, pair cells, cluster uncertainty by contest, and predeclare conclusion gates before test scoring.
- [Ground truth leaks through an overlooked path] → Require a data-flow inventory and adversarial catalog covering provider, tools, persistence, logs, local API, desktop, export, and scorer.
- [Feature flags are added retroactively] → Require the flag, telemetry, snapshot, and enabled/disabled acceptance mapping in the blueprint before future implementation begins.
- [Schemas validate shape but not meaning] → Pair machine-readable schemas with normative semantic tables and cross-field examples.
- [A provider SDK hides retries, continuation, or hosted tool work] → Require one-attempt conformance cases, disable SDK retries, reject hosted tools, and surface every billable attempt as a trajectory event.
- [A direct adapter accumulates vendor semantics in the core] → Keep every SDK type and mapping inside `modules/model_gateway/adapters/outbound/providers/`, retain a field-level fidelity matrix, and require all real and deterministic adapters to pass the same project-owned contract suite.
- [Database-backed work claims create duplicate or stale execution] → Specify leases, versions, redelivery, idempotency, compare-and-set transitions, and atomic terminal commits before implementation.
- [Scorer credentials are accidentally wired into daemon, worker, evaluator or desktop] → Define separate composition roots, deployment identities, roles/schemas, generated-schema allowlists, forbidden imports, and a credential-topology review.
- [Generated Python/TypeScript representations drift from canonical contracts] → Assign one source of truth and require reproducible generation/conformance plus CI drift checks.
- [Desktop closure or upgrade silently kills or corrupts a run] → Make PostgreSQL/runtime processes authoritative, define explicit lifecycle control, version handshake and reconnect behavior, and treat desktop state as a projection.
- [A localhost endpoint is mistaken for an adequate trust boundary] → Bind only to loopback or OS IPC, require installation-scoped access control and protected endpoint discovery, and reject public-interface exposure in MVP.
- [Tauri is treated as a security boundary by name rather than configuration] → Use explicit per-window capabilities, deny generic plugins/commands, validate rendered untrusted-content attempts, and review the effective permission graph as release evidence.
- [A Tauri-managed child or updater terminates runtime work] → Use an independently supervised/detached runtime lifecycle, make close non-operative, require active-work preflight and quiesce/rollback semantics, and prove close/reopen/update recovery in the packaged spike.
- [System-webview or OS packaging variance breaks one claimed platform] → Pin Rust/Tauri/plugin toolchains, build on each target OS, record supported combinations and measured evidence, and require remediation or a superseding ADR rather than an informal Electron fallback.
- [Credential integration silently falls back to plaintext] → Require a declared OS-protected backend, fail closed when unavailable, deny renderer secret access, and exercise rotation/unavailable-store cases in readiness evidence.
- [Capability-first modules degrade into global adapters or a shared-kernel dumping ground] → Assign adapters, tables and migrations to one capability; permit cross-module imports only through `public`; and plan architecture-test deny rules.
- [Blueprint scope expands into Audit mode or PoC internals] → Keep only extension seams and list deeper behavior as separate future changes.

## Migration Plan

There is no runtime migration. Applying this documentation change proceeds in dependency order:

1. Rebaseline the manifest and vocabulary; accept `ADR-001` at stack-family scope, `ADR-002` at direct-SDK integration scope and `ADR-003` at baseline-methodology scope; add their separately gated provider/experiment profiles; and add accepted `ADR-004` with the OpenCode adoption/rejection record.
2. Add accepted `ADR-005` and the exact capability-first repository layout; reconcile module ownership, public-only cross-module imports, module-owned adapters/persistence, composition roots, platform limits and future Audit/verification seams.
3. Add accepted `ADR-006` and initially proposed `ADR-007`, then apply the approved ADR-007 revision selecting Tauri 2; reconcile the `src-tauri/` least-authority host, local endpoint access control, independent runtime supervision, discovery/compatibility handshake, protected credential mediation, UI-independent execution, reconnect/coordinated-update behavior, source registration custody and packaging boundaries.
4. Reconcile provider, tool, security, persistence, local API, scorer, desktop and evaluation contracts with the OpenAI-first direct adapter boundary, one-attempt ownership, separately versioned profiles, structural capability denial, PostgreSQL work authority, generated clients, and physical ground-truth isolation.
5. Update desktop wireframes, work packages, TV1–TV6 timeline mapping, traceability, manifest entries, and every affected example or digest.
6. Validate schemas/examples, links, vocabulary, requirement coverage, ground-truth isolation, ablation coverage, local-boundary rules, import-boundary plans, scorer-only generation exclusion and generated-contract drift plans; run strict OpenSpec validation.
7. Publish the revised documentation-only validation report and leave executable implementation to a separate change.

If the blueprint direction is rejected, the package can be revised or removed without database or runtime rollback because this change creates no executable system or external state.

## Open Questions

No open question blocks blueprint generation. The stack family, capability-first physical layout, desktop/local-runtime topology, runtime ownership, PostgreSQL execution authority, direct official-SDK provider strategy, OpenAI Responses API first-adapter target, and OpenCode disposition are accepted blueprint decisions. Exact compatible dependency versions are future lockfile/readiness choices inside those decisions, not an open architecture selection.

ADR-007 now selects Tauri 2 and has no remaining architecture-choice question. Exact compatible crate/plugin/toolchain versions, per-OS credential backend details, installer formats and release-channel configuration are future lockfile and readiness outputs inside the accepted decision; changing the host family, renderer/runtime boundary or independent-runtime invariant requires a superseding ADR. The exact OpenAI model snapshot, capability/cutoff evidence, credential and pricing sources, contest/source-family manifest, prompt and schema digests, logical-token/wall-clock budgets, repeat count, schedule/inference seeds, conclusion thresholds, paid-run ceiling and execution window remain explicit gates in the `real-primary` and `rq1-confirmatory-v1` profiles. They block only network-enabled conformance and result-bearing experiments.
