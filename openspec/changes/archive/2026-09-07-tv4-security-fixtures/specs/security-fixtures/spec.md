## Purpose
This capability defines the structure and data for security test fixtures, standardizing the evaluation of runtime security boundaries and redaction logic.

## ADDED Requirements

### Requirement: Standardized Adversarial Payload Schema
The system must define adversarial test cases in a standard JSON schema that encapsulates the payload, the target category, and the expected rejection behavior.

#### Scenario: Enforcing PATH category shape
- **WHEN** the test framework loads an adversarial fixture for a PATH violation
- **THEN** the fixture provides the target category ("PATH"), a unique ID, the raw payload string (e.g., "/etc/passwd"), and the expected error or security event identifiers

### Requirement: Standardized Data Redaction Schema
The system must define redaction test cases that explicitly map an unredacted input containing sensitive data to its expected sanitized output.

#### Scenario: Defining secret redaction
- **WHEN** the test framework loads a redaction fixture containing a mock secret
- **THEN** the fixture provides the original input string and the exact expected string with the secret replaced by a redaction placeholder
