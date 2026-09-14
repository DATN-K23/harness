# Change: Enterprise Security Cockpit Overhaul

## Why

The Audit Harness platform currently provides a solid foundation for autonomous AI judging, but audits by expert personas revealed 3 major structural limitations:

1. **Resilience & Chaos Vulnerabilities**: EventBus silently drops events under high throughput (`asyncio.QueueFull`), tab navigation unmounts active SSE streams, large files (10k lines) block the main thread, and token budgets are hardcoded (`50,000`).
2. **Visual AI-Slop & Typographic Fragmentation**: 50px diffuse neon keyframes, `hover-scale` transforms causing virtualizer jitter, 14 fragmented font sizes, emoji clutter, and unconstrained line lengths (>220 CPL) in thought prose.
3. **Smart Contract Auditor Capability Gaps**: Missing commit SHA pinning, compiler (`solc`) selector, RPC fork parameters, Solidity syntax highlighting with line numbers, deep IDE linking (`vscode://`), executable Foundry PoC exploit generation, and institutional audit report exports.

## What Changes

- **Track 1 (Resilience & Stream Integrity)**:
  - Implement a non-dropping circular sequence buffer with `seq_id` and backpressure in `runtime/src/harness/modules/events/bus.py`.
  - Lift SSE subscription management to a global store/service that persists across view navigation in `App.tsx`.
  - Persist `token_budget` in backend models and dynamically calculate quota in `TraceView.tsx`.
  - Implement windowed line-by-line rendering and byte-size limits for large code payloads in `ToolCallCard.tsx`.
- **Track 2 (Visual Craftsmanship & Anti-Slop)**:
  - Standardize `index.css` to a strict 5-tier typographic scale (`11px`, `12px`, `13px`, `14px`, `16px`) and eliminate all 50px diffuse neon glows.
  - Strip `hover-scale` transforms from virtualized rows.
  - Replace all OS emojis with unified 1.5px stroke Lucide SVG icons.
  - Constrain `ThoughtCard` prose reading width to 800px (`max-w-prose`) and add relative timeline deltas (`+Δt ms`).
- **Track 3 (Security Auditor Tooling & PoC Rigor)**:
  - Upgrade `JudgeForm.tsx` with commit hash pinning, compiler version selector, RPC fork URL, and finding context input.
  - Integrate syntax-highlighted Solidity / JSON code viewer with line numbers and copy utilities.
  - Add deep linking protocol (`vscode://file/...` and `cursor://file/...`) on evidence paths.
  - Implement Foundry PoC exploit contract generator (`ExploitTest.t.sol`) with runnable sandbox integration.
  - Implement Lead Security Researcher (LSR) verdict endorsement/override workflow.
  - Author institutional-grade Markdown and PDF client audit report generators.

## Impact

- Frontend: `apps/desktop/ui/src/` (Components, stores, design tokens).
- SDK & Contracts: `packages/contracts/`, `packages/sdk/` (Extended finding payload, token budget schema, PoC contracts).
- Runtime Daemon: `runtime/src/harness/` (EventBus ring buffer, token budget persistence).
