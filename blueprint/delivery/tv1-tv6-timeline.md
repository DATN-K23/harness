# TV1–TV6 Blueprint-to-Implementation Timeline

Explanatory handoff: yes  
Version: `tv-timeline-v2`  
Owner: TV1; collaborators: TV2–TV6

This maps future work packages to the existing two-week `C01…` timeline vocabulary. It does not alter `docs/timeline.csv`, report current progress, or claim implementation. Rebaseline dates/status remain owned by the team timeline; blueprint gates take precedence over starting blocked work.

## Track ownership by package

| Track | Accountable future packages | Mandatory cross-review |
|---|---|---|
| TV1 agent/runtime architecture | WP-01, WP-02, WP-03; integration owner WP-10 | TV2 context, TV3 tools, TV4 security, TV5 evaluation, TV6 persistence/API |
| TV2 context/budget | WP-04; WP-02 collaborator | TV1/TV5 for logical-token and stop fairness |
| TV3 source tools | tool-contract portion of WP-05 | TV4 authorization/redaction and TV1 agent boundary |
| TV4 security/isolation | registration/workspace portion WP-05; WP-09 co-owner | TV3 source, TV5 scoring, TV6 process/DB grants |
| TV5 evaluation/scoring | WP-08 and WP-09 co-owner | TV1 runtime, TV4 leakage/isolation, TV6 persistence/export |
| TV6 persistence/local API/desktop | WP-06, WP-07; release evidence WP-10 | TV1 ownership graph, TV4 disclosure, TV5 evaluation |

## Judge MVP sequence

| Timeline window | Shared gate/outcome | TV1 | TV2 | TV3 | TV4 | TV5 | TV6 |
|---|---|---|---|---|---|---|---|
| C01 rebaseline | Blueprint/ADR/profile readiness; ADR-007 architecture Accepted; no code implied | approve capability graph/provider strategy | approve context/logical accounting | approve four-tool registry | approve source/scorer/native threat boundaries | approve methodology/profile schema | own Tauri readiness plan plus local runtime/desktop/persistence topology |
| C02 foundation | WP-01 plus interfaces for WP-03–WP-07; execute future Tauri readiness spike before release claim | public contracts/composition skeleton; review runtime supervision | estimator/allocator ports | tool schemas | policy/redaction/native-denial fixtures | synthetic profile/manifest fixtures | PostgreSQL/OpenAPI/generated-client pipeline; Tauri three-OS spike evidence |
| C03–C04 first vertical slice | deterministic Judge submit→trace→terminal; no real scientific result | WP-02 deterministic loop/verdict | WP-04 preflight/stops | WP-05 read/list/glob/search | registration/path/adversarial boundary | WP-08 synthetic paired packets | WP-06 work/outbox/lease + WP-07 polling desktop projection |
| C05–C06 hardening | restart/cancel/budget/ablation/security evidence | recovery/no-progress/flags | context boundaries | deterministic tool errors | raw-path/secret/ground-truth negative proofs | split/family/threshold/inference gates | lifecycle/reconnect/cursor/disclosure tests |
| C07–C08 Judge MVP gate | WP-09 + WP-10 integrated local-runtime evidence | runtime closure/import proof | token telemetry parity | tool-registry immutability | DB grants/scorer isolation plus native threat retest | deterministic full matrix; real RQ1 only if profiles Accepted | desktop-independent recovery; signed coordinated update/rollback and release reproducibility |

## Gate rules

- ADR-007 has selected Tauri 2. Its ten-case WP-01/WP-10 readiness spike gates any claim that native-host packaging, credential custody, signing, updating or rollback is release-ready; it does not authorize code in this blueprint change.
- `real-primary` must be Accepted before SDK client construction, credential access or any real provider call.
- `rq1-confirmatory-v1` must be Accepted before frozen-test access, result-bearing or paid RQ1 execution.
- Audit mode, long-term memory/compaction, VerificationRunner/PoC and multi-provider RQ2/RQ3 require later OpenSpec changes even if the broader project timeline mentions them.
- A timeline cell becomes complete only with its future implementation acceptance evidence; blueprint validation alone changes no `docs/timeline.csv` status.
