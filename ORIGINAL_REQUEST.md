# Original User Request

## 2026-09-14T08:28:41Z

Full multi-agent team (Product UX/UI Designer, Frontend Engineer, Adversarial QA Auditor).

Working directory: /mnt/Data/Backup_Nguyen/Workspaces/DATNK23/harness
Integrity mode: development

## Product Vision & Goal

Transform the Audit Harness desktop application into an elite, production-grade AI Security Audit Cockpit. The interface must deliver the visual density, craftsmanship, and operational clarity of high-end developer instruments (such as Linear, Sentry, and Datadog), eliminating amateur web-form layouts and generic AI patterns.

The multi-agent team must operate with strict separation of duties: independent design and implementation, adversarial UI/UX auditing, and empirical browser-based verification to ensure the product meets uncompromising taste and engineering standards.

## Requirements

### R1. High-Density Security Cockpit Experience

- The user interface must function as a full-screen desktop instrument utilizing 100% of available screen real estate without unused margins or floating card containers.
- The layout must provide a clear separation between operational controls (target configuration, model settings, quota telemetry) and live execution monitoring (sandboxed execution blueprints, real-time trajectory streaming, verdict analysis).
- Information density, typography hierarchy, contrast ratios, and interactive states (loading, error, empty, active execution) must adhere to professional security tooling standards.

### R2. Comprehensive Edge Case & Error Resilience

- The interface must gracefully handle real-world operational states: empty inputs, invalid repository URLs, malformed finding IDs, API disconnects, token exhaustion, and long-running trajectory streams with thousands of tokens.
- All validation feedback, telemetry metrics, and status badges must be unambiguous, actionable, and visually cohesive.

### R3. Adversarial Cross-Verification & Quality Governance

- The codebase must compile cleanly with zero stale distribution artifacts, zero type errors, and automated clean build cycles.
- Verification must be conducted by independent auditor subagents using automated browser instrumentation (CDP at 1920x1080 resolution) to capture empirical evidence of layout geometry, visual balance, and interactive flows.
- Self-certification is strictly prohibited: the implementing agent cannot approve its own visual or functional quality.

## Acceptance Criteria

### Visual Craftsmanship & Layout Geometry

- [ ] The desktop application fills the entire viewport with zero wasted horizontal void on widescreen displays (1920x1080).
- [ ] Navigation and dual-pane views allow simultaneous visibility of parameters and live telemetry without layout shifts.
- [ ] Visual styling reflects high-craftsmanship standards: refined dark mode palette, crisp monospace telemetry, subtle border treatments, and zero generic template artifacts.

### Functional Completeness & Error States

- [ ] All primary flows (Run Configuration, Live Stream Monitoring, Historical Analytics) render complete, polished states for both populated data and empty/error conditions.
- [ ] Live streaming views remain performant and responsive under high-frequency event streaming.

### Automated Quality Gates

- [ ] `corepack pnpm --filter @audit-harness/web run build` succeeds cleanly with exit code 0.
- [ ] Automated browser test suite passes with exit code 0 and produces fresh full-resolution verification artifacts.
- [ ] Independent reviewer agent signs off on UI taste, UX ergonomics, and code architecture.
