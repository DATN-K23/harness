## Purpose

Defines the executable-level orchestration blueprint that future implementers use to build a bounded, asynchronous, and inspectable Judge agent loop.

## ADDED Requirements

### Requirement: Explicit Judge lifecycle blueprint
The blueprint MUST define accepted, queued, running, completed, failed, cancelled, and budget-exhausted states; legal transitions; transition authority; terminal immutability; and compare-and-set behavior for stale workers.

#### Scenario: State transition table is validated
- **GIVEN** any source state and requested transition
- **WHEN** the state table and diagram are consulted
- **THEN** the blueprint identifies whether the transition is legal, which component owns it, what is persisted, and how duplicate or stale attempts resolve

### Requirement: Multi-step agent-loop sequence
The blueprint SHALL specify the provider-request, tool-call, structured-tool-result, context-rebuild, verdict-validation, and terminal-commit sequence, including recovery from allowed tool errors without crashing the worker.

#### Scenario: Tool failure path is traced
- **GIVEN** a model issues a validly shaped tool request whose execution fails
- **WHEN** the error sequence is followed
- **THEN** the blueprint shows the error event, bounded model-visible feedback, next context preflight, and permitted continuation or terminal outcome

### Requirement: Run budget and stop-condition contract
The blueprint MUST define maximum steps, total token budget, wall-clock timeout, context budget, and versioned no-progress detection, including precedence when multiple limits are reached and telemetry for the triggering reason.

#### Scenario: Budget exhaustion is reviewed
- **GIVEN** a run approaching more than one configured limit
- **WHEN** a stop condition triggers before a valid verdict
- **THEN** the blueprint determines one terminal reason, prevents further provider/tool execution, and identifies the recorded budget evidence

### Requirement: Per-call context preflight
The blueprint MUST define model-limit resolution, mandatory output reserve, input allocation buckets, immutable candidate/system content, deterministic tool-result truncation, token-estimation provenance, and `context_budget` termination before provider invocation.

#### Scenario: Context cannot fit safely
- **GIVEN** a candidate, instructions, history, and tool results that exceed the selected model limit
- **WHEN** enabled transformations still cannot satisfy the output reserve
- **THEN** the blueprint forbids the provider call and requires a budget-exhausted event containing allocation, digest, rule version, and resolved flag values

### Requirement: Explicit single-turn runtime ownership
The blueprint MUST assign exactly one observable provider attempt to each provider-port invocation and exactly one local tool settlement to each tool-dispatch invocation. Only the Judge orchestrator SHALL own continuation, retry decisions, context reconstruction, step and budget accounting, trajectory persistence, verdict repair, and terminal commit; no provider SDK, provider adapter, tool runtime, or framework helper may own a hidden agent loop.

#### Scenario: Hidden continuation is rejected
- **GIVEN** a proposed adapter or SDK configuration that automatically executes tools, retries a provider call, or continues the conversation internally
- **WHEN** it is reviewed against the runtime-boundary contract
- **THEN** the blueprint identifies the behavior as non-conforming unless it is disabled and every provider attempt, tool call, retry decision, context rebuild, and continuation remains individually controlled and recorded by the Judge orchestrator

### Requirement: Stable physical modular-monolith boundary
The blueprint SHALL define one physical repository layout whose system-level organizing axis is capability rather than technical layer. It MUST include top-level canonical contracts; a Python runtime with `run_control`, `model_gateway`, `source_access`, `agent_runtime`, `judge`, `evaluation`, and `scoring` capabilities; minimal shared-kernel and technical-platform areas; daemon, worker, evaluator and scorer composition roots; generated contracts; module-aligned migrations/tests; a downloadable desktop client; configuration, datasets and packaging. Daemon, worker, evaluator and scorer MUST compose the same versioned runtime modules without duplicating business rules or becoming independently versioned microservices, and future Audit or verification behavior MUST enter through declared capability/port seams rather than mode branches spread across Judge code.

#### Scenario: Track implementation placement is reviewed
- **GIVEN** a future task owned by any of TV1 through TV6
- **WHEN** its source, contracts, tests, entrypoint, and dependencies are mapped to the physical layout
- **THEN** it has one accountable capability or presentation module, obeys the documented import direction, and does not require a new service, duplicate domain model, global business adapter, or cross-boundary internal import

### Requirement: Capability-owned shallow hexagonal boundaries
Each runtime capability MUST own its public contracts, domain rules, application use cases, ports, adapters, resources, persistence metadata and migration contribution. Cross-capability imports MUST target only the depended-on capability's `public` surface. `shared_kernel` MUST contain only stable technical value types and base errors; `platform` MUST contain only technical mechanisms; `entrypoints` MUST contain composition logic only. A capability MUST NOT query another capability's tables, import its domain/application/ports/adapters, or move business persistence into a global adapter directory. Empty layer folders SHALL NOT be scaffolded solely to satisfy the template.

#### Scenario: Cross-capability dependency is audited
- **GIVEN** a proposed Judge use case, database query, provider adapter, source tool or shared helper
- **WHEN** its imports, table ownership and composition path are mapped
- **THEN** every business artifact has one capability owner, cross-capability calls use a declared `public` command/query/event/type, and any internal import, direct foreign-table query, business rule in `platform`, or business logic in an entrypoint is rejected

### Requirement: Multi-process single-runtime release boundary
The daemon, worker, evaluator and scorer SHALL be separate process entrypoints over one runtime codebase, dependency lock and compatibility version. Process separation MUST enforce lifecycle and ground-truth boundaries without creating independent service ownership or release cadence. The desktop SHALL remain a client of the local-runtime contract and MUST NOT be a composition root for Judge, provider, tool, persistence, evaluation or scoring capabilities.

#### Scenario: Deployment split is reviewed
- **GIVEN** planned daemon, worker, evaluator, scorer and desktop packages
- **WHEN** their build inputs, version handshake, imports and responsibilities are compared
- **THEN** runtime processes share one authoritative capability implementation and coordinated runtime release, while the desktop uses only the generated local-runtime client and cannot become an alternate execution authority
