# ui-test-safety-net Specification

## Purpose

Defines the testing safety net specifications for the desktop client, ensuring that UI state stores, reducers, and report formatting utilities provide DOM-isolated, deterministic automated verification under headless test runners prior to any architectural refactoring.

## Requirements

### Requirement: Independent Unit Testing for UI State Store

The desktop client state store (`useRunStore`) SHALL provide testable state transitions without requiring browser DOM execution, supporting deterministic deduplication for tool calls and thought events.

#### Scenario: Deduplicating tool calls and thoughts in state store

- **GIVEN** a Zustand `useRunStore` instance initialized with an empty state
- **WHEN** multiple tool calls with identical IDs or thoughts with identical step indexes are appended
- **THEN** the store SHALL deduplicate entries and retain exactly one instance in memory.

### Requirement: DOM-Isolated Report Formatting Utilities

Export formatting functions for CSV and JSON SHALL be decoupled from browser DOM download side-effects to enable headless automated testing.

#### Scenario: Generating CSV and JSON string payloads

- **GIVEN** a collection of `RunSchema` objects with valid and invalid verdicts
- **WHEN** invoking `generateRunsCSV` or `generateRunsJSON` in a Node.js test environment
- **THEN** valid formatted strings SHALL be produced without throwing DOM-related reference errors.
