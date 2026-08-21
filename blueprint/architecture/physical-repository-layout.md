# Physical Repository Layout and Import Boundaries

Normative: yes  
Version: `physical-layout-v2`  
Owner: TV1; collaborators: TV2–TV6  
Decision: ADR-005 (`Accepted`), ADR-007 (`Accepted`)

## Target implementation tree

This is an ownership map for a later implementation change, not executable scaffolding produced by this blueprint.

```text
harness/
├── README.md
├── compose.yaml                         # developer entrypoint; not work authority
├── contracts/
│   ├── README.md
│   ├── registry.yaml
│   ├── openapi/local-runtime.v1.openapi.yaml
│   ├── schemas/
│   │   ├── shared/v1/
│   │   ├── run-control/v1/
│   │   ├── model-gateway/v1/
│   │   ├── source-access/v1/
│   │   ├── agent-runtime/v1/
│   │   ├── judge/v1/
│   │   ├── evaluation/v1/
│   │   └── scorer-only/v1/
│   └── examples/{valid,invalid}/
├── runtime/
│   ├── README.md
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── src/harness/
│   │   ├── shared_kernel/
│   │   ├── modules/
│   │   │   ├── run_control/
│   │   │   ├── model_gateway/
│   │   │   ├── source_access/
│   │   │   ├── agent_runtime/
│   │   │   ├── judge/
│   │   │   ├── evaluation/
│   │   │   └── scoring/
│   │   ├── platform/{configuration,database,observability,secrets,process_runtime}/
│   │   ├── entrypoints/{daemon,worker,evaluator,scorer}/
│   │   └── generated/contracts/
│   ├── migrations/{env.py,registry.py}
│   └── tests/
│       ├── architecture/
│       ├── modules/{run_control,model_gateway,source_access,agent_runtime,judge,evaluation,scoring}/
│       ├── contract/
│       ├── integration/
│       ├── adversarial/
│       └── e2e/
├── apps/desktop/
│   ├── README.md
│   ├── ui/
│   │   ├── package.json
│   │   ├── pnpm-lock.yaml
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── app/
│   │       ├── modules/{runs,judge,trace,settings,evaluation}/
│   │       ├── shared/{components,hooks,formatting,errors}/
│   │       └── generated/runtime-client/
│   ├── src-tauri/                       # Tauri 2 narrow Rust native host
│   │   ├── Cargo.toml
│   │   ├── Cargo.lock
│   │   ├── build.rs
│   │   ├── tauri.conf.json
│   │   ├── capabilities/
│   │   │   └── main-window.json         # explicit per-window allowlist
│   │   ├── permissions/
│   │   │   ├── runtime-bridge.toml
│   │   │   ├── repository-picker.toml
│   │   │   ├── notifications.toml
│   │   │   └── update-coordinator.toml
│   │   └── src/
│   │       ├── main.rs                  # Tauri executable bootstrap only
│   │       ├── lib.rs                   # command/plugin registration
│   │       ├── commands/                # typed renderer-to-native bridge
│   │       ├── runtime_supervision/     # discover/start-or-attach/status adapters
│   │       ├── credential_store/        # OS-protected custody; no plaintext fallback
│   │       ├── repository_picker/       # short-lived picker result only
│   │       ├── notifications/           # safe local projection only
│   │       └── update_coordinator/      # signed preflight/quiesce/rollback
│   ├── resources/{icons,static}/
│   └── tests/{unit,contract,e2e}/
├── config/{runtime,flags,providers,evaluation}/
├── datasets/{README.md,manifests,synthetic}/
├── packaging/
│   ├── local-runtime/{compose.yaml,env.example,healthcheck}/
│   └── desktop/{windows,macos,linux}/
├── docs/
├── blueprint/
└── openspec/
```

ADR-007 accepts this `src-tauri/` ownership shape, but the tree remains a future implementation map. This blueprint creates none of these files. No empty Rust, layer, capability, or platform directory is created merely to match the diagram.

## Desktop native-host boundary

`apps/desktop/ui/` owns presentation, generated-contract invocation and safe projection state. `apps/desktop/src-tauri/` owns only OS integration. The generated client uses an injected native transport that submits an allowlisted canonical operation identifier and validated payload; Rust derives the protected endpoint and credential and cannot accept an arbitrary URL, method, executable or filesystem path from rendered content.

Initial renderer-callable project commands are limited to runtime discovery/start-or-attach/status, allowlisted authenticated runtime transport, explicit repository selection, safe notifications and update check/preparation. Generic Tauri filesystem, shell, process, environment, opener/arbitrary-URL, raw secret and direct updater commands are not registered for the main window. Effective merged capabilities and custom-command exposure are reviewed, not inferred from file names or plugin defaults.

## Capability-local shape

```text
modules/<capability>/
├── public/          cross-capability commands, queries, events, value types
├── domain/          capability invariants and models
├── application/     use cases and workflows
├── ports/           required inbound/outbound abstractions
├── adapters/        capability-owned HTTP/DB/provider/filesystem implementations
└── resources/       owned prompts, schemas and static policy data
```

Only non-empty roles exist. `public` remains framework/SDK neutral.

## Capability ownership and public surface

| Capability | Owns | Initial public surface | Must not own |
|---|---|---|---|
| `run_control` | lifecycle, idempotency, job/outbox, claims, ordered events | `SubmitRun`, `ClaimWork`, `CancelRun`, `GetRun`, `ListRunEvents`, lifecycle events/IDs | provider mapping, source I/O, labels |
| `model_gateway` | profiles, normalized request/response, native fidelity, attempts/cost/errors | `InvokeModelOnce`, provider/profile/attempt types | loop continuation, tool execution, verdict meaning |
| `source_access` | registration, immutable snapshots, workspace, bounded tools/path security | `RegisterSource`, `ResolveSnapshot`, `DispatchSourceTool`, snapshot/evidence types | repository-picker UI, Judge semantics, labels |
| `agent_runtime` | committed-history turn loop, context, budgets, stop mechanics | `ExecuteAgentTurn`, `ContinueRun`, allocation/stop types | valid/invalid semantics, scorer access |
| `judge` | candidate, prompts/policy, verdict/evidence validation, Judge workflow | `StartJudge`, `ValidateVerdict`, candidate/verdict types | SDK/filesystem mechanics, labels |
| `evaluation` | profiles/protocol, arm schedule, manifests, aggregation/export | `ScheduleExperiment`, `AcceptApprovedScore`, safe experiment/result types | ground-truth resolution/credentials |
| `scoring` | labels/adjudication, post-terminal join, score computation | no general runtime consumer; scorer-root inputs only | agent/provider/API/desktop behavior |

## Allowed capability graph

| Importer | Allowed imports |
|---|---|
| `run_control` | shared kernel only |
| `model_gateway` | shared kernel only |
| `source_access` | shared kernel only |
| `agent_runtime` | `run_control.public`, `model_gateway.public`, `source_access.public` |
| `judge` | `run_control.public`, `agent_runtime.public`, `source_access.public` |
| `evaluation` | `run_control.public`, `judge.public`, `model_gateway.public`, `source_access.public` |
| `scoring` | `evaluation.public` only |

## Table and migration ownership

| Capability | Owned relational records | Migration contribution |
|---|---|---|
| `run_control` | `run`, `run_config`, `idempotency_record`, `work_item`, `outbox_record`, `work_claim`, `trajectory_event`, `security_event` | run lifecycle, ordering, lease/claim/CAS constraints |
| `model_gateway` | `provider_profile_ref`, `provider_attempt` | attempt uniqueness, usage/cost/native-identity constraints |
| `source_access` | `source_snapshot`, `source_registration`, managed-content metadata | immutable revision/inventory/tree digests and safe registration metadata; no raw host path |
| `agent_runtime` | `agent_step`, `context_allocation`, `tool_call` reference/projection | step/attempt ordering and budget evidence |
| `judge` | `candidate_finding`, `judge_verdict`, `verdict_evidence` | verdict/evidence semantic constraints |
| `evaluation` | `experiment`, `experiment_cell`, `approved_score`, `evaluation_export` | experiment identity/resume/export constraints |
| `scoring` | `ground_truth_label`, `adjudication`, `score_join` | scorer-only schema/role and post-terminal join constraints |

`runtime/migrations/registry.py` composes module metadata; it does not own business tables. Foreign identifiers are contract references, not permission for another module to issue direct table queries.

## Composition roots and deny matrix

| Entrypoint | May wire | Explicitly denied |
|---|---|---|
| `daemon` | run-control/source-registration/Judge/evaluation public API adapters | `scoring`, scorer schemas/credential/grants, provider direct calls |
| `worker` | run control, Judge, agent runtime, model gateway, source access | `scoring`, ground truth, desktop/shell |
| `evaluator` | evaluation plus allowed public dependencies | `scoring`, ground-truth adapter/credential, desktop internals |
| `scorer` | scoring and `evaluation.public` output adapter | agent runtime, provider invocation, source tools, run-event mutation |
| desktop renderer | generated local-runtime client plus allowlisted Tauri transport/picker/lifecycle commands | all Python internals, DB, provider/tools, scoring, ground truth, generic native authority |
| Tauri native host | OS integration and protected local transport only | Judge policy/state authority, provider/tools/scoring, raw renderer credential access |

## Generated contracts

`contracts/registry.yaml` is the exposure allowlist. The desktop generator reads only `contracts/openapi/local-runtime.v1.openapi.yaml` and cannot reach `schemas/scorer-only`. Pydantic/TypeScript outputs are reproducible projections and are never manually edited or treated as canonical.

## Future architecture checks

| Check | Fails when |
|---|---|
| `ARCH-IMPORT-01` | capability imports another capability outside `.public` |
| `ARCH-CYCLE-01` | allowed capability graph becomes cyclic |
| `ARCH-PUBLIC-01` | public type imports FastAPI, SQLAlchemy, provider SDK or native shell |
| `ARCH-OWNER-01` | table/migration lacks exactly one capability owner or is queried cross-capability |
| `ARCH-KERNEL-01` | shared kernel/platform contains business model, repository or policy |
| `ARCH-ENTRY-01` | entrypoint contains business decisions or is imported by a capability |
| `ARCH-SCORER-01` | non-scorer closure imports `scoring`, scorer schemas or credentials |
| `ARCH-GEN-01` | generated contract changed without canonical-source change or scorer-only type reaches desktop |
| `ARCH-DESKTOP-01` | renderer imports runtime internals or bypasses the generated client for Judge data |
| `ARCH-TAURI-01` | a window receives generic filesystem/shell/process/env/URL/credential/updater permission or an undeclared project command |
| `ARCH-TAURI-02` | native host contains Judge policy, accepts arbitrary endpoint/command input, or owns runtime/run lifetime |

## Track ownership

| Track | Primary capability/review responsibility |
|---|---|
| TV1 | `run_control`, `agent_runtime`, `judge`, `model_gateway`; graph approval |
| TV2 | context/budget internals inside `agent_runtime` |
| TV3 | tool registry/contracts inside `source_access` |
| TV4 | source/workspace security and scoring isolation review |
| TV5 | `evaluation`, scorer-method review, contract/statistical drift |
| TV6 | daemon/local API, persistence mechanics, desktop/client generation and Tauri native host |

Audit, long-term memory, compaction and `VerificationRunner` are future modules only after their own change. Judge authority is not widened to make room for them.
