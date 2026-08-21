# Capability, Process, and Review Ownership Handoff

Normative: yes  
Version: `dependency-ownership-v4`  
Owner: TV1; collaborators: TV2–TV6

## Capability ownership

| Capability | Accountable | Collaborators/reviewers | Public consumers | Private adapter custody | Gate |
|---|---|---|---|---|---|
| `run_control` | TV1/TV6 | TV4/TV5 | agent runtime, Judge, evaluation, daemon/worker/evaluator/scorer composition | PostgreSQL lifecycle/work/outbox/lease/events/API projections | ADR-001/005/006 |
| `model_gateway` | TV1 | TV2/TV5 | `agent_runtime`, evaluation profile gate | official async OpenAI and deterministic adapters, credential resolver | ADR-002; real profile before network |
| `source_access` | TV3/TV4 | TV1/TV6 | Judge, agent runtime, evaluation, daemon registration | managed snapshot/filesystem/workspace/redaction/four tools | ADR-005/006; security cases |
| `agent_runtime` | TV1/TV2 | TV3/TV5 | Judge | context estimator/committed-history mechanics | ADR-002/003 |
| `judge` | TV1 | TV2/TV3/TV4/TV5 | worker and evaluation | prompts, verdict/evidence validation | accepted core contracts |
| `evaluation` | TV5 | TV1/TV4/TV6 | evaluator, scorer via public terminal-subject/ApprovedScore operations | manifest/scheduler/report/export persistence | ADR-003; experiment profile before result-bearing run |
| `scoring` | TV5/TV4 | TV1/TV6 | no general consumer; output only to `evaluation.public` | label/adjudication/score-join adapter | scorer-only process/grants |

Every capability owns its business adapters and tables. `platform` contains technical primitives only; entrypoints compose dependencies only. There is no repository-wide/global provider/filesystem/persistence adapter bucket.

## Process ownership and closures

| Process/product | Accountable | May compose | Explicitly forbidden |
|---|---|---|---|
| daemon/local API | TV6 | run/source/evaluation public operations and owned projections | scoring, ground truth, direct provider/tool policy |
| worker | TV1 | run/Judge/agent/model/source public operations | scoring/label/desktop |
| evaluator | TV5 | evaluation plus allowed public dependencies | scoring import/label adapter/credential |
| scorer | TV5/TV4 | scoring and evaluation public score-subject/acceptance operations | agent/provider/source tools/run-event mutation |
| desktop renderer | TV6 | generated local-runtime client injected through the typed Tauri transport | Python/DB/provider/tool/scorer, raw credential/path custody or direct native APIs |
| Tauri 2 native host | TV6 | allowlisted runtime bridge, picker, notification and update-preparation commands | business orchestration, generic filesystem/shell/process/env/URL grants, secret rendering or direct updater input from content |

ADR-007 is Accepted and fixes Tauri 2 as the native-host architecture. Before native-host packaging, installer, signing or updater work can claim readiness, WP-01/WP-10 must produce all ten readiness-spike results defined by ADR-007; an unsupported OS, insecure credential fallback, lifecycle coupling or unsafe update result fails that gate. Runtime/contract/renderer work remains independently schedulable.

## Track accountability

TV1 owns architecture/agent/provider/runtime closure; TV2 context/logical accounting; TV3 tool contracts; TV4 source/data/scorer security; TV5 evaluation/scoring methodology; TV6 PostgreSQL/local API/desktop/release integration. Cross-track contract changes require every consuming owner, TV4 for data/security and TV5 for result-affecting semantics.

## Enforced dependency rules

- Cross-capability source imports target only `harness.modules.<capability>.public` and follow the matrix in physical layout.
- No direct cross-capability table query or migration ownership; foreign IDs do not grant SQL authority.
- No provider SDK outside `model_gateway` private adapters; no source filesystem adapter outside `source_access`.
- No non-scorer `scoring`/label/scorer-schema import or credential; no reverse `evaluation -> scoring` dependency.
- Desktop uses only generated public OpenAPI schemas and cannot reach Python, PostgreSQL, provider, tools or scorer.
- SQLite, Redis, renderer cache, process memory and queue wakeup are not execution authorities.
- A result-affecting contract change versions/digests the artifact and updates flag/profile, telemetry, run snapshot, acceptance IDs, traceability and consumers together.
