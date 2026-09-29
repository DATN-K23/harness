## Context

This change implements the C02 Foundation fixtures for TV4. The fixtures are JSON files defining malicious input strings, required configuration shapes, and expected output conditions. These fixtures will be consumed by TV1 and TV3 test runners.

## Goals / Non-Goals

**Goals:**
- Establish a uniform JSON schema for adversarial test cases so the TV1/TV3 test runner can iterate them easily.
- Define the exact payload shapes for PATH, REG, SNAP, CONTENT, CAP, DISC, and NATIVE cases as defined in the `adversarial-acceptance-catalog.md`.
- Define redaction test cases as defined in `data-classification.md`.

**Non-Goals:**
- Do not write a test runner.
- Do not implement the runtime boundary logic.

## Decisions

- **Fixture Format:** Standard JSON arrays (`.json`) will be used to allow easy cross-language parsing.
- **Fixture Schema:**
  Each adversarial case will follow a unified structure:
  ```json
  {
    "category": "PATH",
    "id": "PATH-001",
    "payload": "/etc/passwd",
    "expected_error": "path_denied",
    "expected_event": "security.blocked"
  }
  ```
- **Redaction Schema:**
  ```json
  {
    "input": "My token is AWS-XYZ",
    "expected_redacted": "My token is <REDACTED_SECRET>"
  }
  ```
- **Location:** Fixtures will be stored in a new `runtime/tests/adversarial/fixtures/` directory.

## Risks / Trade-offs

- Changes in the tool schemas (by TV3) may require updates to these fixtures if the JSON shapes are highly coupled to the tool call syntax. We mitigate this by keeping the payloads as raw strings where possible.
