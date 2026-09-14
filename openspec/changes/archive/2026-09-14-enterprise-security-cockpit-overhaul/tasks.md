# Tasks: Enterprise Security Cockpit Overhaul (TV6 Frontend Desktop UI/UX)

## Phase 1: Resilience & Slop Purge (P0)

- [x] 1.1 Standardize `apps/desktop/ui/src/index.css` to 5-tier typography tokens, strip all 50px neon keyframes, add `.max-w-prose`, and remove `hover-scale` from virtualized items.
- [x] 1.2 Eliminate all OS emojis (`⚡`, `🎬`, `📊`) across `TopNavigation.tsx`, replacing with 1.5px stroke Lucide SVGs.
- [x] 1.3 Fix hardcoded `estimatedTokenBudget = 50000` in `TraceView.tsx` to read dynamically from active run configuration.
- [x] 1.4 Add payload byte-size capping and safe line-by-line rendering in `ToolCallCard.tsx` with expandable full-view toggle to protect V8 main-thread layout against massive outputs.

## Phase 2: Auditor Ergonomics & Craftsmanship (P1)

- [x] 2.1 Constrain prose reading width in `ThoughtCard.tsx` to 800px (`max-w-prose`) with `--font-sans` styling to resolve >220 CPL line-length eye fatigue.
- [x] 2.2 Implement Datadog-style relative timeline deltas (`+Δt ms`) and compact tool status indicators in `TraceView.tsx`.
- [x] 2.3 Optimize `ToolCallCard.tsx` parameters and outputs presentation with clean structured panels.
- [x] 2.4 Refactor `VerdictBanner.tsx` and `DashboardView.tsx` for clean text-ellipsis, eliminate inline mouse handlers, and ensure full-bleed responsive layout.

## Phase 3: Dynamic Verification & OpenSpec Archival (P0)

- [x] 3.1 Run static analysis and automated test gates (`corepack pnpm run verify`) ensuring exit code 0.
- [x] 3.2 Execute automated browser verification suite on Edge CDP (1920x1080) and capture fresh visual evidence.
- [x] 3.3 Validate all OpenSpec specifications (`corepack pnpm dlx @fission-ai/openspec validate --specs`), sync deltas, and archive change proposal.
