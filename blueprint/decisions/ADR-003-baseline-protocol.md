# ADR-003: Matched-pair direct-versus-harness evaluation methodology

- Status: `Accepted`
- Version: `adr-003-v2`
- Decision date: `2026-08-14`
- Owner/approver: TV5 evaluation owner
- Collaborators/reviewers: TV1, TV2, TV4, TV6
- Governing requirements: EVAL-01–EVAL-06
- Affected work packages: WP-08, WP-09

## Decision scope

This ADR accepts the durable methodology for RQ1. It does not accept a model, case list, repeat count, token budget, statistical threshold, prompt revision, retry-enabled run or paid execution. Those values live in a versioned experiment profile; changing them versions that profile rather than this ADR.

## Accepted methodology

RQ1 compares matched `(case_id, repeat_index)` pairs using the same immutable candidate, source snapshot, provider-profile digest, model snapshot, sampling/seed semantics, verdict-schema digest, total logical-token budget and output accounting. Both cells are scheduled in a deterministic predeclared paired order.

The arms intentionally differ only where the treatment requires it:

| Direct arm | Harness arm |
|---|---|
| shared Judge core + direct wrapper | same Judge core + harness wrapper |
| one request containing deterministic `SourceBundle` | explicit agent loop using local read-only source tools |
| loop/tools/tool feedback/schema repair disabled | versioned flags may enable them |
| one provider call | one or more logical calls within the same total logical-token budget |

Prompt wrappers are not claimed identical. Their exact bytes and digests are frozen as treatment definitions. The Judge meaning, verdict schema and provider profile are shared.

## Logical-token and time accounting

Fairness uses total logical model-visible tokens, not a provider invoice shortcut. Every call counts its complete input as sent, including repeated committed history, tool results, wrapper/core prompt, cached context and any content the provider reports at a discounted/cache rate. Output and reasoning categories are retained separately and included under the profile's declared accounting formula. Native usage is preserved; a versioned estimator defines fallback and disagreement behavior.

Wall-clock is not forced equal because orchestration and tools are part of the treatment. The same per-cell maximum protects runaway work, while observed provider latency, tool latency, queue time and end-to-end elapsed time are reported separately. Latency is an outcome, not converted into extra token allowance.

## Primary retry symmetry

Primary direct and harness cells each configure SDK retries to zero and one project attempt per logical provider call. A transient failure remains an accounted terminal outcome. Retry-enabled execution is a separate result-affecting flag, snapshot value, acceptance family and experiment identity; it cannot be mixed into the primary analysis.

## Pairing, drift and test discipline

- Case list, contest/source-family split, repeats, scheduling seed/order, prompts, flags, provider/profile, budgets, schemas, scorer and thresholds are frozen before test execution.
- A pair is rejected before either network call if a required digest/value differs or only one arm enables retry.
- Training informs development; validation selects/finalizes profile values; frozen test is used once for the confirmatory report and never for adaptation.
- Repeats estimate within-case variability; they are not independent cases. Inference clusters at contest and reports source-family sensitivity.
- All scheduled cells remain in completion and quality denominators under predeclared semantics.

## Profile gate

`evaluation/rq1-confirmatory-v1.profile.yaml` remains `Proposed` until all required values, provider-profile acceptance, prompt/schema/flag/bundle/scorer digests, split freeze, repeat/schedule, contest-cluster inference method/confidence/seed/iterations, thresholds, execution window, paid ceiling and approvers are recorded. The experiment/profile gate runs before provider construction or credential access. Incomplete, unapproved or digest-drifted profiles produce `pre_network_experiment_rejected`.

## Consequences

The comparison is reproducible and suitable for ablation while preserving the real product difference. It costs more metadata and requires honest accounting of repeated context. Changing RQ1 values creates a new profile/version; changing the matched-pair methodology, adaptation rules or inferential unit requires a superseding ADR.

## Acceptance evidence

Accepted by TV5 on `2026-08-14` for methodology only against `adr-003-v2`, `baseline-protocol-v2` and `experiment-profile-v1`. This acceptance is blueprint evidence and authorizes no dataset freeze, credential, paid model call or contest execution.
