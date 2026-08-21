# Blueprint Manifest Contract

Normative: yes  
Version: `blueprint-manifest-contract-v3`  
Owner: TV1/TV5  
Governs: `blueprint/manifest.yaml`

## Canonical format

UTF-8 YAML with LF endings. Artifact records are lexically ordered by unique path relative to `blueprint/`. Each digest is lowercase `sha256:<64 hex>` over exact current file bytes. `manifest.yaml` inventories itself separately as `digest: self-excluded` because a file cannot contain its own stable cryptographic digest.

## Required top-level fields

| Field | Constraint |
|---|---|
| `schema_version` | `blueprint-manifest-v2` |
| `blueprint_id` | `bootstrap-judge-mode-mvp` |
| `blueprint_version` | `judge-blueprint-v3` |
| `scope` | `documentation-only` |
| `status` | `Validated` only after validation report passes |
| `generated_at` | UTC date/time of inventory generation; not implementation time |
| `self` | path `manifest.yaml`, digest `self-excluded`, rationale |
| `artifact_count` | exact number of records excluding self |
| `artifacts` | records below in lexical path order |

## Artifact record

| Field | Constraint |
|---|---|
| `path` | Existing regular non-symlink path; no absolute/`..`; unique and lexically ordered |
| `kind` | `markdown`, `json-schema`, `json-example`, `yaml-contract`, `yaml-profile`, `yaml-catalog`, or `text-example` |
| `normative` | YAML boolean; examples/wireframes/validation log may be false |
| `owner` | Exactly one `TV1`…`TV6` accountable track |
| `status` | `Validated` when its digest/checks are current |
| `digest` | Exact SHA-256 |
| `decision_status` | Optional, only for ADR/profile status where relevant: `Proposed|Accepted|Superseded|Rejected` |

Requirement/scenario and work-package relationships are canonical in `delivery/requirement-traceability.md` and `delivery/normative-backreferences.md`, avoiding stale duplication across 96 digest records.

## Validation

Validation fails on missing/extra files, self in artifact list, count mismatch, path disorder/duplication, symlink, invalid kind/owner/status/digest, digest mismatch, or ADR/profile status mismatch. Updating any artifact requires regenerating the manifest after all other edits.
