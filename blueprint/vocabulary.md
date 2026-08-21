# Canonical Vocabulary and Identifier Registry

Normative: yes  
Version: `blueprint-vocabulary-v3`  
Owner: TV1; collaborators: TV2–TV6

## Core and architecture terms

| Term | Canonical meaning | Forbidden ambiguity |
|---|---|---|
| `Harness` | Provider-neutral project-owned orchestration around a model. | The model/provider/desktop is not the Harness. |
| capability | Cohesive business responsibility with owned public contract, logic, ports, adapters/resources and persistence. | Not a process, horizontal layer or automatically a service/repository. |
| capability-first modular monolith | One coordinated Python codebase/release organized first by business capability, with only public cross-capability imports. | Not layer-first, microservices or a monorepo of independent services. |
| shallow hexagonal boundary | Add domain/application/ports/adapters inside a capability only when non-empty and useful. | No ceremonial folder requirement. |
| local runtime | Headless daemon/worker/evaluator/scorer processes plus PostgreSQL from one coordinated modular-monolith release. | Desktop window/process is not runtime authority. |
| desktop | Downloadable thin renderer/native shell using only generated local-runtime API plus narrow OS integration. | Not a web service, DB client, provider client or tool host. |
| Tauri 2 native host | Narrow Rust process under future `apps/desktop/src-tauri/` that owns allowlisted OS integration and protected transport to the local runtime. | Not the Python runtime, business orchestrator, generic native bridge or execution authority. |
| renderer-to-native capability | Per-window allowlist joining a Tauri command permission with its allowed scope. | Not implicit access to filesystem, shell, process, environment, URLs, secrets or updater primitives. |
| runtime supervisor | OS-appropriate independent owner of daemon/worker/evaluator/scorer lifetime that survives renderer and Tauri-host exit. | The Tauri child-process lifetime is not runtime authority. |
| update coordinator | Project control plane that validates signed desktop/runtime artifacts, compatibility manifest, active work, migration safety, health and rollback. | Not a renderer-selected artifact URL/key or direct updater invocation. |
| `JudgeRun` | One asynchronous evaluation of one `CandidateFinding` against one `SourceSnapshot`. | Session, queue delivery, attempt and experiment cell are distinct. |
| `CandidateFinding` | Canonical agent-visible untrusted allegation to classify. | Never ground truth. |
| `SourceSnapshot` | Opaque immutable managed source identity/revision/inventory/tree digest imported by `source_access`. | Never the raw selected host path. |
| `Trajectory` | Ordered append-only exact sanitized model-visible/run events for one run. | Not ordinary mutable logs and contains no scoring event. |
| `ProviderAttempt` | One externally observable invocation attempt with identity, usage, latency, cost and outcome. | SDK-hidden retry is forbidden; retry is not a new run. |
| `GroundTruthLabel` | Scorer-only official normalized validity/severity. | Never enters evaluator/Judge/provider/tool/desktop paths. |
| `ApprovedScoreV1` | Label-free versioned scorer output accepted through `evaluation.public`. | Not a label, adjudication or run event. |
| `VerificationRunner` | Future separately isolated PoC capability/entrypoint. | Not a Judge tool or MVP implementation. |

## Capability and process names

Capabilities: `run_control`, `model_gateway`, `source_access`, `agent_runtime`, `judge`, `evaluation`, `scoring`. Public imports use `harness.modules.<capability>.public`.

Composition roots/process identities: `daemon`, `worker`, `evaluator`, `scorer`. `verifier` is future only. `desktop` contains a renderer and the ADR-007-selected Tauri 2 native host; neither is a Python runtime composition root.

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

`run.accepted`, `run.queued`, `run.started`, `context.allocated`, `context.transformed`, `provider.attempted`, `provider.failed`, `model.responded`, `tool.requested`, `tool.completed`, `tool.failed`, `security.blocked`, `verdict.validation_failed`, `run.cancel_requested`, `run.completed`, `run.failed`, `run.cancelled`, `run.budget_exhausted`.

Scoring/ApprovedScore is evaluation-owned post-terminal state and is deliberately absent from this vocabulary.

## Identifiers and references

| Identifier | Form/identity rule |
|---|---|
| `run_id`, `event_id`, `work_id`, `claim_id` | Opaque runtime-generated strings; event order is `(run_id, sequence)`. |
| `candidate_finding_id` | Opaque canonical content registry identifier. |
| `source_snapshot_id` | Opaque managed snapshot identifier; never encodes host path. |
| `contest_id`, `source_family_id`, `case_id` | Stable frozen dataset namespace identifiers. |
| `experiment_id` | Digest identity bound to experiment/provider/manifest profiles. |
| `experiment_cell_id` | Digest of experiment, case, arm and repeat. |
| `pair_id` | Digest of experiment, case and repeat containing both arms. |
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

## Verdict and evaluation vocabulary

- `valid` severity: `low|medium|high|critical`; `invalid` severity: `none`.
- Judge `verification_status` is exactly `unverified`; completed means schema/evidence valid, not PoC verified.
- Arms: `direct`, `harness`; primary flags presets: `direct-primary-v1`, `harness-primary-v1`.
- Splits: `train`, `validation`, `test`; assignment units are whole contest and source family.
- Cutoff buckets: `pre_cutoff`, `post_cutoff`, `unknown`.
- Repeat measures within-case variability; contest is primary uncertainty cluster.
- RQ1 classifications: `positive`, `negative`, `mixed`, `inconclusive`; recall or completion gate failure yields `mixed`.
- `Accepted` ADR methodology is distinct from `Proposed`/`Accepted` concrete provider or experiment profile.
