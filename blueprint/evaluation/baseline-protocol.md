# Direct-versus-Harness Baseline Protocol

Normative: yes  
Version: `judge-baseline-protocol-v2`  
Owner: TV5; collaborators: TV1, TV2, TV4, TV6  
Requirements: EVAL-01–EVAL-06

ADR-003 accepts this methodology. `rq1-confirmatory-v1.profile.yaml` is still Proposed, so no result-bearing or network run is authorized.

## Frozen experiment identity

The canonical experiment profile freezes its own version/digest plus: exact prompt bytes/digests, SourceBundle version/digest, verdict schema digest, flag catalog/preset digests, contest manifest and ordered case-list digests, repeat count, paired schedule/seed, accepted provider profile ID/version/digest, sampling/seed semantics, logical-token estimator/budget, output reserve, wall-clock ceiling, retry policy, scorer/label-normalization versions, contest-cluster method/confidence/seed/iterations, source-family sensitivity, pricing, execution window, thresholds, failure/metric semantics and approvers.

Any changed value creates a new experiment profile version and experiment identity. Human-readable names never override digest mismatch.

## Matched-pair fairness matrix

| Dimension | Direct | Harness | Rule |
|---|---|---|---|
| Case/repeat | same `case_id`, `repeat_index` | same | atomic matched-pair scheduling unit |
| Candidate | same canonical bytes/digest | same | required equality |
| Source snapshot | same ID/revision/tree digest | same | required equality |
| Provider profile/model | same Accepted ID/version/digest | same | no floating alias |
| Sampling/seed support | same | same | unsupported explicit |
| Logical-token budget | same total | same total | full repeated/cached model-visible input counts |
| Output reserve/accounting | same formula | same formula | every call preflighted |
| Wall-clock ceiling | same | same | latency components reported separately, no token credit |
| Verdict schema/Judge core | same exact bytes/digest | same | independent validation |
| Wrapper | direct wrapper | harness wrapper | intentional frozen treatment difference |
| Source access | deterministic SourceBundle | local safe source tools | intentional treatment difference |
| Loop/tool feedback/repair | disabled by direct primary preset | explicit harness primary flags | frozen treatment definition |
| Primary provider retry | SDK 0/project 1 | SDK 0/project 1 per logical call | asymmetry rejects pair |
| Memory/PoC/Audit | disabled | disabled | outside MVP |

## Arm construction

The direct call orders `judge-core` then `direct-wrapper`, canonical candidate, deterministic SourceBundle and verdict schema. It contains no tool definition, agent loop, memory, verification or schema-repair call.

The harness orders the same `judge-core` then `harness-wrapper`, canonical candidate, safe local tool definitions and verdict schema. `agent_runtime` may make bounded logical calls; every call resends explicit committed history and all model-visible tokens count again.

The direct SourceBundle and harness tool visibility derive from the same immutable snapshot and exclusion policy. Prompt differences are declared, not disguised as equality.

## Pre-network rejection

Resolve both cells before either real call. Reject the pair when provider/experiment profile status, digest, model, prompt, schema, source, flags, retry, sampling, budget, manifest, split, case/repeat, pricing, threshold or approval values are missing, drifted or asymmetric. Rejection occurs before provider client construction, credential access or DNS and is represented by `examples/pre-network-rejection.json`.

## Pair scheduling and repeats

The accepted profile declares repeat count and deterministic balanced order/seed before test execution. Both arms for a pair are reserved under the same immutable identity. Repeats measure stochastic within-case variability and are retained; they never multiply the inferential case/contest count.

Ambiguous provider outcomes are recorded and not silently replayed as primary cells. A retry-enabled study uses a new experiment identity and acceptance family.

## Split and adaptation discipline

Whole contests and source families are assigned to train, validation or frozen test. Development and prompt/threshold/flag selection use train/validation only. Test access requires the accepted/frozen profile; results cannot feed changes back into the same test identity. Post-cutoff is a predeclared subgroup, not a replacement split.

## Terminal accounting and RQ1 classification

Every declared cell is completed, failed, cancelled or budget exhausted. A ground-truth-valid cell without a completed valid prediction contributes a false negative under the declared rule, while completion and schema-failure remain separate metrics.

The report applies predeclared precision-gain, recall-loss and completion gates. RQ1 is `positive` only when all pass, `negative` when no material precision gain is established without a gate violation, and `mixed` whenever recall or completion fails even if precision improves. Exact decision rules are frozen before test.

## Cost and timing

Native usage remains evidence; logical accounting supplies fairness; immutable pricing supplies derived cost. Cost correction versions a report without mutating run facts. Queue, provider, tool and end-to-end latency are separate fields. See `paired-logical-token-examples.md`.

## Synthetic evidence only

Complete/incomplete profile examples prove schema behavior; the complete example uses a deterministic synthetic profile and placeholder artifact digests. It is not approval for a real provider, dataset, credential, budget or execution.
