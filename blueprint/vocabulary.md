# Canonical Vocabulary and Identifier Registry

Normative: yes  
Version: `vocabulary-v2`
Requirements: API-08–API-10, EVAL-11

## Core and architecture terms

| Term | Canonical meaning | Forbidden ambiguity |
|---|---|---|
| `Harness` | Provider-neutral project-owned orchestration around a model. | The model/provider/desktop is not the Harness. |
| capability | Cohesive business responsibility with owned public contract, logic, ports, adapters/resources and persistence. | Not a process, horizontal layer or automatically a service/repository. |
| package-based TypeScript monorepo | One coordinated TypeScript/Bun codebase/release organized by package, with only public cross-package imports. | Not a single unstructured project, layer-first, microservices or a monorepo of independent services. |
| shallow hexagonal boundary | Add domain/application/ports/adapters inside a capability only when non-empty and useful. | No ceremonial folder requirement. |
| local runtime | Headless daemon/worker/evaluator/scorer processes plus PostgreSQL from one coordinated modular-monolith release. | Desktop window/process is not runtime authority. |
| desktop | Downloadable thin renderer/native shell using only generated local-runtime API plus narrow OS integration. | Not a web service, DB client, provider client or tool host. |
| Tauri 2 native host | Narrow Rust process under future `apps/desktop/src-tauri/` that owns allowlisted OS integration and protected transport to the local runtime. | Not the local runtime, business orchestrator, generic native bridge or execution authority. |
| renderer-to-native capability | Per-window allowlist joining a Tauri command permission with its allowed scope. | Not implicit access to filesystem, shell, process, environment, URLs, secrets or updater primitives. |
| runtime supervisor | OS-appropriate independent owner of daemon/worker/evaluator/scorer lifetime that survives renderer and Tauri-host exit. | The Tauri child-process lifetime is not runtime authority. |
| update coordinator | Project control plane that validates signed desktop/runtime artifacts, compatibility manifest, active work, migration safety, health and rollback. | Not a renderer-selected artifact URL/key or direct updater invocation. |
| `JudgeRun` | One asynchronous analysis of one `CandidateFinding` against one `SourceSnapshot`. | Session, queue delivery, and attempt are distinct. |
| `AuditRun` | One asynchronous autonomous security exploration of a `SourceSnapshot` producing an `AuditReport`. | Not a single-finding verification. |
| `Finding` | An identified vulnerability or issue in the audited smart contract. | Not a ground truth label or benchmark case. |
| `AuditReport` | Structured compilation of all discovered and classified findings from an AuditRun. | Not raw conversational chat logs. |
| `CandidateFinding` | Canonical agent-visible untrusted allegation to classify (used in Judge Mode). | Never ground truth. |
| `SourceSnapshot` | Opaque immutable managed source identity/revision/inventory/tree digest imported by `source_access`. | Never the raw selected host path. |
| `Trajectory` | Ordered append-only exact sanitized model-visible/run events for one run. | Not ordinary mutable logs. |
| `ProviderAttempt` | One externally observable invocation attempt with identity, usage, latency, cost and outcome. | SDK-hidden retry is forbidden; retry is not a new run. |
| `Audit Mode` | Autonomous agentic search mode to find novel vulnerabilities in a codebase. | Not simply interacting with code; implies autonomous security review. |
| `Judge Mode` | Mode for filtering, deduplicating, and verifying a provided set of candidate findings. | Not an evaluation/scoring of the AI itself. |


## Capability and process names

Capabilities: `run_control`, `model_gateway`, `source_access`, `agent_runtime`, `judge`, `audit`. Cross-package imports use the TypeScript monorepo packages `@harness/<package>` (e.g., `@harness/core`, `@harness/llm`, `@harness/protocol`, `@harness/schema`, `@harness/server`).

Composition roots/process identities: `daemon` (or local API server), `worker`. `desktop` contains a web renderer and the ADR-007-selected Tauri 2 native host; neither is a local runtime composition root.

## Run and connection states

Run states: `accepted`, `queued`, `running`, `completed`, `failed`, `cancelled`, `budget_exhausted`. First three are non-terminal; final four are immutable terminal.

Desktop connection states: `runtime_starting`, `ready`, `runtime_unavailable`, `unauthorized_local`, `incompatible_version`, `reconnecting`. They never overwrite a run state.

## Terminal/error reasons

| Namespace | Canonical values |
|---|---|
| budget | `max_steps`, `total_tokens`, `wall_clock`, `no_progress`, `context_budget`, `cost_budget` |
| provider/profile | `pre_network_profile_rejected`, `pre_network_experiment_rejected`, `provider_permanent`, `provider_transient_primary`, `provider_retries_exhausted`, `attempt_outcome_unknown` |
| contract | `invalid_input`, `schema_repair_exhausted`, `evidence_invalid`, `incompatible_version` |
| security/source | `source_registration_denied`, `snapshot_integrity`, `workspace_preflight` |
| operator/infrastructure | `cancelled_by_user`, `work_handoff_failure`, `persistence_failure`, `worker_interrupted` |

## Run event types

`run.accepted`, `run.queued`, `run.started`, `context.allocated`, `context.transformed`, `provider.attempted`, `provider.failed`, `model.responded`, `tool.requested`, `tool.completed`, `tool.failed`, `security.blocked`, `finding.discovered`, `finding.validated`, `verdict.validation_failed`, `run.cancel_requested`, `run.completed`, `run.failed`, `run.cancelled`, `run.budget_exhausted`.



## Identifiers and references

| Identifier | Form/identity rule |
|---|---|
| `run_id`, `event_id`, `work_id`, `claim_id` | Opaque runtime-generated strings; event order is `(run_id, sequence)`. |
| `candidate_finding_id` | Opaque canonical content registry identifier. |
| `source_snapshot_id` | Opaque managed snapshot identifier; never encodes host path. |
| artifact/profile reference | ID + immutable version + `sha256:` content digest. |
| `content_digest` | `sha256:<64 lowercase hex>` over defined canonical/exact bytes. |
| cursor | Opaque finite-page token bound to run/sequence/policy; clients do not construct it. |

## Scalar conventions

| Concept | Representation |
|---|---|
| timestamp | UTC RFC 3339 with `Z`; persistence precision declared |
| duration/latency | integer milliseconds with `_ms`; queue/provider/tool/end-to-end remain separate |
| native token usage | Lossless safe provider categories, including cache/reasoning when exposed |
| logical token usage | Every input/output token sent across calls, including repeated/cached model-visible context |
| money | Non-negative decimal string + ISO 4217 currency + pricing version; no binary float |
| relative source path | UTF-8 POSIX form without leading slash, `.`, `..` or host-root encoding |
| native selected path | `EPHEMERAL_SENSITIVE` source-registration input only; never persisted/hashed into run data |
| line span | One-based inclusive `start_line`, `end_line` |


