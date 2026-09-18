# Judge Mode MVP Blueprint

Status: `Validated blueprint`  
Version: `judge-blueprint-v4`  
Owners: TV1–TV6  
OpenSpec change: `blueprint-consolidation`

> Blueprint only — no implementation evidence. This package defines future architecture, contracts, security, evaluation and delivery acceptance. It contains no application/test/migration/infrastructure source and proves no service, desktop build, provider call or contest result exists.

## What is decided

- Capability-first Python modular monolith with shallow hexagonal boundaries.
- Local runtime release with separate daemon, worker, evaluator, and scorer entrypoints; PostgreSQL is authoritative.
- Downloadable React/TypeScript/Vite desktop as a thin generated-client consumer.
- Tauri 2 narrow Rust native host with explicit per-window permissions.
- Official asynchronous OpenAI Responses SDK as the first real adapter.
- Matched direct-versus-harness RQ1 methodology, whole-contest plus source-family splits, scorer isolation.

## Non-negotiable invariants

1. Ground truth, labels, adjudication and scorer detail have no edge into Judge request/context/provider/tool/workspace/run event/log/desktop paths.
2. The native picker path is ephemeral registration-only input. Runtime imports a managed immutable snapshot.
3. Judge runtime structurally has no shell, mutation, process, package/VCS, network/URL, hosted tool, plugin discovery, arbitrary execution or PoC capability.
4. Every optional result-affecting behavior has a stable flag, telemetry, immutable snapshot value and enabled/disabled acceptance IDs; safety invariants are not disableable.
5. Every run records model/profile and prompt versions/digests, resolved flags, native/logical tokens, separated latency, decimal cost/pricing and ordered tool calls.
6. Train may shape behavior, validation may select profile values, and frozen test cannot feed adaptation.
7. PostgreSQL run/work/outbox/claim/event state survives desktop/daemon/worker restarts.
8. `scoring` is composed only by the scorer process and depends one-way on `evaluation.public`.
9. Judge verdicts remain `unverified`; future PoC execution belongs to a separate `VerificationRunner` change/process.

## Package map (New Consolidated Layout)

```text
blueprint/
├── README.md, vocabulary.md
├── decisions/       ADR-001..007 consolidated into architecture-decisions.md
├── architecture/    system-overview.md, module-layout.md, sequences.md
└── evaluation/      methodology.md, experiment-profile.md
```

## How to read

1. Read `vocabulary.md` to understand the domain terms.
2. Read `decisions/architecture-decisions.md` for historical ADR context.
3. Use `architecture/system-overview.md` and `architecture/module-layout.md` for structure and boundaries.
4. Use `architecture/sequences.md` to understand runtime behavior and end-to-end flows.
5. Review `evaluation/methodology.md` for the core scoring rules and baseline protocol.
6. Review `evaluation/experiment-profile.md` for specific experiment configurations.

## Old-to-New Path Mapping Table

| Cũ (97 files) | Mới (<10 files) | Lý do |
| --- | --- | --- |
| `architecture/*` | `architecture/` (3 files) | Gộp thành system-overview.md, module-layout.md, sequences.md |
| `persistence/*` | `architecture/system-overview.md` | Gộp vào system-overview |
| `desktop/*` | `architecture/system-overview.md` | Gộp vào system-overview |
| `security/*` | `architecture/module-layout.md` | Xóa boilerplate, chỉ giữ Ground-Truth Isolation |
| `decisions/ADR-*` | `decisions/architecture-decisions.md`| Gộp tất cả ADR thành 1 file duy nhất |
| `evaluation/*` | `evaluation/` (2 files) | Gộp thành methodology.md và experiment-profile.md |
| `evaluation/examples/`, `evaluation/prompts/` | Xóa | Giữ inline trong methodology.md |
| `contracts/*`, `providers/*` | Xóa | Sẽ định nghĩa lại khi implement |
| `delivery/*` | Xóa | Traceability metadata được xử lý qua công cụ/Openspec |
| `manifest.yaml`, `manifest-format.md` | Xóa | Dư thừa |
