# Local Execution Specification

## Purpose

Define OpenCode-style application permission checks and portable host process execution for reviewed Foundry fixtures.

## Requirements

### Requirement: Portable host execution
The runtime SHALL use a local driver without Docker, infrastructure VMs or OS sandbox backend prerequisites. Admission SHALL depend on available runtime capabilities and verified native toolchain artifacts, without an OS-name allowlist. The runtime SHALL describe the driver as host execution under the host account's permissions.

#### Scenario: Host has no OS sandbox tooling
- **GIVEN** a host has compatible runtime APIs and a verified toolchain but lacks OS sandbox tooling
- **WHEN** an approved fixture is requested by the enabled internal verifier
- **THEN** the local driver can run the fixture directly on the host

#### Scenario: Toolchain is unavailable
- **GIVEN** the host has no verified toolchain for its architecture
- **WHEN** execution is requested
- **THEN** verification returns unavailable without starting a workload or downloading dependencies

### Requirement: Application permission before spawn
The runtime SHALL authorize trusted executable identity, structured argv, canonical working directory and granted inputs before direct spawn with shell expansion disabled. It SHALL revalidate path containment before I/O and spawn. The model SHALL have no authority to select executable, host paths, backend, environment or policy. Child environment and descriptors SHALL be constructed from explicit bindings excluding scorer and provider credentials.

#### Scenario: Argument or path escapes the command contract
- **GIVEN** a request attempts shell indirection, a compiler override, traversal or a symlink escape
- **WHEN** permission is evaluated
- **THEN** Harness rejects it before spawn and returns a sanitized reason

### Requirement: Trusted fixture admission and research isolation
Native execution SHALL be available only to explicitly enabled internal composition and SHALL require maintainer-reviewed manifests binding all fixture inputs and toolchain by digest. The native fixture runner SHALL have no scorer-store binding and SHALL be used only in an environment without accessible scorer data or credentials. Agent, user and contest submissions SHALL NOT invoke native verification. Judge production and ordinary CLI SHALL remain read-only and return unavailable if verification is reached. Application permission SHALL NOT be described as confinement of a running program.

#### Scenario: Unreviewed PoC reaches enabled internal verification
- **GIVEN** an internal verifier is enabled and a PoC has passed the sanitizer but lacks a matching reviewed manifest
- **WHEN** verification is requested
- **THEN** it denies the request before spawning

#### Scenario: Production verification is reached
- **GIVEN** ordinary Judge or CLI composition
- **WHEN** the verification operation is reached
- **THEN** it returns unavailable without toolchain discovery, process launch or fabricated success

### Requirement: Bounded process supervision
The process service SHALL apply a finite deadline within the remaining run budget, a combined stdout/stderr byte limit and cancellation to the owned child. It SHALL settle once and stop the owned child on timeout, output exhaustion, cancellation or lease loss using the available runtime controls. Uncertain cleanup SHALL produce infrastructure failure. The driver SHALL NOT claim aggregate resource enforcement or guaranteed cleanup of detached descendants after a supervisor crash.

#### Scenario: Output exceeds the allowed size
- **GIVEN** the child exceeds the combined output budget
- **WHEN** the supervisor processes the output
- **THEN** it stops the owned child and returns bounded, truncated output without a verification pass

### Requirement: Reproducible Foundry fixture results
Verification SHALL stage an invocation-specific projection from an immutable snapshot, use pinned offline toolchain artifacts and generate trusted Foundry configuration with FFI disabled. A pass SHALL require evidence for the intended tests bound to source, PoC and toolchain digests. Results SHALL distinguish assertion failure, denial, unavailable/setup, cancellation, limits and infrastructure failure. Real state probes SHALL return unavailable until a claim-bound implementation exists.

#### Scenario: Foundry exits zero without sufficient evidence
- **GIVEN** Foundry exits zero with missing, partial or zero-test evidence
- **WHEN** verification interprets its result
- **THEN** it does not return a verified pass

### Requirement: Versioned provenance and historical compatibility
New runs SHALL record the execution schema version and enabled flag in immutable sanitized metadata. Enabled executions SHALL record host, policy, toolchain, input identities and effective deadline/output limits. Telemetry SHALL record phase timings and safe outcomes. Changed provenance SHALL NOT silently reuse a frozen experiment profile. Historical sandbox records SHALL remain readable with original bytes and digests and SHALL NOT authorize a new execution.

#### Scenario: The historical trace contains a sandbox event
- **GIVEN** an old trajectory with sandbox stages and configuration
- **WHEN** a new reader inspects it
- **THEN** it reads the original data without invoking an obsolete backend

### Requirement: Retire the legacy runtime
Shipped runtime SHALL remove the old executable sandbox backend, operational types and exports. Historical readers and unrelated database setup SHALL remain usable. Native support SHALL be reported from direct reviewed-fixture evidence on each claimed platform, separately from simulated demos and skipped tests.

#### Scenario: Verification on a clean supported host
- **GIVEN** a host with the required runtime and pinned Foundry toolchain and no Docker or VM tooling
- **WHEN** an approved integration fixture runs
- **THEN** the host driver produces validated evidence with no container or VM invocation
