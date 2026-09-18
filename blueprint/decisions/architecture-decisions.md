# Architecture Decisions

## Source: ADR-001-technology-stack.md

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


## Source: ADR-002-provider-contract.md

# ADR-002: Direct official SDK behind the project provider port

- Status: `Accepted`
- Version: `adr-002-v2`
- Decision date: `2026-08-14`
- Owner/approvers: TV1 architecture owner and TV5 evaluation owner
- Governing requirements: PROV-01–PROV-04, ORCH-02, ORCH-04, VER-01, DATA-02
- Affected work packages: WP-03, WP-04, WP-08

## Decision scope

This ADR accepts the provider integration strategy, not a model, price, credential, or paid experiment. Those changing values belong to versioned provider and experiment profiles.

The only project contract visible to orchestration is `harness.modules.model_gateway.public`. The first real adapter calls the OpenAI Responses API through the official asynchronous Python SDK and lives at:

`runtime/src/harness/modules/model_gateway/adapters/outbound/providers/openai/`

The adapter translates project-owned requests and responses at the boundary. No provider SDK type, client, credential, retry policy, hosted tool, or native event enters another module.

## Accepted first-adapter behavior

1. Each logical step sends the complete, explicit, committed model-visible history selected by `agent_runtime`; the provider is not the conversation authority.
2. Calls are non-streaming and one-attempt for the primary RQ1 profile.
3. Official SDK automatic retries are set to zero; project retry is disabled for primary direct and harness arms.
4. Only normalized local custom-function definitions may be sent. Tool requests are dispatched by `source_access`; automatic SDK/provider tool execution is forbidden.
5. Hosted tools, provider-owned loops, Agents SDK orchestration and background/provider conversation state are forbidden in MVP.
6. Returned structured data is independently parsed and validated against the project verdict schema. Provider structured-output success is not acceptance.
7. Native request ID, resolved model when exposed, usage, finish/error metadata and timings are preserved through allowlisted mappings; secrets and raw unsafe errors are not.

## Rejected MVP options

| Option | Disposition | Reason |
|---|---|---|
| LiteLLM or another in-process gateway | Rejected for MVP | Adds a semantic/retry layer before native fidelity is established. |
| external provider proxy | Rejected for MVP | Adds trust, logging, latency and failure boundaries without an MVP need. |
| OpenAI Agents SDK orchestration | Rejected for MVP | Provider/library loop ownership conflicts with the project-owned agent state machine and ablation controls. |
| hosted web/file/computer tools | Rejected for MVP | Expands network and execution authority beyond read-only registered source. |
| provider-owned conversation/thread state | Rejected for MVP | Prevents exact committed-history replay and symmetric accounting. |

Multiple providers remain supported by the port and profile schemas. Adding a second adapter does not require changing the agent loop.

## Profile and pre-network gate

`providers/real-primary.profile.yaml` is the only selectable real-provider identity for the initial confirmatory experiment. It remains `Proposed` until it records an immutable model snapshot, official SDK/version evidence, capability/context/cutoff evidence, pricing source/version/currency, credential owner, paid-call and cost ceilings, approval identities/date/digest, and `network_ready: true`.

Before constructing a provider client or reading a credential, `model_gateway` validates the provider profile and experiment-profile cross-reference. Missing, null, floating, unapproved, expired or digest-mismatched fields produce `pre_network_profile_rejected`. No DNS, SDK client construction, token exchange or paid request may occur.

Direct and harness arms reference the same accepted provider-profile identifier and digest. Deterministic profiles do not require a real profile, credential, network, paid budget, or provider SDK.

## Consequences

- Native fidelity and retry behavior are reviewable at one adapter boundary.
- Exact model/pricing/cutoff changes version a profile instead of reopening this ADR.
- Multi-provider support is an interface property from the start, not a gateway dependency.
- Retry-enabled research, streaming, hosted tools, provider state, external gateways and provider-owned agents require separate flags/protocol changes or superseding ADRs.

## Acceptance evidence

Accepted by TV1/TV5 on `2026-08-14` against this `adr-002-v2` content and the project-port boundary in `architecture/agent-runtime-boundaries.md`. Acceptance authorizes blueprint architecture only. It does not approve a credential, model, price, network call, dependency installation or experiment.



## Source: ADR-003-baseline-protocol.md

# ADR-003: Matched-pair direct-versus-harness evaluation methodology

- Status: `Accepted`
- Version: `adr-003-v2`
- Decision date: `2026-08-14`
- Owner/approver: TV5 evaluation owner
- Collaborators/reviewers: TV1, TV2, TV4, TV6
- Governing requirements: EVAL-01–EVAL-06
- Affected work packages: WP-08, WP-09

## Decision scope

This ADR accepts the durable methodology for RQ1. It does not accept a model, case list, repeat count, token budget, statistical threshold, prompt revision, retry-enabled run or paid execution. Those values live in a versioned experiment profile; changing them versions that profile rather than this ADR.

## Accepted methodology

RQ1 compares matched `(case_id, repeat_index)` pairs using the same immutable candidate, source snapshot, provider-profile digest, model snapshot, sampling/seed semantics, verdict-schema digest, total logical-token budget and output accounting. Both cells are scheduled in a deterministic predeclared paired order.

The arms intentionally differ only where the treatment requires it:

| Direct arm | Harness arm |
|---|---|
| shared Judge core + direct wrapper | same Judge core + harness wrapper |
| one request containing deterministic `SourceBundle` | explicit agent loop using local read-only source tools |
| loop/tools/tool feedback/schema repair disabled | versioned flags may enable them |
| one provider call | one or more logical calls within the same total logical-token budget |

Prompt wrappers are not claimed identical. Their exact bytes and digests are frozen as treatment definitions. The Judge meaning, verdict schema and provider profile are shared.

## Logical-token and time accounting

Fairness uses total logical model-visible tokens, not a provider invoice shortcut. Every call counts its complete input as sent, including repeated committed history, tool results, wrapper/core prompt, cached context and any content the provider reports at a discounted/cache rate. Output and reasoning categories are retained separately and included under the profile's declared accounting formula. Native usage is preserved; a versioned estimator defines fallback and disagreement behavior.

Wall-clock is not forced equal because orchestration and tools are part of the treatment. The same per-cell maximum protects runaway work, while observed provider latency, tool latency, queue time and end-to-end elapsed time are reported separately. Latency is an outcome, not converted into extra token allowance.

## Primary retry symmetry

Primary direct and harness cells each configure SDK retries to zero and one project attempt per logical provider call. A transient failure remains an accounted terminal outcome. Retry-enabled execution is a separate result-affecting flag, snapshot value, acceptance family and experiment identity; it cannot be mixed into the primary analysis.

## Pairing, drift and test discipline

- Case list, contest/source-family split, repeats, scheduling seed/order, prompts, flags, provider/profile, budgets, schemas, scorer and thresholds are frozen before test execution.
- A pair is rejected before either network call if a required digest/value differs or only one arm enables retry.
- Training informs development; validation selects/finalizes profile values; frozen test is used once for the confirmatory report and never for adaptation.
- Repeats estimate within-case variability; they are not independent cases. Inference clusters at contest and reports source-family sensitivity.
- All scheduled cells remain in completion and quality denominators under predeclared semantics.

## Profile gate

`evaluation/rq1-confirmatory-v1.profile.yaml` remains `Proposed` until all required values, provider-profile acceptance, prompt/schema/flag/bundle/scorer digests, split freeze, repeat/schedule, contest-cluster inference method/confidence/seed/iterations, thresholds, execution window, paid ceiling and approvers are recorded. The experiment/profile gate runs before provider construction or credential access. Incomplete, unapproved or digest-drifted profiles produce `pre_network_experiment_rejected`.

## Consequences

The comparison is reproducible and suitable for ablation while preserving the real product difference. It costs more metadata and requires honest accounting of repeated context. Changing RQ1 values creates a new profile/version; changing the matched-pair methodology, adaptation rules or inferential unit requires a superseding ADR.

## Acceptance evidence

Accepted by TV5 on `2026-08-14` for methodology only against `adr-003-v2`, `baseline-protocol-v2` and `experiment-profile-v1`. This acceptance is blueprint evidence and authorizes no dataset freeze, credential, paid model call or contest execution.


## Source: ADR-004-opencode-reference.md

# ADR-004: Use OpenCode as pinned architecture evidence, not an implementation base

- Status: `Accepted`
- Version: `adr-004-v1`
- Decision date: 2026-08-14
- Owner: TV1/TV6
- Collaborators: TV2, TV3, TV4, TV5
- Governing requirements: ORCH-05–ORCH-08, PROV-01–PROV-07, TOOL-01–TOOL-05, DATA-05, API-05–API-09
- Reviewed repository: local `/home/zinn/zinn/DATN/opencode` for evidence only
- Reviewed snapshot: `14f0bf64a19493110b51f5fdeb9c1c1bba5dd3f5`
- Snapshot date/subject: `2026-07-31T08:31:55Z`, `chore: generate`
- License observed: MIT, copyright 2025 opencode
- Source-reuse authorization: none
- Affected work packages: WP-01–WP-07

## Decision

Harness independently implements its accepted contracts and architecture. OpenCode is a pinned comparative reference, not a fork, template, dependency, generated-code input or synchronization source. Architectural ideas may be adopted or adapted only through the destination contracts below; source copying is not authorized by this ADR.

## Snapshot integrity and inventory

Read-only checks on 2026-08-14 produced:

- `git rev-parse HEAD` = `14f0bf64a19493110b51f5fdeb9c1c1bba5dd3f5`.
- `git status --short` returned empty, so the inspected worktree matched the pinned commit.
- The snapshot contains 40 `package.json` files and Bun lockfiles including root `bun.lock`; it is a product-scale monorepo rather than a small Judge module.
- The snapshot has no root `.gitmodules` entry in the tree inventory used for this review.
- Harness currently contains no application `package.json`, Python package manifest, dependency lockfile, Git submodule or import/package reference to OpenCode. Blueprint Markdown references are provenance, not runtime dependencies.

## Provenance matrix

| Snapshot-relative evidence | Observed pattern | Disposition | Judge rationale | Destination blueprint artifact | Forbidden carry-over | Future validation |
|---|---|---|---|---|---|---|
| `packages/opencode/src/session/llm.ts`; `session/llm/request.ts`; `session/llm/native-runtime.ts` | Model invocation is an explicit boundary capable of representing one provider turn. | Adopt idea | One invocation/attempt must remain observable for cost, retry and fairness accounting. | `architecture/agent-runtime-boundaries.md`; `contracts/provider-contract.md` | SDK-owned continuation, hidden retry, hosted tools, provider thread authority | Provider conformance case proves one observable attempt and explicit committed history. |
| `packages/opencode/src/session/processor.ts`; `session/prompt.ts` | A higher-level session processor owns continuation around model/tool events. | Adapt | Harness needs the ownership concept but reconstructs from PostgreSQL and fixes Judge-specific stop/verdict rules. | `architecture/agent-runtime-boundaries.md`; `architecture/end-to-end-sequences.md` | Process-local lifecycle authority, broad coding-agent behavior, implicit loops | Restart/redelivery sequences and import-boundary review. |
| `packages/opencode/src/tool/tool.ts`; `tool/registry.ts` | Tools have explicit definitions and registry dispatch. | Adapt | Judge requires an immutable per-run, read-only source registry and exactly one local settlement. | `contracts/tool-contracts.md`; `security/workspace-policy.md` | Dynamic plugin/MCP discovery, approval-widened authority, host paths | Registry inventory and adversarial structural-denial cases. |
| `packages/opencode/src/tool/shell.ts`; `tool/write.ts`; `tool/edit.ts`; `tool/webfetch.ts`; `tool/websearch.ts` | General coding agent exposes mutation, execution and network authority. | Reject | These capabilities can escape source custody and contaminate Judge evidence. | `security/adversarial-acceptance-catalog.md`; `security/threat-model.md` | Shell, write/delete/rename, process, network, arbitrary URL | Effective Judge registry contains no executable route for excluded capabilities. |
| `packages/opencode/src/session/message-v2.ts`; `server/event.ts` | Versioned message/event concepts support inspectable timelines. | Adapt | Harness needs canonical append-only events, but PostgreSQL and finite cursor polling are authoritative. | `contracts/trajectory-events.schema.json`; `persistence/consistency-and-idempotency.md` | V1/V2 compatibility baggage, uncommitted UI events as truth | Event schema/order, cursor and terminal-immutability validation. |
| `packages/opencode/src/storage/storage.ts`; `storage/schema.ts`; `cli/cmd/db.ts` | Local storage/database facilities serve interactive sessions. | Reject as authority | Judge runs and paid-attempt ambiguity must recover across processes from PostgreSQL claims/outbox records. | `persistence/erd.md`; `persistence/consistency-and-idempotency.md` | SQLite/process-local queue/session ownership | Daemon/worker restart and duplicate-delivery acceptance evidence. |
| `packages/opencode/src/provider/provider.ts`; provider transforms | Broad multi-provider normalization exists. | Adapt | Harness keeps a smaller project-owned `model_gateway.public` contract and native-fidelity matrix. | `contracts/provider-contract.md`; `providers/provider-profile.schema.json` | OpenCode package dependency, floating capability emulation, hidden normalization | One real plus two deterministic profiles pass the same contract cases. |
| `package.json`; `bun.lock`; `packages/app/package.json` | Bun/Effect/SolidJS-oriented product monorepo and release surface. | Reject | Team selected Python runtime, React/Vite renderer and capability-first modular monolith. | ADR-001; ADR-005; ADR-006 | Bun workspace, Effect/Solid coupling, product-scale package topology | Manifest/dependency inventory and physical-layout review. |
| `LICENSE` | MIT permits reuse subject to notice conditions. | Record only | License provenance does not itself justify or authorize copying. | This ADR; `delivery/scope-audit.md` | Treating MIT as blanket architectural/source adoption approval | Any later source/package reuse identifies exact material and passes license/security/dependency review. |

## No-copy and no-sync rule

Under this ADR the Harness repository MUST NOT:

- fork OpenCode or add it as a submodule, subtree, workspace or package dependency;
- vendor, generate from, or copy OpenCode source, tests, schemas, prompts or assets;
- refer to the local review path as a build/runtime input;
- track a floating branch, automatically synchronize upstream, or let upstream changes replace an accepted Harness boundary.

Learning a pattern and implementing it independently against Harness-owned requirements is allowed. Any later proposal to reuse source or packages must identify exact files/packages, preserve required notices, assess transitive dependencies and security, and supersede the no-copy decision explicitly.

## Newer-snapshot and supersession rule

A newer OpenCode snapshot creates a new ADR-004 version containing the new immutable commit, provenance delta and destination impact. The current Harness architecture remains authoritative until that review is accepted. Upstream change alone is not evidence to supersede ADR-001, ADR-002, ADR-005 or ADR-006.

## Acceptance evidence

- Snapshot identity and clean status recorded above.
- Package/lock/submodule inventory recorded above.
- Every considered pattern has a destination and forbidden carry-over.
- Harness dependency/import inventory returned no OpenCode reference outside planning/blueprint provenance.
- Result: `PASS — reference-only review; zero source/dependency carry-over observed`.


## Source: ADR-005-capability-first-modular-monolith.md

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


## Source: ADR-006-desktop-local-runtime.md

# ADR-006: Downloadable desktop client over an independent local runtime

- Status: `Accepted`
- Version: `adr-006-v1`
- Decision date: 2026-08-14
- Owner: TV6/TV1
- Collaborators: TV2, TV3, TV4, TV5
- Governing requirements: API-01–API-10, UI-01–UI-06, DATA-05–DATA-06, TOOL-01
- Accepted by: project owner/team lead after product-topology review
- Affected work packages: WP-01, WP-02, WP-05–WP-10

## Decision

Deliver the MVP as one coordinated product consisting of:

1. a downloadable desktop client whose renderer uses React, TypeScript and Vite;
2. a local headless runtime bundle containing daemon, worker, evaluator and scorer process entrypoints from one Python modular-monolith source and compatibility version;
3. PostgreSQL as the durable run/job/event/evaluation authority.

The desktop is a thin presentation/control client. It uses only the generated local-runtime API client. It never imports Python internals, opens PostgreSQL, invokes providers/tools, resolves runtime/scorer credentials, or fabricates authoritative events.

## Local boundary

- The daemon binds only to loopback or an OS-equivalent local IPC endpoint.
- A protected installation-scoped rendezvous record identifies endpoint and runtime instance.
- Requests use a rotatable installation-scoped credential or equivalent OS access control.
- The credential remains in native-shell/OS-protected custody and never enters URLs, renderer persistence, ordinary logs, trajectories or exports.
- Public binding, remote access, production authentication/authorization and multi-tenancy are outside MVP.

This protects a local process boundary; it is not a claim of hostile multi-user isolation.

## Compatibility handshake

Before normal API calls, the generated client obtains runtime identity, API version, canonical contract digest, runtime build, supported capability set and health. Incompatible major/API/digest pairs fail closed. Submission/mutation remains disabled and the UI offers a version-specific restart/update action; it never bypasses the API through direct DB/provider access.

## Lifecycle ownership

Desktop window closure, renderer crash, disconnect, update or reinstall does not cancel an accepted run. PostgreSQL records, work claims, versions, budgets and committed events control recovery. On reconnect the desktop resumes finite cursor polling and de-duplicates by `(run_id, sequence)`.

Runtime shutdown, update and run cancellation are explicit control-plane operations. They observe safe worker boundaries and terminal immutability; closing a window is not a lifecycle command.

## Source registration custody

The native repository picker may return a host path only as ephemeral sensitive input to the source-registration operation. `source_access` canonicalizes, authorizes, snapshots and digests it. Run submission accepts only `source_snapshot_id`; raw host paths never enter run/event payloads, provider traffic, ordinary logs, experiment identity or desktop trace persistence.

## Packaging contract

`packaging/local-runtime/` owns reproducible runtime/PostgreSQL process setup and health checks. Under accepted ADR-007, `packaging/desktop/` owns per-OS Tauri packaging inputs while `apps/desktop/src-tauri/` owns the narrow Rust host. Desktop and runtime use a coordinated compatibility/release policy, but runtime processes remain one modular-monolith release rather than microservices.

The MVP does not promise a single-file, database-free installer. PostgreSQL is not silently replaced by embedded SQLite to simplify packaging.

## Options considered

| Option | Disposition | Rationale |
|---|---|---|
| Public/browser-hosted web application | Rejected for MVP | Conflicts with downloadable local-first product and expands auth/multi-tenancy threat scope. |
| Desktop embeds and owns the agent loop | Rejected | Window lifecycle would become execution authority and weaken crash recovery. |
| Desktop thin client + independent local runtime | **Accepted** | Preserves durable async execution, local repository UX and contract-first separation. |
| Independently deployed backend services | Rejected | Adds distributed release/version/failure ownership without evidence. |

## Consequences

- OpenAPI remains a local process boundary and canonical generated-client source.
- Desktop availability is not required for run correctness.
- Local endpoint access control and compatibility states become required contracts/wireframes.
- ADR-007 selects Tauri 2 and its least-authority/signing/updater boundary; three-OS lifecycle, credential, packaging and rollback readiness remains future WP-01/WP-10 evidence.
- Offline replay remains a later projection over committed events, not desktop-owned authoritative state.

## Supersession

Changing to hosted SaaS, renderer-owned execution, direct desktop database/provider access, embedded SQLite authority or independently released runtime services requires a superseding ADR and threat/migration review.


## Source: ADR-007-desktop-shell.md

# ADR-007: Tauri 2 native desktop shell, signing, and updater boundary

- Status: `Accepted`
- Version: `adr-007-v2`
- Decision date: 2026-08-19
- Owner: TV6
- Collaborators: TV1, TV4
- Governing requirements: API-04, API-06–API-10, UI-01, UI-04–UI-06
- Accepted by: project owner after ADR-007 option review
- Approval scope: native-host family and authority boundary; distribution readiness remains unproven
- Planning evidence: proposal `sha256:2ea42e08578df7f19bfbcbdcfd62cb69db0e9b00e4a4cb48014663c1f8e30b55`, design `sha256:8a966115fd3f86ebc44857530a0c8a42b1654c184f688e0b560d4269209ab864`
- Affected work packages: WP-01, WP-07, WP-10
- Does not authorize: source scaffolding in this blueprint change, release signing-key creation, installer publication, or claims that the readiness spike passed

## Fixed context

ADR-001 accepts React/TypeScript/Vite for the renderer. ADR-006 accepts a thin downloadable desktop over an independent Python/PostgreSQL runtime. This ADR selects only the native OS host responsible for windows, runtime discovery/start-or-attach, repository selection, protected local credential mediation, notifications, OS signing integration, and coordinated updates. It does not reopen the renderer, runtime, database, canonical contracts, generated-client boundary, or PostgreSQL execution authority.

## Decision

Select **Tauri 2** with a narrow Rust host under the future `apps/desktop/src-tauri/` tree.

The Tauri host is an OS adapter, not a Judge business capability or an alternate runtime composition root. The React/Vite renderer remains a generated-local-runtime-client consumer. Renderer-to-native access is deny-by-default and described by explicit per-window capabilities, project permissions/scopes, and typed commands. The allowed command families are limited to:

- runtime discovery, start-or-attach, health, and compatibility status;
- shell-mediated authenticated local-runtime requests without disclosing the installation credential;
- an operator-initiated native repository picker whose result is used only for source registration;
- local notifications containing safe projection data;
- update availability and explicit coordinated-update preparation.

The renderer receives no generic filesystem, shell, process, environment-variable, arbitrary-URL, raw-credential, direct-updater, database, provider, Judge-tool, or scorer capability. Displayed model/source/trace content cannot widen this allowlist. A new native authority requires a versioned command/permission change, TV4 review, and updated acceptance evidence.

## Runtime lifecycle boundary

The Python daemon, worker, evaluator, scorer, and PostgreSQL are independently supervised or detached from the Tauri window/native-host lifecycle. A runtime executable may be bundled as distribution payload, but it cannot remain an ordinary Tauri child whose handle, parent exit, or last-window close terminates accepted work.

Tauri discovers an OS-protected rendezvous record and starts or attaches through a platform lifecycle adapter. PostgreSQL records, work claims, versions, budgets, and committed events remain authoritative. Closing or crashing the renderer/native host issues no implicit run cancellation or runtime shutdown; a later compatible desktop rediscovers the runtime and resumes finite cursor polling.

## Credential and repository custody

The installation-scoped local credential remains behind an approved OS-protected credential-store adapter. Windows, macOS, and Linux backends, access scope, rotation, and unavailable-backend behavior must be declared during readiness work. If an approved secure backend cannot be established, connection fails closed: no plaintext file, renderer storage, anonymous access, or silent insecure fallback is allowed.

Tauri Stronghold or another encrypted store is not automatically equivalent to an OS credential manager; it may be selected only after its threat model and custody evidence satisfy the same contract. The renderer receives at most a shell-mediated request capability or least-lived non-persisted session representation, never a long-lived raw secret.

The repository picker returns an operator-selected path only as short-lived sensitive control-plane input. It is sent once through source registration, discarded after success/failure handling, and never grants the renderer or model arbitrary filesystem authority. All later flows use `source_snapshot_id`, immutable revision, tree digest, and approved source-relative evidence.

## Signing and coordinated update

Tauri's updater is the signed native artifact transport, not the complete product update protocol. A project-owned update coordinator must verify:

1. OS code signing/notarization as applicable and the Tauri update-artifact signature;
2. release channel plus desktop/runtime/API/contract/database compatibility manifest;
3. active, claimed, and ambiguous paid work before mutation;
4. one explicit policy: `reject_if_active` or operator-confirmed `quiesce_then_stop` at safe worker boundaries;
5. post-install runtime health and compatibility before re-enabling mutations;
6. rollback behavior that preserves committed state and ambiguous-attempt evidence.

Signing private keys belong to release CI or an explicit release-owner secret boundary. Renderer and runtime processes never receive them. Losing the updater or closing the desktop is not cancellation and cannot erase committed work.

## Candidate comparison

| Candidate | Architecture fit | Decision | Remaining evidence |
|---|---|---|---|
| Tauri 2 + system webview + narrow Rust host | Keeps React/Vite, supports explicit capabilities/permissions and native integration without bundling a Node/Chromium authority into the thin host. | **Accepted** | Three-OS packaging, system-webview variance, lifecycle, secure-store, signed-update, rollback, reproducibility, startup/memory/bundle measurements. |
| Electron + bundled Chromium/Node | Mature React desktop ecosystem and consistent renderer, but adds preload/IPC/Node/Chromium privilege and update maintenance this thin client does not need. | Rejected as primary; contingency only through a superseding ADR. | Would still require strict sandbox/IPC/sender validation, secure-store checks, Linux distribution/update design, and independent runtime proof. |
| Python-hosted webview/native UI | Reuses Python knowledge, but no nominated candidate demonstrated an equally clear React/Vite, per-window permission, signing, and three-OS updater boundary. | Rejected for MVP. | A future concrete candidate must satisfy the same matrix through a superseding ADR. |

Bundle size alone is not the decision. The primary reason is the smallest reviewable native-authority surface for a trace UI that displays untrusted model/source content while the independent Python runtime owns all Judge behavior.

## Official documentation evidence

Sources were reviewed for the 2026-08-19 decision. They establish available framework mechanisms, not project readiness evidence.

| Evidence | Official source | Decision use and limit |
|---|---|---|
| Tauri capabilities | [Capabilities](https://v2.tauri.app/security/capabilities/) | Supports per-window/webview capability sets; merged capabilities and custom-command exposure still require project review. |
| Tauri permissions | [Permissions](https://v2.tauri.app/security/permissions/) | Supports command allow/deny scopes; a plugin default cannot substitute for the explicit project allowlist. |
| Native picker | [Dialog plugin](https://v2.tauri.app/plugin/dialog/) | Supports operator path selection; it does not authorize runtime/model filesystem access. |
| Signed updater | [Updater plugin](https://v2.tauri.app/plugin/updater/) | Supports signed update artifacts on Windows/Linux/macOS; it does not coordinate Python runtime, PostgreSQL migrations, active work, or rollback by itself. |
| Encrypted store | [Stronghold plugin](https://v2.tauri.app/plugin/stronghold/) | Demonstrates encrypted secret storage but is not presumed equivalent to each OS credential manager. |
| Electron hardening/store | [Security](https://www.electronjs.org/docs/latest/tutorial/security), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) | Confirms Electron can be hardened while leaving preload/IPC/Node and Linux secure-backend fallback review to the project. |
| Electron updater | [autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater) | Documents built-in macOS/Windows updating and no equivalent built-in Linux path. |

## Required readiness spike

ADR acceptance selects the host family; it does **not** claim distribution readiness. Before a native release is considered ready, WP-01/WP-10 must produce reproducible evidence that a minimal package:

1. builds on every claimed Windows/macOS/Linux target and records unsupported combinations;
2. discovers, starts or attaches to a dummy-compatible independently supervised runtime;
3. performs compatible and incompatible runtime/API/contract-digest/capability handshakes;
4. uses and rotates an OS-protected local credential without renderer persistence, and fails closed when no approved backend exists;
5. uses the repository picker only for registration and retains no raw path in later requests, logs, traces, or desktop state;
6. closes/crashes/reopens while synthetic committed work continues and can be rediscovered;
7. denies undeclared native commands from untrusted rendered content;
8. demonstrates signed update availability, active-work rejection/quiesce, interruption, incompatible partial update, post-update health, and rollback states;
9. reproduces a clean-machine build with pinned Rust/Tauri/plugin and JavaScript toolchains;
10. records measured startup, memory, and bundle evidence rather than marketing estimates.

No provider call, contest data, Judge implementation, scorer access, installer publication, or production signing key is part of this blueprint application.

## Consequences

- The future physical desktop tree uses standard `apps/desktop/src-tauri/` configuration and Rust ownership next to `apps/desktop/ui/`.
- Rust is limited to native-host integration; Judge/domain logic remains in the Python modular monolith.
- System-webview and per-OS packaging variance become explicit release risks and test-matrix obligations.
- Shell implementation may begin only in a separate implementation change and cannot be called complete until readiness evidence passes.
- Failure of one readiness case pauses distribution for that target and triggers remediation or a superseding ADR; it does not silently switch to Electron.

## Supersession

Changing the host family, granting renderer generic native authority, coupling runtime lifetime to the desktop, replacing OS-protected credential custody, or weakening coordinated signed-update behavior requires a superseding ADR with TV6/TV4 review, measured incompatibility evidence, migration impact, and project-owner approval.


