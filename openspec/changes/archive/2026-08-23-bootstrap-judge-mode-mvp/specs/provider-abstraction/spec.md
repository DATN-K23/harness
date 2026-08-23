## Purpose

Defines the provider-neutral blueprint contract needed to compare models without leaking vendor-specific behavior into Judge orchestration or evaluation records.

## ADDED Requirements

### Requirement: Normalized provider port
The blueprint MUST define versioned request, response, message, structured-output, tool-call, usage, model-capability, and error schemas without importing provider SDK types into orchestration contracts. The `model_gateway` capability MUST own the port, profiles and all real/deterministic provider adapters; other runtime capabilities MAY import only its public contract, and the desktop MUST have no provider-SDK or credential-resolution path.

#### Scenario: Adapter design is checked
- **GIVEN** a candidate provider's native request and response examples
- **WHEN** an implementer maps them to the provider port
- **THEN** every required normalized field has a documented mapping, unsupported capability behavior, and loss-of-fidelity note

#### Scenario: Provider dependency placement is reviewed
- **GIVEN** a provider SDK mapping, credential resolver, deterministic adapter or provider-specific error
- **WHEN** its physical owner and import path are checked
- **THEN** it resides behind `model_gateway` outbound adapters, exposes only project-owned public types, and is unavailable to Judge/domain internals, desktop code and scorer-only logic except through declared public operations

### Requirement: Identity, usage, latency, and cost metadata
The blueprint SHALL define provider, immutable model identifier/version, endpoint or region when exposed, request identifiers, context limit source, sampling parameters and seed support, native and normalized usage, latency boundaries, pricing version, estimated cost, and credential exclusion.

#### Scenario: Reproduction metadata is reviewed
- **GIVEN** a representative provider attempt
- **WHEN** its planned trajectory fields are compared with the provider contract
- **THEN** all reproducibility and fairness metadata is retained while credentials and secret headers are explicitly prohibited

### Requirement: Error and retry normalization
The blueprint MUST define transient and permanent error categories, retry eligibility, maximum attempts, backoff representation, provider-attempt telemetry, and accounting against wall-clock and cost budgets.

#### Scenario: Permanent error is modeled
- **GIVEN** an authentication, validation, or unsupported-feature failure
- **WHEN** the error mapping table is applied
- **THEN** the blueprint classifies it as non-retryable and identifies the terminal event without consuming transient retry attempts

### Requirement: MVP conformance profiles and expansion seam
The blueprint SHALL define one real-provider profile and two deterministic profiles that use the same conformance cases for orchestration, tools, verdicts, metadata, errors, and trajectories. Additional real adapters and the cross-provider matrix MUST remain a later implementation change.

#### Scenario: Provider scope is reviewed
- **GIVEN** the MVP provider conformance matrix
- **WHEN** acceptance coverage is counted
- **THEN** one real profile and two deterministic profiles cover identical contract categories without claiming RQ3 is complete

### Requirement: Versioned real-provider profile and call-authorization gate
The blueprint MUST define a provider profile separately from the provider-integration ADR. Each profile SHALL record a stable profile ID and version, provider family, API transport, pinned SDK version, immutable model snapshot rather than a floating alias, knowledge cutoff and source, context limit and source, capability-map version/digest, pricing version/source, credential-owner reference, paid-call ceiling, and approval status. The MVP `real-primary` profile SHALL target OpenAI Responses API, but it MUST NOT authorize a network call until every required field and approval is present. A profile change MUST create a new profile version without rewriting the accepted provider-port architecture.

#### Scenario: Incomplete real profile is selected
- **GIVEN** the OpenAI `real-primary` profile is missing its exact model snapshot, knowledge-cutoff evidence, pricing version, credential owner, paid-call ceiling, capability digest, or approval
- **WHEN** a run or fidelity spike requests that profile
- **THEN** the blueprint requires rejection before network activity or provider cost, while both deterministic profiles remain usable and ADR-002 remains accepted at integration-strategy scope

### Requirement: Observable single-attempt provider boundary
Each provider-port invocation defined by the blueprint MUST execute at most one externally billable provider attempt and return one normalized response or error. Provider-side automatic retries MUST be disabled where configurable; otherwise the adapter SHALL expose each native attempt without loss and MUST fail conformance when attempt count, usage, latency, cost, or retry behavior cannot be observed accurately. Retry policy and subsequent attempts belong outside the adapter and count against immutable run budgets.

#### Scenario: SDK retry behavior is inspected
- **GIVEN** a provider SDK whose default transport can retry automatically
- **WHEN** the adapter configuration and attempt trajectory are reviewed
- **THEN** automatic retry is disabled or every native attempt is surfaced separately, and no recorded single attempt hides additional latency, usage, cost, or failure outcomes

### Requirement: Local tool custody in Judge mode
The Judge provider request MUST advertise only versioned local tool definitions owned by the run's immutable tool registry. Provider-hosted web search, code execution, file search, shell, computer use, MCP, or other provider-executed tools MUST NOT be enabled, treated as equivalent local tools, or accepted as Judge evidence.

#### Scenario: Provider-hosted tool call is returned
- **GIVEN** a provider response containing a provider-executed or unregistered hosted-tool event
- **WHEN** the response crosses the provider boundary
- **THEN** the adapter or orchestrator rejects it as a non-conforming capability outcome, records a safe error without dispatching it locally, and does not continue or complete a verdict from that result
