## Purpose

Defines the evaluation-control blueprint that protects experimental validity and makes future direct, harness, repeat, and ablation runs comparable.

## ADDED Requirements

### Requirement: Feature-flag and ablation catalog
The blueprint MUST inventory every optional result-affecting behavior with a stable flag name, type, default, dependencies, arm values, telemetry field, immutable run-snapshot field, and enabled/disabled acceptance case. Ground-truth isolation and other safety invariants MUST be identified as non-disableable.

#### Scenario: Result-affecting behavior is audited
- **GIVEN** a behavior listed anywhere in the Judge blueprint
- **WHEN** it can alter a model-visible input, action, stop decision, or verdict
- **THEN** the traceability matrix links it to a complete flag-and-observability entry or marks it as a non-disableable safety invariant with rationale

### Requirement: Frozen direct-versus-harness protocol
The blueprint SHALL define an accepted versioned comparison methodology and a separately versioned experiment profile. Each direct/harness pair MUST use the same case and repeat index, canonical candidate, source snapshot, accepted provider/model profile, sampling settings, total logical-token budget, terminal output reserve, Judge-core prompt, verdict schema, scorer semantics, and non-disableable safety invariants. It MUST define a one-call direct arm without tools, memory, verification, retry, or loop and a harness arm whose source-access and agent-loop differences are explicit.

#### Scenario: Arm fairness is reviewed
- **GIVEN** one case and repeat index in the protocol
- **WHEN** a reviewer compares the direct and harness arm definitions
- **THEN** shared fields, intentional differences, exact Judge-core and arm-wrapper references, flag presets, primary retry settings, experiment-profile status, and drift-rejection rules are all explicit

### Requirement: Logical-token and prompt fairness
The blueprint MUST count a cell's logical-token usage as every model input and output token across all observable provider attempts, including cached input and repeated message history, tool definitions, and tool results whenever they are sent to the model. It SHALL account for local tool duration against wall-clock rather than model-token budget and SHALL preserve native usage, cache/billing categories, latency, and cost separately. Both arms MUST share one content-addressed Judge core for classification, severity, evidence, abstention, and structured-output semantics; arm wrappers MUST be limited to the declared source-access and interaction differences.

#### Scenario: Multi-turn harness budget is compared with direct
- **GIVEN** a one-call direct cell and a multi-turn harness cell for the same case and repeat
- **WHEN** logical usage and prompts are audited
- **THEN** every model input/output token in both cells is counted against the same cap, cached input is not removed from logical usage, tool duration is reported separately, and no arm wrapper adds undisclosed Judge knowledge

### Requirement: Primary retry symmetry and paired schedule
The primary comparison MUST disable provider, SDK, and orchestrator retry for both arms. Retry-enabled execution SHALL be represented only as a separately named, flagged, snapshotted, and reported operational ablation. The experiment profile MUST freeze the same case/repeat pairs for both arms and a deterministic seed-derived schedule that interleaves or randomizes arm order without changing pair membership.

#### Scenario: Transient provider failure occurs in the primary comparison
- **GIVEN** either arm receives a retry-eligible transient provider error
- **WHEN** the primary protocol is applied
- **THEN** the cell terminates and remains in the declared denominators without a second provider attempt, while a retry-enabled rerun requires a different ablation identity

### Requirement: Deterministic SourceBundle v1 contract
The blueprint MUST define stable file selection, normalized path ordering, delimiters, input-budget filling, omission markers, content digest calculation, and validation examples for the direct arm's `SourceBundle v1`.

#### Scenario: Bundle generation is independently reproduced
- **GIVEN** an immutable source snapshot, candidate finding, and fixed input budget
- **WHEN** two implementers follow the blueprint
- **THEN** they select and order the same files, emit the same delimiters and omissions, and calculate the same bundle digest

### Requirement: Contest-level manifest and contamination contract
The blueprint MUST define a versioned manifest that assigns whole contests and declared clone, fork, or common-source families to exactly one train, validation, or test split and records provenance, publication time, immutable source revision/digest, source-family identity, label-normalization version, freeze state, and digest. Train MAY shape prompts and tools, validation MAY select experiment-profile parameters, and frozen test MUST NOT feed adaptation. The blueprint SHALL define `pre_cutoff`, `post_cutoff`, and `unknown` contamination buckets.

#### Scenario: Leaking or unverifiable manifest is reviewed
- **GIVEN** a manifest example containing a split conflict, changed frozen content, or missing model cutoff
- **WHEN** the validation rules are applied
- **THEN** contest/source-family split and integrity violations are rejected, test-to-adaptation flow is forbidden, and missing cutoff evidence is classified as `unknown`

### Requirement: Scoring, repetition, and export semantics
The blueprint SHALL define declared repeat counts and pair schedule, resumable experiment-cell identity, retry rules, positive-class semantics, failure denominators, precision, recall, completion/schema-failure rate, cost, latency, repeat agreement/dispersion, matched baseline delta, contamination breakdown, and versioned JSON/CSV fields. It MUST retain every repeat while treating contest as the independent uncertainty cluster, and the frozen experiment profile MUST declare the paired contest-cluster confidence procedure, confidence level, resampling seed, and iteration count.

#### Scenario: Interrupted experiment is accounted for
- **GIVEN** a partially completed frozen experiment matrix
- **WHEN** the blueprint's resume and reporting rules are applied
- **THEN** matching completed cells are reused, drifted cells are rejected, every scheduled cell appears in the declared metric denominators, and neither related findings nor repeats are counted as independent contests

### Requirement: Predeclared RQ1 conclusion gate
The blueprint MUST designate precision as the primary quality outcome and SHALL permit a result to support RQ1 only when the frozen experiment profile's paired confidence result satisfies its minimum precision-gain threshold, maximum recall-loss threshold, and minimum completion-rate threshold. These thresholds MUST be selected using validation data and frozen before test scoring. A failed gate MUST produce `mixed` or `inconclusive` rather than `harness_better`; cost and latency SHALL be reported as trade-offs and MUST NOT override a failed quality gate.

#### Scenario: Precision rises while recall collapses
- **GIVEN** the harness exceeds the declared precision-gain threshold but violates the frozen recall non-inferiority margin
- **WHEN** the final test report is classified
- **THEN** it does not claim that the harness is better and reports the quality, cost, latency, completion, uncertainty, and contamination evidence as `mixed` or `inconclusive`

### Requirement: Accepted methodology and gated experiment profile
The blueprint MUST mark ADR-003 accepted only at methodology scope and MUST keep each concrete result-bearing experiment profile proposed and ineligible until its contest/source-family manifest, accepted provider profile, prompt/schema/flag digests, token and wall-clock budgets, repeat count, schedule and inference parameters, conclusion thresholds, pricing, credential owner, paid-call ceiling, execution window, and TV5 approval are frozen. Any changed field MUST create a new experiment-profile version.

#### Scenario: Incomplete experiment profile is submitted
- **GIVEN** ADR-003 is accepted but the selected experiment profile lacks any required frozen field or approval
- **WHEN** a result-bearing run is requested
- **THEN** execution is rejected before network activity or provider cost while deterministic contract-validation packets remain available and are not reported as scientific results

### Requirement: Scorer-only ground truth
The blueprint MUST place labels and adjudication behind a scorer-only boundary unavailable to request construction, agent context, provider traffic, tools, workspaces, ordinary logs, and trajectories.

#### Scenario: Evaluation data flow is inspected
- **GIVEN** the end-to-end data-flow and trust-boundary diagrams
- **WHEN** a reviewer follows `GroundTruthLabel` from storage to scoring
- **THEN** its only permitted join occurs after terminal execution and no path reaches an agent-visible component

### Requirement: Physical scorer isolation
The blueprint MUST assign scoring to a top-level `scoring` capability and separate scorer entrypoint/process identity with a dedicated database role/schema or equivalently isolated store credential. Daemon, Judge worker, evaluator and desktop processes MUST NOT receive the ground-truth credential, import the `scoring` capability or scorer-only generated schemas, construct a concrete ground-truth adapter, query scorer-owned tables, or write labels and adjudication. Inputs across the boundary SHALL be limited to versioned case/run identifiers and terminal safe result contracts. The scorer MAY emit only approved non-ground-truth scoring outputs through a versioned `evaluation.public` acceptance contract; no reverse dependency from evaluation to scoring is permitted.

#### Scenario: Worker environment is audited
- **GIVEN** the planned daemon, Judge worker, evaluator, desktop and scorer process definitions
- **WHEN** their environment variables, generated-schema allowlists, dependency graph, database grants, table access and message contracts are inspected
- **THEN** only the scorer composition root can resolve ground truth, while all other processes can neither authenticate to the scorer-owned store nor construct a concrete label query path
