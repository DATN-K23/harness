# Blueprint Validation Report

Explanatory evidence: yes  
Version: `blueprint-validation-v3`  
Date: `2026-08-19`  
Owner: TV1; reviewers: TV2–TV6  
Scope: documentation-only `bootstrap-judge-mode-mvp`

## Outcome

`PASS — internally coherent implementation blueprint; ADR-007 architecture accepted; packaged readiness unproven; no implementation evidence.`

| Gate | Result | Evidence summary |
|---|---|---|
| OpenSpec strict conformance | PASS | `openspec validate bootstrap-judge-mode-mvp --strict`: change valid |
| Requirements/scenarios | PASS | 56 requirements and 61 Given/When/Then scenarios; 61 unique exact traceability rows including API-04/S2, API-10/S1–S2 and UI-06/S1–S2 |
| JSON/YAML/OpenAPI structure | PASS | 30 JSON and 6 YAML files parsed; 5 JSON Schemas meta-valid; 80 local OpenAPI refs resolved; 9 required paths and unique operations present |
| Schema examples | PASS | 19 expected pass/reject checks across verdict, trajectory, provider, experiment and contest-manifest fixtures |
| Content digests | PASS | 3 prompt refs, 4 experiment contract refs, SourceBundle and valid/unknown-cutoff manifest digests match exact bytes |
| Markdown links | PASS | every explicit local Markdown target and anchor exists |
| Source/evaluation validity | PASS | whole-contest/family leak rejection, test adaptation ban, primary retry symmetry/rejection, cluster/gate rules and `mixed` example |
| Raw-path/security boundary | PASS | `selected_path` only in registration input; absent from RunView/EventPage; managed snapshot-only later flow; four-tool immutable registry |
| Tauri native authority | PASS | per-window allowlists and typed project commands; generic filesystem/shell/process/environment/URL/secret/direct-updater authority denied |
| Generated-client Judge flow | PASS | renderer → injected Tauri transport → protected daemon API; no Python/DB/provider/tool/scorer bypass |
| Runtime/window lifecycle | PASS | independently supervised runtime survives renderer/Tauri close or crash; reconnect reads PostgreSQL-authoritative state |
| Credential custody | PASS | OS-protected adapter, rotation and fail-before-request behavior; no plaintext, renderer-storage or anonymous fallback |
| Coordinated update/rollback | PASS | signed artifact/OS signing, compatibility manifest, active/ambiguous work, reject/quiesce policy, DB compatibility, health and rollback modeled |
| Ground-truth/scorer isolation | PASS | no scoring run event/API route/desktop schema; one-way `scoring -> evaluation.public`; import/grant/generator negative plans |
| Capability/persistence topology | PASS | public-only dependency/table-owner matrices; PostgreSQL work/outbox/lease/CAS authority; no SQLite/Redis/cache/memory authority |
| OpenCode provenance/scope | PASS | pinned clean snapshot, evidence-only matrix, no dependency/copy/submodule/sync authorization |
| Manifest/scope | PASS | 97 blueprint files: 96 exact content digests plus self-excluded manifest; allowed documentation extensions; no symlink or implementation root |

## ADR and profile gate audit

| Artifact | Status | Validation conclusion |
|---|---|---|
| ADR-001 stack family | Accepted | Python runtime/PostgreSQL + React/TS/Vite renderer; blueprint only |
| ADR-002 integration strategy | Accepted | official async OpenAI Responses adapter behind project port; no gateway/hosted/provider loop |
| `real-primary@1` | Proposed, `network_ready: false` | schema-valid incomplete profile; rejected before client/credential/network |
| ADR-003 methodology | Accepted | matched logical-token/retry/split/inference methodology only |
| `rq1-confirmatory-v1@1` | Proposed, `execution_ready: false` | schema-valid incomplete profile; rejected before network/cost/frozen test |
| ADR-004 OpenCode reference | Accepted | reference/provenance only; no source/dependency reuse |
| ADR-005 capability-first monolith | Accepted | exact module/public/table/composition rules recorded |
| ADR-006 desktop/local runtime | Accepted | thin generated-client desktop; independent PostgreSQL runtime |
| ADR-007 native shell | Accepted (`adr-007-v2`) | Tauri 2 and least-authority boundary selected; ten-case WP-01/WP-10 three-OS readiness evidence remains unimplemented |

ADR-002/003 acceptance and concrete profile status are deliberately independent. ADR-007 acceptance also selects architecture only: it neither authorizes implementation in this change nor proves packaging, credential-backend, lifecycle, signing, updater or rollback readiness. A change to model/pricing/cutoff/experiment values versions a profile; a change to integration/methodology or native-host family requires a superseding ADR.

## Structured-contract checks

### Verdict and trajectory

- Verdict schema accepts valid and invalid classifications plus confidence boundary `0`/`1` examples.
- It rejects out-of-range confidence, invalid severity, missing evidence and path traversal.
- Trajectory schema accepts ordered safe fixture and rejects sequence zero, unknown raw event type and credential payload.
- `evaluation.scored` is absent from run event vocabulary/schema/example.

### Provider and experiment profiles

- Provider schema and Proposed `real-primary` validate; exact model/SDK/capability/cutoff/pricing/credential owner/paid ceiling/approvals remain null, so semantic readiness rejects it.
- Experiment schema accepts Proposed RQ1, synthetic complete Accepted and synthetic incomplete Proposed profiles.
- Accepted profile shape requires complete provider/prompt/schema/flag/bundle/scorer/manifest refs; repeat/schedule; logical-token/wall-clock; primary retry; contest-cluster method/confidence/seed/iterations; thresholds; execution window; paid approval.
- Prompt and contract content-addressed references match current exact bytes.
- Pre-network and retry-asymmetry examples record zero credential read, SDK construction, DNS/network and provider attempt where applicable.

### Evaluation validity

- Valid and unknown-cutoff manifests pass shape and canonical content digest.
- Multi-split contest fails JSON Schema; family split conflict passes shape but fails semantic membership/split validation; tampered content fails integrity.
- Primary direct/harness presets both set provider retry false, SDK retries zero and project attempts one. Retry-enabled research has a distinct preset/flag/snapshot/acceptance/experiment identity.
- Repeated/cached model-visible context counts logically; queue/provider/tool/end-to-end timing remains separate.
- Repeats remain within-case variability; contest-cluster confidence and source-family sensitivity are frozen profile fields.
- Precision gain cannot override recall/completion failure; concrete example classifies `mixed`.

### Local API, source, and scorer

- OpenAPI defines protected `/health`, `/runtime-info`, source registration, Judge submit/get/events/cancel and explicit shutdown/update-preparation operations.
- Runtime handshake carries instance/runtime/API/build versions, contract digest, capabilities including coordinated-update support, health and safe recovery action.
- `selected_path` is write-only `EPHEMERAL_SENSITIVE` registration input and is structurally absent from run/event response schemas.
- Desktop generation source/destination, public allowlist, scorer-only denylist and drift checks are explicit; the generated client receives only an injected, allowlisted native transport.
- Local credential failure occurs before a request when no approved secure backend exists. Prepare-update requires desktop/runtime/API/contract/database/compatibility-manifest identities and exposes `reject_if_active|quiesce_then_stop` state without accepting artifact URLs or signing keys from the renderer.
- Local OpenAPI contains no scoring route or scorer schema; trajectory contains no scoring event.
- Only scorer entrypoint may compose `scoring`; evaluator cannot import it or construct label adapters; future DB/import/composition/generation checks are named.

## Architecture and telemetry audit

- Exact physical tree, seven capability owners, allowed `.public` graph, composition-root deny matrix, table/migration owners and generated-contract exposure are present.
- The accepted future desktop tree separates React/Vite presentation under `apps/desktop/ui/` from the narrow Rust host under `apps/desktop/src-tauri/`; this tree is documentary and was not scaffolded.
- Tauri capability/permission/command ownership, effective-permission review, independent runtime supervision, OS-protected credential custody, picker-only raw-path custody and coordinated signed-update/rollback states are explicit.
- Every run snapshot has fields/contracts for model/profile version/digest, prompt versions/digests, resolved flags, native/logical usage, separated latency, decimal cost/pricing and ordered tool calls.
- PostgreSQL owns work/outbox/claims/leases/versions/events/recovery; desktop/connection/process-local state is disposable.
- Daemon, worker, evaluator, scorer and desktop are processes/products of one coordinated runtime release, not independently released services.

## ADR-007 readiness handoff audit

The future WP-01/WP-10 matrix contains exactly ten separately reviewable cases: claimed-OS builds; dummy runtime discover/start-or-attach; compatibility mismatch; secure credential unavailable/rotation; picker registration; close/crash/reopen with committed work continuing; native-command denial; signed update active-work/interruption/partial-failure/rollback; clean-machine reproducibility; and measured startup/memory/bundle evidence. Every case is explicitly `Not implemented`. A failing target pauses distribution or requires remediation/superseding ADR; it does not silently select another host.

## Revised documentation inventory

This ADR-007 ratification revises 32 documentation files: root `README.md`, `vocabulary.md`, `manifest-format.md`, `manifest.yaml`; five architecture documents; `contracts/async-api.openapi.yaml`; ADR-001, ADR-006, ADR-007 and the decision registry; eight delivery documents including this report; all six desktop documents; and four security documents. Exact paths and hashes are canonical in `manifest.yaml`.

## OpenCode provenance audit

- Reference repository: `/home/zinn/zinn/DATN/opencode`.
- Clean pinned HEAD: `14f0bf64a19493110b51f5fdeb9c1c1bba5dd3f5` with empty porcelain status at review.
- ADR-004 records MIT provenance and row-level observed-pattern/adopt-adapt-reject/destination/forbidden-carry-over review.
- Harness future implementation/package/lock/submodule inventory is empty in this change. No copied/generated/vendor OpenCode source, workspace dependency, fork/subtree/submodule or automatic synchronization was created.
- Future source/package reuse requires a separate license/security/dependency review and superseding evidence.

## Commands and limitations

Read-only validation used Python standard parsing, PyYAML and `jsonschema` already available in the environment; it did not install dependencies. The optional `openapi-spec-validator` package remains unavailable, so OpenAPI validation used YAML parsing, complete local-reference traversal, unique operations, security/path/schema assertions and contract examples. Markdown local links/anchors, stale ADR-007 claims, decision/profile status, file extensions/symlinks, content digests, trace row counts, Tauri authority/lifecycle/credential/update invariants and OpenSpec strict validity were also checked.

No application or executable test source, migration, package/lockfile, Tauri scaffold, compose/container/installer/updater/signing definition, service/database provisioning, dependency installation, credential/signing-key creation or access, provider SDK construction, DNS/network provider request, model call, contest download/access, Judge run, scorer execution, benchmark or scientific result occurred.

Blueprint only — no implementation evidence
