## ADDED Requirements

### Requirement: Modular Presentation and Trace Hook Separation

The Desktop UI `TraceView` SHALL consume execution traces and verdicts through a dedicated custom hook (`useTraceData`) that unifies live SSE streaming and offline demo replay, while providing WCAG 2.1 AA accessible keyboard navigation and semantic structure.

#### Scenario: Subscribing and navigating trace timeline via keyboard

- **GIVEN** a user inspecting an active audit run in `TraceView` or browsing previous runs in `DashboardView`
- **WHEN** user interacts using keyboard navigation (`Tab`, `Enter`, `Space`)
- **THEN** all interactive controls SHALL exhibit high-visibility focus rings (`:focus-visible`)
- **AND** table columns SHALL provide semantic `scope="col"` headers for screen readers.
