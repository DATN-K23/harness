# Decision Registry

Normative: yes  
Version: `decision-registry-v3`  
Owner: TV1  
Template: [ADR-000-template.md](ADR-000-template.md)

## Status rules

- `Proposed`: recommendation exists; approval gate remains open.
- `Accepted`: named approvers and evidence are recorded.
- `Superseded`: replacement ADR identifier is recorded.
- `Rejected`: rationale is retained; the identifier is never reused.

No elapsed time, implementation activity, or blueprint completion changes an ADR to `Accepted` automatically.

## Registry

| ADR | Decision | Status | Owner | Required approval | Affected work packages |
|---|---|---|---|---|---|
| ADR-001 | Technology stack family | Accepted | TV1/TV6 | Superseding ADR for stack-family change | WP-01–WP-10 |
| ADR-002 | Direct official SDK behind project provider port | Accepted | TV1/TV5 | Superseding ADR for integration-strategy change; profile approval remains separate | WP-03, WP-04, WP-08 |
| ADR-003 | Matched-pair direct-versus-harness methodology | Accepted | TV5 | Superseding ADR for methodology change; experiment-profile approval remains separate | WP-08, WP-09 |
| ADR-004 | OpenCode reference disposition | Accepted | TV1/TV6 | New version for a newer snapshot; superseding ADR for source reuse | WP-01–WP-07 |
| ADR-005 | Capability-first modular monolith | Accepted | TV1 | Superseding ADR for organizing axis/service split | WP-01–WP-10 |
| ADR-006 | Downloadable desktop plus local runtime | Accepted | TV6/TV1 | Superseding ADR for product/process topology | WP-01, WP-02, WP-05–WP-10 |
| ADR-007 | Tauri 2 native desktop shell/signing/updater boundary | Accepted | TV6 | Superseding ADR for host/boundary change; WP-01/WP-10 readiness still required | WP-01, WP-07, WP-10 |

## Approval evidence

An accepted decision must record approver identities/roles, date, reviewed version/digest, evidence links, and any conditions. A conversation summary without artifact version is insufficient.

## Separate profile gates

| Profile | Status | Blocks while open |
|---|---|---|
| `providers/real-primary.profile.yaml@1` | Proposed; `network_ready: false` | SDK client construction, credential access, network/paid real-provider calls |
| `evaluation/rq1-confirmatory-v1.profile.yaml@1` | Proposed; `execution_ready: false` | frozen-test access and result-bearing/paid RQ1 execution |

ADR-002/003 acceptance does not upgrade either profile. Changed model/pricing/cutoff/experiment values version profiles; changed integration strategy or evaluation methodology requires a superseding ADR.
