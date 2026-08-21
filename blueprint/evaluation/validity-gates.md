# Evaluation Validity Gates

Normative: yes  
Version: `evaluation-validity-gates-v1`  
Owner: TV5; reviewers: TV1, TV4, TV6

These gates run in order. Failure prevents test scheduling or marks a report invalid; no gate can be waived silently.

## Pre-freeze gates

| ID | Check | Rejection evidence |
|---|---|---|
| EV-SPLIT-01 | Every case inherits one contest split; every contest belongs to one source family; family and member splits match. | `manifest-split-leaking.json` shape fail and `manifest-source-family-leaking.json` semantic fail. |
| EV-ADAPT-01 | Prompt/flag/stopping/budget/gate selection uses train/validation only. | Any frozen-test read before Accepted profile creates an invalid experiment audit event. |
| EV-THRESHOLD-01 | Precision gain, maximum recall loss, completion floor and classification rule are non-null and approved before frozen-test access. | Proposed `rq1-confirmatory-v1` is rejected because thresholds are null. |
| EV-PAIR-01 | Case/repeat lists, provider/profile, source, schema, sampling, logical budget and primary retry match across arms. | Direct/harness packets demonstrate equality; a field diff rejects both cells. |
| EV-RETRY-01 | Primary direct and harness both use SDK retry 0/project attempt 1/flag false. | Any asymmetry is `pre_network_experiment_rejected`; symmetric retry uses a different profile/digest. |

## Analysis gates

| ID | Check | Required treatment |
|---|---|---|
| EV-UNIT-01 | Repeat is variability within case, not an independent sample. | Retain per-repeat rows; estimate matched deltas and cluster uncertainty by contest. |
| EV-CLUSTER-01 | Contests, not findings/repeats, are the independent cluster. | Contest-cluster bootstrap/interval; report contest count and source-family sensitivity. |
| EV-CUTOFF-01 | Pre/post/unknown bucket follows immutable model cutoff evidence. | Report all plus post-cutoff subgroup; never reclassify unknown. |
| EV-MISSING-01 | All scheduled cells remain in completion and declared quality semantics. | Failed/cancelled/budget cells cannot disappear from denominators. |
| EV-GATE-01 | Apply thresholds frozen before test. | Precision pass + recall or completion fail yields `mixed`, never positive. |

## Pseudo-replication review

The report must display `N contests`, `N source families`, `N cases` and `N repeat cells` separately. A confidence interval computed by treating every repeat/finding as independent is invalid even if numerically narrow. Primary uncertainty resamples contests while retaining all cases/repeats/paired arms within a selected contest; a source-family clustered sensitivity analysis is also reported when family count permits.

## Threshold-before-test review

The frozen profile digest must include the three numeric thresholds and exact decision function. The test-access audit record cites that Accepted digest and timestamp. A profile accepted after reading test results is invalid. Corrections require a new untouched test set, not a renamed profile over the same observations.

## RQ1 decision table

| Precision gain gate | Recall-loss gate | Completion gate | Classification |
|---|---|---|---|
| pass | pass | pass | `positive` |
| fail | pass | pass | `negative` or `inconclusive` under predeclared precision rule |
| any | fail | any | `mixed` |
| any | any | fail | `mixed` |

`examples/retry-asymmetry-rejected.json` is the concrete pre-network retry failure packet. `examples/rq1-mixed-gate.json` proves that a precision improvement cannot override a recall failure.
