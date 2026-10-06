# Spec: Impeccable UI Experience

## ADDED REQUIREMENTS

### Requirement: Standardized 5-Tier Typography Scale and Anti-Slop Discipline

The application styling MUST enforce a strict 5-tier typographic scale (`11px`, `12px`, `13px`, `14px`, `16px`), eliminate all diffuse 50px neon box-shadow keyframes, and remove `hover-scale` 3D transforms from virtualized rows.

#### Scenario: Rendering typography across widgets

- **Given** any component in the desktop application
- **When** font size is computed
- **Then** it resolves strictly to one of the 5 defined typographic tokens without micro-fractional increments

### Requirement: Persistent Global SSE Streaming

The application shell MUST manage live SSE subscriptions at the root application layer, preventing stream termination during view navigation.

#### Scenario: Switching to Dashboard during active run

- **Given** an audit run is actively streaming events in live mode
- **When** the user switches view to Dashboard and back to Trace
- **Then** the background SSE connection remains continuous without socket disconnection or event loss

### Requirement: Deterministic Target and Vulnerability Inputs

The judge initialization view MUST accept deterministic audit parameters including commit hash, compiler version, and vulnerability description context.

#### Scenario: Submitting complete finding context

- **Given** the user is configuring an audit run
- **When** the user specifies a commit hash, solc version, and vulnerability claim
- **Then** the request payload encapsulates these fields and transmits them to the execution engine
