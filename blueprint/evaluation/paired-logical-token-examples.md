# Paired Logical-Token Accounting Examples

Normative: yes  
Version: `paired-logical-token-examples-v1`

The exact estimator/version and numeric budget come from the accepted experiment profile. These synthetic numbers demonstrate the formula only.

## Equal budget with different call shapes

Assume a `12,000` logical-token total and a per-call output reserve of `1,200`.

| Arm/call | Full input as sent | Output/reasoning charged by declared formula | Cumulative logical tokens |
|---|---:|---:|---:|
| direct call 1 | 9,600 | 1,100 | 10,700 |
| harness call 1 | 2,800 | 500 | 3,300 |
| harness call 2, including repeated core/history/tool result | 4,200 | 600 | 8,100 |
| harness call 3, including all repeated committed context | 2,700 | 900 | 11,700 |

Both arms are within the same `12,000` total. Harness does not count only newly appended tokens: every model-visible token sent again counts again, even when the provider reports it as cached or bills it differently.

Before any call, preflight reserves output and rejects `cumulative + full_next_input + output_reserve > total`. Thus a harness fourth call with `800` input plus `1,200` reserve is rejected at `11,700`; it is not allowed to consume direct arm's unused budget as a post-hoc fairness adjustment.

## Usage disagreement

If native usage reports input `4,200`, cached input `3,000` and billed uncached input `1,200`, logical input remains `4,200`. Native categories remain recorded for cost. If the provider omits a category, the declared estimator is used and the disagreement/unknown flag is retained; the lower number is never silently selected.

## Wall-clock separation

Tool and orchestration time consume the common cell wall-clock ceiling but never convert into token credit. Reports keep queue, provider, tool and end-to-end time separate. A timeout remains an accounted outcome and primary retry remains disabled in both arms.

