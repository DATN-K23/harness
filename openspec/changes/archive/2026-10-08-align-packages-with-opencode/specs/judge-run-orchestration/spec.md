# Spec Delta

## MODIFIED Requirements

### Requirement: Stable physical modular-monolith boundary
The blueprint SHALL define one TypeScript/Bun package-based modular-monolith layout with `schema`, `protocol`, `core`, `llm`, `server`, `client`, `ui`, `app`, `desktop`, and `cli`. It MUST map run control, source access, agent runtime, Judge and evaluation capabilities into core, model gateway into llm, and scorer-only logic into a separately reachable core capability. Shared data schemas and API contracts MUST remain separate from capability-owned persistence. The layout SHALL include daemon, worker, evaluator and scorer composition roots, generated clients, capability-aligned migrations/tests, configuration, datasets and packaging. These processes MUST compose one coordinated runtime release without duplicated business rules or independent microservice release ownership. Future Audit and verification MUST use declared capability/port seams rather than mode branches spread across Judge code.

#### Scenario: Track implementation placement is reviewed
- **GIVEN** a future task owned by any of TV1 through TV6
- **WHEN** its source, contracts, tests, entrypoint and dependencies are mapped to the package layout
- **THEN** it has one accountable capability or presentation module, obeys declared public import boundaries, and requires neither a Python runtime tree nor duplicated domain rules or unrestricted cross-capability table access

#### Scenario: Scorer placement does not expose ground truth through core
- **GIVEN** scorer-only logic is physically inside core alongside safe runtime capabilities
- **WHEN** daemon, worker, evaluator, CLI serve and renderer dependency closures are reviewed
- **THEN** none imports or re-exports scorer code, label schemas or credential resolution through a shared barrel; only the separate scorer entrypoint receives its restricted schema/DB role, while agent-visible inputs remain CandidateFinding and SourceSnapshot

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
- **WHEN** build inputs, version handshake, imports and responsibilities are compared
- **THEN** runtime processes share one authoritative implementation and coordinated release, desktop uses the generated runtime contract, and no UI state becomes execution authority

#### Scenario: CLI starts the daemon
- **GIVEN** a CLI serve/start command and public runtime/server composition contracts
- **WHEN** its dependency closure and behavior are reviewed
- **THEN** it can assemble the daemon without duplicating orchestration or acquiring scorer authority, and accepted work still follows database-owned handoff, claims, budgets and terminal transitions
