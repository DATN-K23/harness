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

