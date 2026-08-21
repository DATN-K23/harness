# Persistence Field Dictionary

Normative: yes  
Version: `field-dictionary-v2`  
Owner: TV6; collaborators: TV4, TV5  
Requirements: DATA-01, DATA-02, DATA-04, PROV-02

Legend: `P` public-safe local API projection, `I` trusted internal, `A` agent-visible exact sanitized, `S` scorer-only, `EVALUATION_PUBLIC` approved non-label evaluation crossing, `X` secret/prohibited (never stored raw). Retention is `run` (life of research record), `registry`, `experiment`, or `ephemeral`.

## `source_registration` and `source_snapshot`

| Field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `registration_id` | string / no | PK, opaque | I / registry | Control-plane generated | Safe correlation only |
| `registration_policy_version` | string / no | index | I / registry | Canonicalization/import policy | Reproduction evidence |
| `registration_outcome` | enum / no | index | I / registry | accepted/rejected safe category | Safe operational projection |
| `registration_snapshot_id` | string / yes | FK unique when accepted | I / registry | Produced managed snapshot | ID only |
| `registration_created_at` | UTC timestamp / no | index | I / registry | Runtime clock | Safe operational projection |
| `source_snapshot_id` | string / no | PK, opaque | P / registry | Control-plane generated | ID only |
| `contest_id` | string / yes | index | I / registry | Evaluation registry attaches separately; never needed for ordinary registration | Research export only |
| `revision` | string / no | immutable | I / registry | VCS/archive immutable revision | Config projection |
| `source_tree_digest` | digest / no | unique | I / registry | Exact authorized tree algorithm | Config/reproduction export |
| `inventory_digest` | digest / no | index | I / registry | Canonical allowlisted relative inventory | Config/reproduction export |
| `managed_content_ref` | protected content ID / no | immutable | I / registry | Runtime-managed imported bytes; not original host location | Never API/export directly |
| `created_at` | UTC timestamp / no | index | I / registry | Registry clock | Reproduction export |

There is deliberately no field for selected/raw/canonical host path or its hash. Registration request memory releases it after import/rejection.

## `candidate_finding`

| Field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `candidate_finding_id` | string / no | PK | P / run | Content registry | Safe API/export |
| `schema_version` | string / no | index | P / run | Canonical schema | Safe API/export |
| `canonical_content` | JSON / no | immutable | A / run | Canonicalized agent-visible finding | Safe only under run access |
| `content_digest` | digest / no | unique | P / run | Canonical content bytes | API/export |
| `source_platform_ref` | string / yes | index | I / run | Dataset provenance; never label | Research export |
| `created_at` | UTC timestamp / no | index | I / run | Registry clock | Reproduction export |

## `run`

| Field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `run_id` | string / no | PK | P / run | Control-plane generated | API/export |
| `mode` | enum / no | fixed `judge` in MVP | P / run | Submitted contract | API/export |
| `state` | enum / no | state index | P / run | CAS transition | API/export |
| `state_version` | integer / no | monotonic | I / run | CAS counter | API safe summary |
| `candidate_finding_id` | string / no | FK,index | P / run | Registry ref | API/export |
| `source_snapshot_id` | string / no | FK,index | P / run | Registry ref | API/export |
| `config_digest` | digest / no | FK/unique-per-config | P / run | `run_config` canonical digest | API/export |
| `created_at` | UTC timestamp / no | index | P / run | Application clock | API/export |
| `updated_at` | UTC timestamp / no | index | P / run | Last committed transition | API/export |
| `started_at` | UTC timestamp / yes | index | P / run | Running transition | API/export |
| `terminal_at` | UTC timestamp / yes | index | P / run | Terminal transition | API/export |
| `terminal_reason` | enum / yes | index | P / run | Lifecycle vocabulary | API/export |
| `cancel_requested_at` | UTC timestamp / yes | index | I / run | Idempotent cancel request | API safe state |
| `logical_input_tokens_total` | integer / no | non-negative | P / run | Sum full model-visible input including repeated/cached context | API/export |
| `output_tokens_total` | integer / no | non-negative | P / run | Sum normalized attempts | API/export |
| `provider_latency_ms_total` | integer / no | non-negative | P / run | Sum recorded attempt latency | API/export |
| `tool_call_count` | integer / no | non-negative | P / run | Count committed tool calls | API/export |
| `cost_amount` | decimal string / no | non-negative | P / run | Sum under stored pricing versions | API/export |
| `cost_currency` | ISO code / no | one currency per aggregate | P / run | Run config | API/export |

## `run_config`

| Field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `run_id` | string / no | PK/FK | I / run | Run identity | Internal join |
| `config_digest` | digest / no | unique | P / run | Canonical resolved config | API/export |
| `provider_profile_id` | string / no | index | P / run | Resolved selection | API/export |
| `provider_profile_version` | integer/string / no | index | P / run | Immutable profile version | API/export |
| `provider_profile_digest` | digest / no | index | P / run | Exact accepted profile bytes | API/export |
| `provider_name` | string / yes | index | P / run | Adapter config | API/export |
| `provider_sdk_version` | string / no | immutable | I / run | Accepted provider profile | Reproduction export |
| `model_id_requested` | string / no | index | P / run | Submitted approved model | API/export |
| `model_capability_version` | string / no | index | P / run | Capability catalog | API/export |
| `context_limit` | integer / no | positive | P / run | Model capability | API/export |
| `context_limit_source` | string / no | immutable | I / run | Official/config evidence ref | Reproduction export |
| `prompt_content` | text/ref / no | immutable | A / run | Exact resolved system prompt | Trusted trace/export |
| `prompt_versions` | JSON / no | immutable | P / run | Ordered core/wrapper IDs and versions | API/export |
| `prompt_digest` | digest / no | index | P / run | Exact prompt bytes | API/export |
| `tool_definitions_content` | JSON/ref / no | immutable | A / run | Exact tool descriptions/schemas | Trusted trace/export |
| `tool_definitions_digest` | digest / no | index | P / run | Canonical definitions | API/export |
| `verdict_schema_content` | JSON/ref / no | immutable | A / run | Exact schema | Trusted trace/export |
| `verdict_schema_digest` | digest / no | index | P / run | Canonical schema | API/export |
| `resolved_flags` | JSON / no | immutable | P / run | Flag catalog resolution | API/export |
| `flags_digest` | digest / no | index | P / run | Canonical flags | API/export |
| `budgets` | JSON / no | immutable | P / run | Validated request/preset | API/export |
| `sampling` | JSON / no | immutable | P / run | Provider-neutral values/support | API/export |
| `retry_policy` | JSON / no | immutable | P / run | Versioned policy | API/export |
| `pricing_version` | string / no | index | P / run | Frozen pricing catalog | API/export |
| `manifest_version` | string / yes | index | I / run | Evaluation controller | Research export |
| `manifest_digest` | digest / yes | index | I / run | Frozen manifest | Research export |
| `split` | enum / yes | index | I / run | Whole-contest assignment | Research export, never model context |
| `source_family_id` | string / yes | index | I / run | Frozen family grouping | Research export, never model context |
| `protocol_version` | string / yes | index | I / run | Frozen experiment | Research export |
| `protocol_digest` | digest / yes | index | I / run | Canonical protocol | Research export |
| `experiment_profile_id_version_digest` | JSON / yes | immutable | I / run | Accepted experiment profile reference | Research export |
| `harness_commit` | string / no | index | I / run | Build provenance | Reproduction export |
| `build_id` | string / no | index | I / run | Packaging provenance | Reproduction export |
| `runtime_id` | string / no | immutable | I / run | Language/runtime version | Reproduction export |
| `container_id` | string / yes | immutable | I / run | Image digest when used | Reproduction export |
| `dependency_lock_digest` | digest / no | immutable | I / run | Exact lock bytes | Reproduction export |
| `created_at` | UTC timestamp / no | immutable | I / run | Before enqueue | Reproduction export |

## `trajectory_event`

| Field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `event_id` | string / no | PK | P / run | Event sink generated | API/export |
| `run_id` | string / no | FK + unique with sequence | P / run | Aggregate | API/export |
| `sequence` | integer / no | unique `(run_id,sequence)` | P / run | Atomic allocator | API/export |
| `schema_version` | string / no | index | P / run | Event contract | API/export |
| `type` | enum / no | index | P / run | Event vocabulary | API/export |
| `safe_payload` | JSON/ref / no | append-only | A/I / run | Pre-persistence sanitized | Safe projection only |
| `payload_digest` | digest / no | index | P / run | Exact stored payload bytes | API/export |
| `occurred_at` | UTC timestamp / no | index | P / run | Producer clock | API/export |

## `step`

| Field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `step_id` | string / no | PK | I / run | Worker generated | Event projection |
| `run_id` | string / no | FK + unique step | P / run | Aggregate | API/export |
| `step_index` | integer / no | unique `(run_id,index)` | P / run | Orchestrator | API/export |
| `request_content` | text/ref / no | immutable | A / run | Exact sanitized model-visible request | Trusted trace/export |
| `request_digest` | digest / no | index | P / run | Exact stored request | API/export |
| `response_content` | text/ref / yes | immutable | A / run | Exact sanitized response | Trusted trace/export |
| `response_digest` | digest / yes | index | P / run | Exact stored response | API/export |
| `context_allocation` | JSON / no | immutable | P / run | Context planner event | API/export |
| `started_at` | UTC timestamp / no | index | P / run | Worker clock | API/export |
| `finished_at` | UTC timestamp / yes | index | P / run | Worker clock | API/export |
| `duration_ms` | integer / yes | non-negative | P / run | Derived monotonic timing | API/export |
| `input_tokens` | integer / no | non-negative | P / run | Normalized usage | API/export |
| `output_tokens` | integer / no | non-negative | P / run | Normalized usage | API/export |
| `cost_amount` | decimal string / no | non-negative | P / run | Attempt aggregation | API/export |
| `error_category` | enum / yes | index | P / run | Normalized error | API/export |

## `provider_attempt`

| Field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `provider_attempt_id` | string / no | PK | I / run | Adapter boundary | Trace/export |
| `step_id` | string / no | FK + attempt unique | I / run | Step | Trace/export |
| `attempt_index` | integer / no | unique `(step_id,index)` | P / run | Retry policy | API/export |
| `provider_profile` | string / no | index | P / run | Run config | API/export |
| `provider_profile_digest` | digest / no | index | P / run | Exact accepted profile | API/export |
| `provider_name` | string / yes | index | P / run | Adapter | API/export |
| `model_id_requested` | string / no | index | P / run | Request | API/export |
| `model_id_resolved` | string / yes | index | P / run | Native response | API/export |
| `native_request_id` | string / yes | index | I / run | Native response, sanitized | Trusted export |
| `endpoint_region` | string / yes | index | I / run | Native/config metadata | Reproduction export |
| `request_digest` | digest / no | index | P / run | Exact normalized request | API/export |
| `seed_requested` | integer / yes | immutable | P / run | Sampling config | API/export |
| `seed_supported` | boolean / no | immutable | P / run | Capability profile | API/export |
| `started_at` | UTC timestamp / no | index | P / run | Adapter monotonic boundary | API/export |
| `finished_at` | UTC timestamp / yes | index | P / run | Adapter boundary | API/export |
| `latency_ms` | integer / yes | non-negative | P / run | Monotonic derived | API/export |
| `usage_native` | JSON / yes | immutable | I / run | Lossless safe native fields | Research export |
| `usage_normalized` | JSON / yes | immutable | P / run | Contract mapping | API/export |
| `logical_input_tokens` | integer / no | non-negative | P / run | Full sent input regardless of cache billing | API/export |
| `pricing_version` | string / no | index | P / run | Run config | API/export |
| `cost_amount` | decimal string / no | non-negative | P / run | Pricing calculation | API/export |
| `cost_currency` | ISO code / no | immutable | P / run | Pricing catalog | API/export |
| `finish_reason_native` | string / yes | immutable | I / run | Native response, sanitized | Research export |
| `finish_reason_normalized` | enum / yes | index | P / run | Contract mapping | API/export |
| `error_native_safe` | JSON / yes | immutable | I / run | Allowlisted/redacted native error | Trusted export |
| `error_normalized` | enum / yes | index | P / run | Error taxonomy | API/export |
| `retry_decision` | enum / no | index | P / run | Versioned retry policy | API/export |
| `backoff_ms` | integer / no | non-negative | P / run | Retry policy | API/export |

## `tool_call`

| Field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `tool_call_id` | string / no | PK | P / run | Orchestrator/native call mapping | API/export |
| `step_id` | string / no | FK + call unique | I / run | Step | Trace/export |
| `call_index` | integer / no | unique `(step_id,index)` | P / run | Response order | API/export |
| `native_tool_call_id` | string / yes | index | I / run | Native response | Trusted export |
| `tool_name` | string / no | index | P / run | Registry | API/export |
| `tool_version` | string / no | index | P / run | Registry | API/export |
| `description_version` | string / no | index | P / run | Registry | API/export |
| `arguments_safe` | JSON / no | immutable | A / run | Bounded/redacted before persistence | Safe API/export |
| `arguments_digest` | digest / no | index | P / run | Exact stored args | API/export |
| `result_safe` | JSON/text/ref / yes | immutable | A / run | Exact model-visible result/error | Safe API/export |
| `sanitized_pre_truncation_digest` | digest / yes | index | P / run | After redaction, before truncation | API/export |
| `transformation_ids` | string array / no | immutable | P / run | Rule versions | API/export |
| `duration_ms` | integer / yes | non-negative | P / run | Monotonic timing | API/export |
| `result_tokens` | integer / yes | non-negative | P / run | Estimator/version in event | API/export |
| `status` | enum / no | index | P / run | requested/completed/failed/blocked | API/export |
| `error_code` | enum / yes | index | P / run | Tool error catalog | API/export |
| `created_at` | UTC timestamp / no | index | P / run | Event time | API/export |

## `verdict` and `evidence`

| Entity.field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `verdict.verdict_id` | string / no | PK | P / run | Application generated | API/export |
| `verdict.run_id` | string / no | FK unique | P / run | Completed run | API/export |
| `verdict.schema_version` | string / no | index | P / run | Validated schema | API/export |
| `verdict.validity` | enum / no | index | P / run | Model output validated | API/export |
| `verdict.severity` | enum / no | index | P / run | Cross-field validated | API/export |
| `verdict.confidence` | decimal / no | range `[0,1]` | P / run | Model output | API/export |
| `verdict.rationale` | text / no | bounded | A / run | Sanitized model output | API/export |
| `verdict.verification_status` | enum / no | fixed unverified | P / run | MVP invariant | API/export |
| `verdict.label_normalization_version` | string / no | index | P / run | Evaluation config | API/export |
| `verdict.created_at` | UTC timestamp / no | index | P / run | Terminal transaction | API/export |
| `evidence.evidence_id` | string / no | PK | P / run | Application generated | API/export |
| `evidence.verdict_id` | string / no | FK | P / run | Verdict | API/export |
| `evidence.ordinal` | integer / no | unique per verdict | P / run | Model order | API/export |
| `evidence.relative_path` | string / no | index | P / run | Authorized normalized path | API/export |
| `evidence.start_line` | integer / no | >=1 | P / run | Validated span | API/export |
| `evidence.end_line` | integer / no | >= start | P / run | Validated span | API/export |
| `evidence.content_digest` | digest / no | index | P / run | Exact source span | API/export |
| `evidence.note` | text / yes | bounded | A / run | Model output sanitized | API/export |

## `security_event`

| Field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `security_event_id` | string / no | PK | I / run | Security boundary | Safe trace projection |
| `run_id` | string / no | FK,index | P / run | Aggregate | API safe projection |
| `trajectory_sequence` | integer / yes | index | I / run | Related event | Safe trace projection |
| `event_type` | enum / no | index | P / run | block/redact/truncate/integrity | API/export |
| `rule_id` | string / no | index | P / run | Versioned policy | API/export |
| `safe_details` | JSON / no | immutable | I / run | Never contains prohibited original | Safe projection only |
| `created_at` | UTC timestamp / no | index | P / run | Boundary clock | API/export |

## `idempotency_record`, `work_item`, `outbox_record`, `work_claim`, and `content_blob`

| Entity.field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `idempotency_record.key_digest` | digest / no | PK | I / run | Hash of opaque key; raw key not retained | Never API |
| `idempotency_record.request_digest` | digest / no | immutable | I / run | Canonical submission | Conflict logic only |
| `idempotency_record.run_id` | string / no | FK unique | I / run | Accepted run | Internal |
| `idempotency_record.created_at` | timestamp / no | index | I / run | Application clock | Internal |
| `work_item.work_id` | string / no | PK | I / run | Stable delivery identity | Internal |
| `work_item.run_id` | string / no | FK,index | I / run | Accepted run | Internal |
| `work_item.kind` | enum / no | index | I / run | Judge/evaluation work kind | Internal |
| `work_item.state` | enum / no | eligible index | I / run | pending/claimed/completed/failed/cancelled | Internal |
| `work_item.work_version` | integer / no | monotonic | I / run | Claim/completion CAS | Internal |
| `work_item.available_at` | timestamp / no | eligible index | I / run | Versioned scheduling policy | Internal |
| `outbox_record.outbox_id` | string / no | PK | I / run | Transactional delivery intent | Internal |
| `outbox_record.work_id` | string / no | FK,index | I / run | Work reference | Internal |
| `outbox_record.payload_digest` | digest / no | immutable | I / run | Stable IDs only | Internal |
| `outbox_record.publish_state` | enum / no | publisher index | I / run | pending/published/failed | Internal |
| `outbox_record.publish_version` | integer / no | monotonic | I / run | Publisher CAS | Internal |
| `outbox_record.published_at` | timestamp / yes | index | I / run | Delivery observation | Internal |
| `work_claim.claim_id` | string / no | PK | I / run | Claim audit identity | Internal |
| `work_claim.work_id` | string / no | FK,index | I / run | Work item | Internal |
| `work_claim.token_digest` | digest / no | unique | X/I / ephemeral+audit | Raw token never stored | Never API/export |
| `work_claim.worker_id` | string / no | index | I / run | Worker process identity | Internal observability |
| `work_claim.claim_version` | integer / no | monotonic | I / run | Lease/heartbeat CAS | Internal |
| `work_claim.lease_expires_at` | timestamp / no | eligible index | I / run | Finite ownership lease | Internal |
| `work_claim.heartbeat_at` | timestamp / no | index | I / run | Lease progress | Internal |
| `work_claim.released_at` | timestamp / yes | index | I / run | Completion/interruption | Internal |
| `work_claim.outcome` | enum / yes | index | I / run | completed/released/expired/unknown_attempt | Internal |
| `content_blob.content_digest` | digest / no | PK | I/A / run | Exact already-sanitized bytes | Reference only |
| `content_blob.media_type` | string / no | index | I / run | Contract | Reference metadata |
| `content_blob.byte_length` | integer / no | non-negative | I / run | Exact bytes | Reference metadata |
| `content_blob.safe_content` | bytes / no | immutable | A / run | Redacted before insert | Trusted retrieval only |
| `content_blob.created_at` | timestamp / no | index | I / run | Store clock | Reproduction export |

## `experiment`, `experiment_cell`, evaluation-owned `approved_score`, and scorer-only records

| Entity.field | Type / null | Constraint/index | Class / retention | Source and digest semantics | API/export |
|---|---|---|---|---|---|
| `experiment.experiment_id` | string / no | PK | I / experiment | Controller generated | Research export |
| `experiment.protocol_version` | string / no | index | I / experiment | Frozen protocol | Research export |
| `experiment.protocol_digest` | digest / no | index | I / experiment | Canonical protocol | Research export |
| `experiment.manifest_version` | string / no | index | I / experiment | Frozen manifest | Research export |
| `experiment.manifest_digest` | digest / no | index | I / experiment | Manifest bytes | Research export |
| `experiment.model_id` | string / no | index | I / experiment | Approved immutable model | Research export |
| `experiment.provider_profile` | string / no | index | I / experiment | Approved profile | Research export |
| `experiment.repeat_count` | integer / no | positive | I / experiment | Predeclared | Research export |
| `experiment.case_order_digest` | digest / no | immutable | I / experiment | Ordered case IDs | Research export |
| `experiment.scorer_version` | string / no | index | I / experiment | Scoring contract | Research export |
| `experiment.pricing_version` | string / no | index | I / experiment | Pricing catalog | Research export |
| `experiment.status` | enum / no | index | I / experiment | draft/frozen/running/complete | Research export |
| `experiment.created_at` | timestamp / no | index | I / experiment | Controller clock | Research export |
| `experiment_cell.experiment_cell_id` | string / no | PK | I / experiment | Canonical cell identity | Research export |
| `experiment_cell.experiment_id` | string / no | FK + composite unique | I / experiment | Experiment | Research export |
| `experiment_cell.case_id` | string / no | composite unique | I / experiment | Dataset ID, not label | Research export |
| `experiment_cell.contest_id` | string / no | index | I / experiment | Manifest | Research export |
| `experiment_cell.split` | enum / no | index | I / experiment | Whole-contest manifest | Research export |
| `experiment_cell.contamination_bucket` | enum / no | index | I / experiment | Cutoff classification | Research export |
| `experiment_cell.arm` | enum / no | composite unique | I / experiment | direct/harness | Research export |
| `experiment_cell.repeat_index` | integer / no | composite unique | I / experiment | Declared repeat | Research export |
| `experiment_cell.run_id` | string / yes | FK unique when set | I / experiment | Scheduled/reused run | Research export |
| `experiment_cell.terminal_accounted` | boolean / no | index | I / experiment | Denominator guard | Research export |
| `experiment_cell.approved_score_id` | string / yes | opaque FK unique | I / experiment | `ApprovedScoreV1` accepted by evaluation | Approved evaluation projection only |
| `ground_truth_label.case_id` | string / no | scorer schema PK/ref | S / experiment | Official normalized label provenance | Never run/API/desktop/evaluator |
| `ground_truth_label.label_content` | JSON / no | scorer schema only | S / experiment | Official label | Scorer/research-controlled only |
| `adjudication.adjudication_id` | string / no | scorer schema PK | S / experiment | Official/manual provenance | Scorer/research-controlled only |
| `adjudication.detail` | JSON/text / yes | scorer schema only | S / experiment | Ground-truth rationale | Never public crossing |
| `score_join.score_record_id` | string / no | scorer schema PK | S / experiment | Scorer generated | Opaque ID may cross |
| `score_join.experiment_cell_id` | string / no | unique | S / experiment | Canonical terminal cell | Opaque ID may cross |
| `score_join.run_id` | string / no | terminal safe-view reference | S / experiment | Immutable prediction join | Opaque ID may cross |
| `score_join.classification_detail` | JSON / no | scorer schema only | S / experiment | Label/prediction comparison | Never public crossing |
| `score_join.scorer_contract` | JSON / no | immutable | S / experiment | Scorer/normalizer versions/digests | Approved versions may cross |
| `score_join.scored_at` | timestamp / no | index | S / experiment | Scorer clock | Approved timestamp may cross |
| `approved_score.approved_score_id` | string / no | evaluation PK | EVALUATION_PUBLIC / experiment | Idempotent accepted score ID | Evaluation projection/export |
| `approved_score.experiment_cell_id` | string / no | FK unique | EVALUATION_PUBLIC / experiment | Identity checked by evaluation.public | Evaluation projection/export |
| `approved_score.run_id` | string / no | terminal reference | EVALUATION_PUBLIC / experiment | Identity only | Evaluation projection/export |
| `approved_score.contract_version_digest` | JSON / no | immutable | EVALUATION_PUBLIC / experiment | `ApprovedScoreV1` identity | Evaluation projection/export |
| `approved_score.aggregate_safe_result` | JSON / no | allowlisted | EVALUATION_PUBLIC / experiment | Completion/prediction/gate-safe fields; no label/free text | Approved aggregate/report only |
| `approved_score.accepted_at` | timestamp / no | index | EVALUATION_PUBLIC / experiment | Evaluation application clock | Evaluation projection/export |

No raw `X` value has a persistence field; token digests are one-way high-entropy control material only. Provider credentials, raw secrets, prohibited ground-truth content in run records, and raw host paths/hashes are structurally absent. PostgreSQL records are authoritative; SQLite, Redis, renderer cache and process memory are not substitute authorities.
