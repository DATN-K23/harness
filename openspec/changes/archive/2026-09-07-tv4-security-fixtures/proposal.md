## Why

To support the C02 Foundation phase, TV4 must define the exact adversarial test cases, redaction rules, and policy configurations (fixtures) required by the `tv-timeline-v2` blueprint. These fixtures ensure the C03/C04 implementation of the runtime and tools adheres to the `reject-before-I/O` security boundary and the strict data transformation order before any code is written.

## What Changes

- Create JSON fixtures for 35+ adversarial payload tests defined in `adversarial-acceptance-catalog.md` (e.g., PATH-001 through NATIVE-010).
- Create JSON fixtures for redaction/truncation cases defined in `data-classification.md` (e.g., secret redaction, truncation bounds).
- Establish the structured mock inputs that TV1's test runner and TV3's tool runner must successfully ingest and deny.
- Strictly omitting implementation of the runtime security bounds; providing only the test data definition.

## Capabilities

### New Capabilities

- `security-fixtures`: Definition and data formats for adversarial and redaction test fixtures.

### Modified Capabilities

- (None)

## Impact

- **Test Frameworks**: TV1 and TV3 test suites will be structurally bound to use these JSON fixtures to validate compliance with `workspace-policy.md`.
- **Implementation**: No immediate impact on production runtime execution, but strictly defines the boundaries that future implementations must enforce.
