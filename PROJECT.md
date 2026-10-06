# Project: AI Security Audit Cockpit

## Architecture

- **Web Application Root**: `apps/desktop/ui` (`@audit-harness/web`)
- **Technology Stack**: React 18, TypeScript 5, Vite 6, Tailwind CSS 3, Zustand 5, Lucide React, `@tanstack/react-virtual`
- **Component Geometry**:
  - Full-screen desktop instrument: $100\text{vw} \times 100\text{vh}$ (`h-screen w-screen overflow-hidden`)
  - Fixed Top Navigation: $48\text{px}$ height
  - Dual-Pane Primary Grid:
    - Left Operational Controls Pane: $420\text{px}$ width (fixed/collapsible)
    - Center-Right Live Execution & Telemetry Deck: Remaining viewport ($1500\text{px}$ on $1920\text{px}$ monitor)
  - Docked Bottom Transport Bar: $40\text{px}$ height (docked flush to viewport bottom)
- **Data Flow**:
  - User configuration & control via Zustand store (`useRunStore`)
  - Live execution streaming via SSE client (`useAuditHarnessClient` -> `EventSource`)
  - Dynamic virtualized rendering via `@tanstack/react-virtual`

## Feature Inventory

| #   | Feature                                | Description                                                                           | Milestone | Source                    |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------- | --------- | ------------------------- |
| 1   | Full 1920x1080 Viewport Geometry       | Zero dead horizontal void (<5%), remove 1200px hardcoded constraints                  | M1        | ORIGINAL_REQUEST §R1      |
| 2   | Dual-Pane Operational Cockpit          | Simultaneous visibility of parameter controls and live trajectory telemetry           | M1        | ORIGINAL_REQUEST §R1      |
| 3   | Docked Transport Status Bar            | Docked flush 40px replay bar replacing floating pill overlay                          | M1        | ORIGINAL_REQUEST §R1      |
| 4   | High-Density Design System Tokens      | Slate-zinc dark mode tokens, WCAG AA compliant muted text, zero amateur cards         | M1        | ORIGINAL_REQUEST §R1      |
| 5   | Virtualized Trajectory Streaming       | Integration of `@tanstack/react-virtual` in TraceView for 500+ events at 60fps        | M2        | ORIGINAL_REQUEST §R1, §R2 |
| 6   | Crisp Monospace Telemetry & SVG Icons  | `tabular-nums` monospace metrics and Lucide SVG icons replacing emojis                | M2        | ORIGINAL_REQUEST §R1      |
| 7   | Trajectory Event Filter Tabs           | Quick filtering across All, Tool Calls, Thoughts, and Errors                          | M2        | ORIGINAL_REQUEST §R1      |
| 8   | Robust Input Validation & Sanitization | RFC-compliant URL validation and finding ID regex sanitization                        | M3        | ORIGINAL_REQUEST §R2      |
| 9   | Comprehensive Error & Empty States     | Dedicated cockpit visual states for empty data, token exhaustion, and API failure     | M3        | ORIGINAL_REQUEST §R2      |
| 10  | Reactive Daemon Health & Timeouts      | Dynamic pinging of `:3000/api/v1/health` with bounded fetch timeouts                  | M3        | ORIGINAL_REQUEST §R2      |
| 11  | 4-Tier E2E Test Suite                  | Opaque-box tests covering T1 (Features), T2 (Edge Cases), T3 (Pairs), T4 (Real-world) | M-TEST    | ORIGINAL_REQUEST §R3      |
| 12  | Automated Browser CDP Verification     | Headless browser execution at 1920x1080 with 5 visual artifacts & void metrics        | M-TEST    | ORIGINAL_REQUEST §R3      |
| 13  | E2E Acceptance & Adversarial Hardening | Pass 100% E2E tests, Tier 5 adversarial hardening, zero defects                       | M4        | ORIGINAL_REQUEST §R3      |

## Milestones

| #      | Name                                        | Scope                                                                                                  | Dependencies       | Status      |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------ | ----------- |
| M-TEST | E2E Test Track & Automated CDP Verification | 4-Tier test suite (22 tests) & automated browser verification script at 1920x1080 generating artifacts | None               | DONE        |
| M1     | Core Cockpit Shell & Layout Geometry        | 1920x1080 zero-margin dual-pane layout, docked transport bar, dark mode tokens                         | None               | IN_PROGRESS |
| M2     | Virtualized Streaming & Telemetry           | TraceView `@tanstack/react-virtual` integration, event filters, monospace typography                   | M1                 | IN_PROGRESS |
| M3     | Edge Cases, Error Resilience & Health       | Input validators, token budget metrics, error boundaries, reactive daemon health                       | M1                 | IN_PROGRESS |
| M4     | E2E Test Pass & Adversarial Hardening       | Pass 100% E2E tests, Tier 5 adversarial hardening, zero defects                                        | M-TEST, M1, M2, M3 | PLANNED     |

## Interface Contracts

### Operational Controls (`JudgeForm`) ↔ Live Deck (`TraceView`)

- State managed through `useRunStore`:
  - `activeRunId`: string | null
  - `runStatus`: "idle" | "running" | "completed" | "failed"
  - `params`: `{ repo: string, findingId: string, model: string, tokenBudget: number }`
  - `events`: Array<ThoughtEvent | ToolCallEvent>
  - `stats`: `{ totalTokens: number, toolCount: number, durationMs: number }`

### Top Navigation (`TopNavigation`) ↔ App Shell (`App`)

- View mode switcher (`cockpit` dual-pane vs `dashboard` historical analytics)
- Mode switcher (`live` daemon connection vs `demo` replay fixture)
- Daemon health status indicator (`online` | `offline` | `checking`)

### Test Runner ↔ Cockpit Web App

- Web URL: `http://localhost:5173` (Vite dev server)
- Window Dimensions: $1920 \times 1080$ viewport
- Empirical Verification Artifacts:
  - `docs/050-testing/screenshots/cockpit_1920x1080_dualpane.png`
  - `docs/050-testing/screenshots/cockpit_1920x1080_stream.png`
  - `docs/050-testing/screenshots/cockpit_1920x1080_error_states.png`
  - `docs/050-testing/screenshots/cockpit_1920x1080_dashboard.png`
  - `docs/050-testing/metrics/test-metrics-1920x1080.json`

## Code Layout

- Root: `apps/desktop/ui/src`
- App Shell: `apps/desktop/ui/src/App.tsx`
- Layout Components: `apps/desktop/ui/src/components/layout/`
  - `TopNavigation.tsx`
  - `CockpitShell.tsx` (new dual-pane frame container)
- Operational Pane: `apps/desktop/ui/src/components/judge/JudgeForm.tsx`
- Live Execution Deck: `apps/desktop/ui/src/components/trace/TraceView.tsx`
  - `VirtualEventList.tsx` (new TanStack virtualized list)
  - `ThoughtCard.tsx`
  - `ToolCallCard.tsx`
  - `VerdictBanner.tsx`
- Replay Controller: `apps/desktop/ui/src/components/demo/ReplayController.tsx` (docked bottom bar)
- Analytics Dashboard: `apps/desktop/ui/src/components/dashboard/DashboardView.tsx`
- Store: `apps/desktop/ui/src/stores/run.store.ts`
- Design Tokens & Styles: `apps/desktop/ui/src/index.css`
- E2E Tests: `tests/e2e/cockpit.e2e.spec.ts` & `scripts/verify_cockpit_browser.ts`
