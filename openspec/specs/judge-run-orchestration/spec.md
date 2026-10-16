# judge-run-orchestration Specification

## Purpose

Defines the executable-level orchestration blueprint that future implementers use to build a bounded, asynchronous, and inspectable Judge agent loop.

## Requirements

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
The blueprint SHALL define one TypeScript/Bun package-based modular monolith with `schema`, `protocol`, `core`, `llm`, `server`, `client`, `ui`, `app`, `desktop`, and `cli`. It MUST map run control, source access, agent runtime, Judge and evaluation capabilities into core, model gateway into llm, and scorer-only logic into a separately reachable core capability. Shared data schemas and API contracts MUST remain separate from capability-owned persistence. The layout SHALL include daemon, worker, evaluator and scorer composition roots, generated clients, capability-aligned migrations/tests, configuration, datasets and packaging. These processes MUST compose one coordinated runtime release without duplicated business rules or independent microservice release ownership. Future Audit and verification MUST use declared capability/port seams rather than mode branches spread across Judge code.

#### Scenario: Track implementation placement is reviewed
- **GIVEN** a future task owned by any of TV1 through TV6
- **WHEN** its source, contracts, tests, entrypoint and dependencies are mapped to the package layout
- **THEN** it has one accountable capability or presentation module, obeys declared public import boundaries, and requires neither a Python runtime tree nor duplicated domain rules or unrestricted cross-capability table access

### Requirement: Capability-owned shallow hexagonal boundaries
Each runtime capability MUST retain ownership of its domain rules, application use cases, ports, adapters, resources, persistence metadata and migration contributions. Shared safe data contracts SHALL be defined in schema and application API contracts in protocol without moving domain decisions or database authority into those packages. Cross-capability imports MUST use declared public package/subpath contracts, not private implementation paths; a literal `public` directory is not required. Shared helpers MUST contain only stable technical values and mechanisms. Capability-specific persistence SHALL remain with its owning capability in core, and no capability may query another capability's tables directly. Composition entrypoints MUST wire dependencies without implementing business policy. Empty layer folders SHALL NOT be required solely to satisfy a template.

#### Scenario: Cross-capability dependency is audited
- **GIVEN** a proposed Judge use case, database query, provider adapter, source tool or shared helper
- **WHEN** its imports, table ownership and composition path are mapped
- **THEN** every business artifact has one owner, cross-capability calls use declared public operations/types, and private internal imports, foreign-table queries, domain rules in shared helpers or business decisions in entrypoints are rejected

#### Scenario: Shared data contracts do not duplicate persistence models
- **GIVEN** a schema for a safe run response and a capability-owned run table
- **WHEN** their definitions and consumers are reviewed
- **THEN** the response contract is browser-safe, the table and migration remain backend-owned, and the projection explicitly excludes private control fields and scorer-only data

### Requirement: Multi-process single-runtime release boundary
The daemon, worker, evaluator and scorer SHALL remain separate process entrypoints over one runtime codebase, dependency lock and compatibility version. Process separation MUST enforce lifecycle and ground-truth boundaries without independent service ownership or release cadence. A CLI composition entrypoint MAY wire public core/server services to start the local runtime, but MUST NOT duplicate Judge logic, bypass durable run admission or place scorer credentials in an ordinary client/daemon process. User-facing CLI operations SHALL use the runtime API. Desktop and browser presentation MUST remain clients and MUST NOT compose Judge, provider, tool, persistence, evaluation or scoring capabilities.

#### Scenario: Deployment split is reviewed
- **GIVEN** planned daemon, worker, evaluator, scorer and desktop entrypoints
- **WHEN** their build inputs, version handshake, imports and responsibilities are compared
- **THEN** runtime processes share one authoritative implementation and coordinated release, desktop uses the generated runtime contract, and no UI state becomes execution authority

#### Scenario: CLI starts the daemon
- **GIVEN** a CLI serve/start command and public runtime/server composition contracts
- **WHEN** its dependency closure and behavior are reviewed
- **THEN** it can assemble the daemon without duplicating orchestration or acquiring scorer authority, and accepted work still follows database-owned handoff, claims, budgets and terminal transitions
