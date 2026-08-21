# Normative Artifact Backreferences

Normative: yes  
Version: `normative-backreferences-v3`  
Owner: TV1; collaborators: TV2–TV6  
Coverage: API-01–10, EVAL-01–11, ORCH-01–08, PROV-01–07, TOOL-01–05, VER-01–03, UI-01–06, DATA-01–06; WP-01–10

Each named artifact inherits the listed requirements and future packages unless a local heading narrows them. Synthetic examples inherit their governing contract but are non-normative. `Proposed` ADR/profile artifacts constrain gates; they never authorize implementation or real execution.

| Normative artifact(s) | Requirements | Future package(s) |
|---|---|---|
| `README.md`; `vocabulary.md` | all 56 | WP-01–10 |
| `manifest-format.md`; `manifest.yaml` | EVAL-01, DATA-02, all delivery validation | WP-01/10 |
| `decisions/ADR-000-template.md`; `decisions/README.md` | all architecture/decision gates | WP-01–10 |
| `decisions/ADR-001-technology-stack.md`; `ADR-005-capability-first-modular-monolith.md`; `ADR-006-desktop-local-runtime.md` | API-04–10, ORCH-06–08, DATA-01/05/06, UI-04–06 | WP-01/06/07/10 |
| `decisions/ADR-002-provider-contract.md` | PROV-01–07, ORCH-05, EVAL-04/09 | WP-03 |
| `decisions/ADR-003-baseline-protocol.md` | EVAL-01–09 | WP-04/08 |
| `decisions/ADR-004-opencode-reference.md` | ORCH-05–08, TOOL-02/05, DATA-03 | WP-01–07 |
| `decisions/ADR-007-desktop-shell.md` | API-04/06–10, UI-04–06 | WP-01/07/10; readiness spike before release claim |
| `architecture/system-context.md`; `containers-and-trust-boundaries.md` | API-04/07–09, EVAL-10/11, TOOL-01/03–05 | WP-05–09 |
| `architecture/components-and-ownership.md`; `physical-repository-layout.md` | ORCH-05–08, API-08/10, UI-06, EVAL-11, DATA-01 | WP-01–10 |
| `architecture/agent-runtime-boundaries.md` | ORCH-02/04/05, PROV-01/06/07, TOOL-05 | WP-02–05 |
| `architecture/judge-lifecycle.md`; `end-to-end-sequences.md` | API-01–03/05/07, ORCH-01–05, PROV-03/06/07, DATA-03/05 | WP-02–06 |
| `architecture/desktop-runtime-topology.md` | API-04–10, UI-04–06, DATA-05/06 | WP-01/06/07/10 |
| `architecture/scorer-isolation-boundary.md` | EVAL-10/11, DATA-01 | WP-09 |
| `contracts/domain-model.md` | ORCH-01/02, VER-01–03, DATA-01/02 | WP-01/02/06 |
| `contracts/context-and-budget.md` | ORCH-03/04, EVAL-03 | WP-04 |
| `contracts/provider-contract.md`; `providers/provider-profile.schema.json`; `providers/real-primary.profile.yaml`; `providers/deterministic-profiles.md`; `providers/conformance-matrix.md` | PROV-01–07, EVAL-04/09 | WP-03 |
| `contracts/tool-contracts.md` | TOOL-02–05, PROV-07 | WP-05 |
| `contracts/judge-verdict.md`; `judge-verdict.schema.json` | VER-01–03 | WP-02/05 |
| `contracts/trajectory-events.schema.json` | UI-02, DATA-03/04, PROV-02 | WP-02/03/06/07 |
| `contracts/async-api.openapi.yaml`; `contracts/registry.yaml` | API-01–10, EVAL-11, UI-01/04–06 | WP-01/07/09/10 |
| `persistence/erd.md`; `field-dictionary.md`; `consistency-and-idempotency.md` | API-02/03/05/07/09, DATA-01–06, EVAL-11 | WP-06/09 |
| `security/source-registration-and-data-flow.md`; `workspace-policy.md` | API-09, TOOL-01–05, VER-02 | WP-05/07 |
| `security/data-classification.md`; `threat-model.md`; `adversarial-acceptance-catalog.md` | API-04/08–10, UI-06, EVAL-10/11, TOOL-01–05, DATA-04 | WP-05/07/09/10 |
| `security/ground-truth-flow-audit.md` | EVAL-10/11, DATA-01/04 | WP-09 |
| `evaluation/experiment-profile.schema.json`; `rq1-confirmatory-v1.profile.yaml` | EVAL-02–04/06–09, PROV-05/06 | WP-08 |
| `evaluation/prompts/judge-core.md`; `direct-wrapper.md`; `harness-wrapper.md`; `paired-logical-token-examples.md` | EVAL-02–04 | WP-04/08 |
| `evaluation/flags-and-ablation.yaml`; `baseline-protocol.md`; `validity-gates.md` | EVAL-01–04/06–09 | WP-04/08 |
| `evaluation/source-bundle-v1.md` | EVAL-02/03/05, TOOL-01/04 | WP-08 |
| `evaluation/contest-manifest.schema.json`; `contest-manifest.md` | EVAL-06/07/08/09 | WP-08 |
| `evaluation/scoring-and-reporting.md` | EVAL-07/08/10/11, DATA-01 | WP-08/09 |
| `desktop/local-runtime-connection.md`; `information-architecture.md`; `submission-and-status.md`; `trace-view.md`; `terminal-states.md`; `disclosure-review.md` | API-01/03–10, UI-01–06, VER-03, DATA-06 | WP-07/10 |
| `delivery/dependency-and-ownership.md`; `implementation-work-packages.md`; `tv1-tv6-timeline.md` | all 56 | WP-01–10 |
| `delivery/extension-roadmap.md` | PROV-04, TOOL-05, VER-03 | later changes |
| `delivery/requirement-traceability.md`; `normative-backreferences.md`; `scope-audit.md` | all 56/61 scenarios | WP-10 |

Bidirectional validation fails on any missing OpenSpec scenario row, unknown requirement/work package, missing named artifact, normative manifest artifact absent from this index, stale `ui/` path or scorer-only/public-generation mismatch.
