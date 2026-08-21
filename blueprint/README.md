# Judge Mode MVP Blueprint

Status: `Validated blueprint`  
Version: `judge-blueprint-v3`  
Owners: TV1–TV6  
OpenSpec change: `bootstrap-judge-mode-mvp`

> Blueprint only — no implementation evidence. This package defines future architecture, contracts, security, evaluation and delivery acceptance. It contains no application/test/migration/infrastructure source and proves no service, desktop build, provider call or contest result exists.

## What is decided

- Capability-first Python modular monolith with shallow hexagonal boundaries: `run_control`, `model_gateway`, `source_access`, `agent_runtime`, `judge`, `evaluation`, `scoring`.
- One coordinated local runtime release with separate daemon, worker, evaluator and scorer entrypoints; PostgreSQL is authoritative.
- Downloadable React/TypeScript/Vite desktop as a thin generated-client consumer over protected loopback/OS IPC.
- Tauri 2 narrow Rust native host with explicit per-window permissions, independent runtime supervision, OS-protected credential custody and coordinated signed-update semantics.
- Official asynchronous OpenAI Responses SDK as the first real adapter behind `model_gateway.public`; no LiteLLM/proxy/hosted tools/provider-owned loop in MVP.
- Explicit committed-history agent loop, four read-only source tools, structured independently validated unverified verdict, ordered safe trajectory and async polling-first API.
- Matched direct-versus-harness RQ1 methodology, whole-contest plus source-family splits, scorer isolation and ablation-ready configuration.

Exact real model/SDK/cutoff/pricing/credential/budget approval and exact RQ1 cases/repeats/thresholds remain gated in Proposed profiles. ADR-007 accepts Tauri 2 at architecture-choice scope, but three-OS packaging/lifecycle/credential/update readiness remains unproven until the future WP-01/WP-10 spike passes.

## Non-negotiable invariants

1. Ground truth, labels, adjudication and scorer detail have no edge into Judge request/context/provider/tool/workspace/run event/log/desktop paths.
2. The native picker path is ephemeral registration-only input. Runtime imports a managed immutable snapshot; every later flow uses `source_snapshot_id` and digests.
3. Judge runtime structurally has no shell, mutation, process, package/VCS, network/URL, hosted tool, plugin discovery, arbitrary execution or PoC capability.
4. Every optional result-affecting behavior has a stable flag, telemetry, immutable snapshot value and enabled/disabled acceptance IDs; safety invariants are not disableable.
5. Every run records model/profile and prompt versions/digests, resolved flags, native/logical tokens, separated latency, decimal cost/pricing and ordered tool calls.
6. Train may shape behavior, validation may select profile values, and frozen test cannot feed adaptation; contest and source family never cross splits.
7. PostgreSQL run/work/outbox/claim/event state survives desktop/daemon/worker restarts; SQLite, Redis, renderer cache and process memory are not authorities.
8. `scoring` is composed only by the scorer process and depends one-way on `evaluation.public`; its only crossing is label-free `ApprovedScoreV1`.
9. Judge verdicts remain `unverified`; future PoC execution belongs to a separate `VerificationRunner` change/process.

## Authority order

When artifacts conflict, use: OpenSpec requirements/scenarios → canonical machine-readable contracts/profiles → normative Markdown → Accepted ADRs → Proposed ADRs → synthetic examples/wireframes. ADR-007 acceptance selects architecture but does not authorize code in this blueprint change or substitute for readiness evidence; Proposed provider/experiment profiles cannot authorize real execution.

## Package map

```text
blueprint/
├── README.md, vocabulary.md, manifest-format.md, manifest.yaml
├── decisions/       ADR-001..007 Accepted at their stated scopes
├── architecture/    capability graph, physical layout, trust/process/runtime/scorer views
├── contracts/       local OpenAPI, registry, provider/tool/context/verdict/event contracts
├── providers/       profile schema, Proposed real-primary, deterministic conformance
├── persistence/     PostgreSQL ERD, field dictionary, outbox/lease/CAS/recovery rules
├── security/        registration/workspace/data/scorer boundaries and adversarial catalog
├── evaluation/      methodology/profile/prompts/flags/splits/inference/scoring/examples
├── desktop/         connection, submission, trace, terminal and disclosure behavior
└── delivery/        ownership, timeline/work packages, traceability, scope and validation
```

The future implementation repository layout is fixed in `architecture/physical-repository-layout.md`: top-level `contracts/`, `runtime/`, `apps/desktop/`, `config/`, `datasets/`, `packaging/`, `docs/`, `blueprint/`, and `openspec/`. This blueprint does not create those implementation directories.

## How to read

1. Read `vocabulary.md`, then the ADR registry and ADR-005/006/007.
2. Use physical layout plus components/ownership to understand module placement and allowed imports.
3. Follow desktop/runtime topology, source registration, lifecycle and end-to-end sequences.
4. Review OpenAPI/JSON Schema together with semantic contracts and examples.
5. Follow provider and experiment profile gates before considering real execution.
6. Review evaluation validity and scorer/ground-truth isolation.
7. Use requirement traceability, backreferences, work packages/timeline and validation report as the handoff index.

## Decision/profile status

| Item | Status | Meaning |
|---|---|---|
| ADR-001..ADR-006 | Accepted at their stated architecture/methodology scope | Future implementation may follow them after package gates. |
| ADR-007 | Accepted at native-host architecture scope | Selects Tauri 2; packaged three-OS lifecycle/security/update readiness remains future evidence. |
| `real-primary@1` | Proposed, `network_ready: false` | Any real-provider run is rejected before client/credential/network. |
| `rq1-confirmatory-v1@1` | Proposed, `execution_ready: false` | Any result-bearing RQ1 run is rejected before network/cost/test access. |
| deterministic profiles/examples | Blueprint validation only | Not scientific or implementation evidence. |

## Completion boundary

Blueprint completion means artifacts are internally coherent, content-addressed, traced to all 56 OpenSpec requirements and 61 Given/When/Then scenarios, and pass documentation validation. The change remains open as requested. Applying a later implementation change must scaffold and verify code against these contracts; applying this blueprint change never means code already exists.
