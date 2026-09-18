# Experiment Profile

## Source: contest-manifest.md

# Contest Manifest Semantics

Normative: yes  
Schema: `contest-manifest-v2`  
Owner: TV5; collaborators: TV4, TV6

## Whole-contest and source-family split

Each contest has exactly one scalar `train|validation|test` split and every case inherits it. Each contest also references exactly one declared `source_family_id`. A source family groups contests sharing code lineage, fork ancestry, protocol family or another predeclared leakage-relevant basis.

Semantic validation, after JSON Schema validation, requires:

1. every contest occurs in exactly one `source_families.*.contest_ids` list;
2. that family key equals the contest's `source_family_id`;
3. every contest and every contest in the same family has the family's scalar split;
4. every case ID occurs under exactly one contest;
5. no train/validation/test source tree digest or declared lineage crosses a family boundary under a different family ID.

Failure rejects the manifest before scheduling. Finding/case-level split fields are forbidden. This prevents a code family or contest from leaking between development and frozen test.

## Adaptation discipline

Train supports implementation/prompt development. Validation supports profile, flag, threshold and stopping-rule selection. `test` is frozen confirmatory data and is opened only with an Accepted experiment profile. Test outcomes, traces and labels cannot tune or select anything under the same profile/manifest identity; any change creates a new future protocol and a new untouched test source.

## Freeze and integrity

`content_digest` is SHA-256 of canonical JSON (lexically sorted keys, UTF-8, no insignificant whitespace) with `content_digest` omitted. Duplicate JSON keys are rejected before schema validation. A frozen manifest with a different recomputed digest is rejected; corrections create a new manifest ID/version.

## Knowledge-cutoff buckets

Classification is per immutable model snapshot. Contest publication strictly after documented model cutoff is `post_cutoff`; at/before is `pre_cutoff`; absent cutoff is `unknown`. Evidence source and verification time come from the accepted provider profile. `unknown` is never reported as post-cutoff evidence, and post-cutoff never replaces the train/validation/test split or contest-cluster analysis.

## Example expectations

| File | Shape | Semantic/integrity expectation |
|---|---|---|
| `manifest-valid.json` | pass | Family membership/split valid; recomputed digest matches. |
| `manifest-split-leaking.json` | fail | Contest attempts multiple splits. |
| `manifest-source-family-leaking.json` | pass shape | Family and contest splits disagree; semantic rejection. |
| `manifest-tampered.json` | pass shape | Recomputed digest differs; integrity rejection. |
| `manifest-missing-cutoff.json` | pass | Null cutoff is explicitly `unknown`. |



## Source: rq1-confirmatory-v1.profile.yaml

```yaml
schema_version: experiment-profile-v1
profile_id: rq1-confirmatory-v1
profile_version: 1
status: Proposed
research_question: RQ1
methodology: adr-003-v2
provider_profile:
  id: real-primary
  version: 1
  path: blueprint/providers/real-primary.profile.yaml
  digest: null
prompts:
  judge_core:
    id: judge-core
    version: 1
    path: blueprint/evaluation/prompts/judge-core.md
    digest: sha256:594b5f80a7a1e6c278572aa12569d06b6a4b6708a9df256b4337f39032a83a8b
  direct_wrapper:
    id: direct-wrapper
    version: 1
    path: blueprint/evaluation/prompts/direct-wrapper.md
    digest: sha256:d392eaf14821ccd66e8ba5208a7ee2d870649993257adbeec2569fac5ddd0607
  harness_wrapper:
    id: harness-wrapper
    version: 1
    path: blueprint/evaluation/prompts/harness-wrapper.md
    digest: sha256:f272b2c814797f2a03188f4665962e6eff0d73db75e7a5d50fb57efc70ea4d58
contracts:
  verdict_schema:
    id: judge-verdict
    version: judge-verdict-v1
    path: blueprint/contracts/judge-verdict.schema.json
    digest: sha256:c462340046fd3a0822c1408fe9aa40a9dfe22e81f4c02bddb80d8aa59fd331e7
  flags_catalog:
    id: judge-flags
    version: judge-flags-v2
    path: blueprint/evaluation/flags-and-ablation.yaml
    digest: sha256:95eca9e6271cc028d7612a55169c7541903cfd9b988fb2f70a79ea97ce809356
  source_bundle:
    id: source-bundle
    version: source-bundle-v1
    path: blueprint/evaluation/source-bundle-v1.md
    digest: sha256:e5bf849baa667d9ba2659582454d17ed9618906cc6bc82be2f1a8e3570fb8360
  scorer_contract:
    id: approved-score
    version: ApprovedScoreV1
    path: blueprint/evaluation/scoring-and-reporting.md
    digest: sha256:ad9dd4836f2091b4793532800750119cf09caeb3192960e80e3aa2aff8abe159
arms:
  direct:
    prompt_order: [judge_core, direct_wrapper]
    source_access: source-bundle-v1
    flag_preset: direct-primary-v1
    provider_calls: exactly-one
  harness:
    prompt_order: [judge_core, harness_wrapper]
    source_access: local-source-tools-v1
    flag_preset: harness-primary-v1
    provider_calls: bounded-agent-loop
paired_design:
  unit: case_id+repeat_index
  repeat_count: null
  schedule: deterministic-balanced-pairs
  schedule_seed: null
accounting:
  logical_token_budget: null
  max_output_tokens_per_call: null
  estimator: null
  count_full_repeated_context: true
  count_cached_context_logically: true
  native_usage_retained: true
timing:
  max_wall_clock_ms: null
  report_provider_tool_queue_e2e_separately: true
  wall_clock_is_not_token_credit: true
primary_retry:
  enabled: false
  sdk_max_retries: 0
  project_attempts_per_logical_call: 1
data_freeze:
  manifest:
    id: null
    version: null
    path: null
    digest: null
  case_list_digest: null
  split_policy: whole-contest+source-family-v1
  frozen_test_adaptation_forbidden: true
inference:
  cluster_unit: contest
  method: null
  confidence_level: null
  resampling_seed: null
  iterations: null
  source_family_sensitivity: true
gates:
  precision_gain_min: null
  recall_loss_max: null
  completion_rate_min: null
  classification_on_any_failure: mixed
execution_window:
  starts_at: null
  ends_at: null
approval:
  approvers: []
  approved_at: null
  artifact_digest: null
  paid_cost_ceiling: null
  currency: null
execution_ready: false

```


## Source: Prompts Summary
Prompts are structured as system and user messages covering baseline extraction, scoring, etc.
