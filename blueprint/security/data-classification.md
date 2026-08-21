# Data Classification and Transformation Order

Normative: yes  
Version: `data-classification-v3`  
Owner: TV4; collaborator: TV5  
Requirements: EVAL-06, TOOL-01, TOOL-04, DATA-04

## Classification labels

| Label | Meaning |
|---|---|
| `PUBLIC_SAFE` | Safe for the protected local API/desktop and approved research export. |
| `AGENT_UNTRUSTED` | Model may see it, but content can contain prompt injection and secrets. |
| `CONTROL_INTERNAL` | Trusted control-plane metadata not sent to the model. |
| `EPHEMERAL_SENSITIVE` | May exist only in one protected control-plane operation and must be discarded before durable or model-visible boundaries. |
| `SCORER_ONLY` | Available only after terminal execution under scorer credential. |
| `EVALUATION_PUBLIC` | Versioned aggregate-safe acceptance fields produced by scorer and accepted by `evaluation.public`; contains no label/adjudication. |
| `SECRET` | Credentials/tokens; never persisted in blueprint-defined run records. |
| `PROHIBITED` | Ground truth and disallowed originals; must not cross the agent/run boundary. |

## Data inventory

| Data | Class | API input | Workspace/tools | Provider | Run persistence/trace | Desktop/run export | Scorer/reporting |
|---|---|---:|---:|---:|---:|---:|---:|
| Canonical `CandidateFinding` | AGENT_UNTRUSTED | yes | visible as bounded task input | yes, delimited | exact sanitized visible form | protected desktop projection | prediction input reference |
| Authorized source bytes | AGENT_UNTRUSTED | snapshot ID only | read-only bounded access | selected tool result only | exact sanitized visible result/reference | authorized evidence/trace | snapshot reference |
| `SourceSnapshot` ID/revision/digest | CONTROL_INTERNAL/PUBLIC_SAFE | ID | registry resolves root | IDs/digests only as needed | yes | summary/export | case identity |
| Native-picker raw host path | EPHEMERAL_SENSITIVE | source-registration operation only | private adapter until managed snapshot import | no | no | no | no |
| `GroundTruthLabel` | SCORER_ONLY | no | no | no | no | no | yes after terminal |
| Adjudication rationale/report | SCORER_ONLY | no | no | no | no | no | scorer provenance only |
| Label, adjudication and detailed score join | SCORER_ONLY | no | no | no | scorer schema only; never run/event | no | scorer/research-controlled only |
| `ApprovedScoreV1` | EVALUATION_PUBLIC | no Judge route | no | no | evaluation-owned record, not run trajectory | approved aggregate evaluation view only | produced by scorer, accepted by `evaluation.public` |
| Contest/source-family manifest contents | CONTROL_INTERNAL | version/ref only | no | no | version/digest/split/family IDs only | research config summary | yes |
| Provider credential/header | SECRET | no | no | adapter injection only | no | no | no |
| Local-runtime installation credential | SECRET | injected by Tauri transport only | no | no | no | never renderer-visible | no |
| Release signing/notarization private key | SECRET | no; release CI/operator custody only | no | no | no | no | no |
| Signed compatibility/update manifest | CONTROL_INTERNAL/PUBLIC_SAFE projection | digest/target versions/policy | no | no | lifecycle operation/result only | bounded version/active-work/recovery state | no label content |
| System prompt/tool/schema | CONTROL_INTERNAL + model-visible | config ref | no | exact resolved content | exact sanitized content/ref | trusted trace/config | experiment digest |
| Model response | AGENT_UNTRUSTED | no | orchestration only | origin | sanitized exact content | bounded trace/verdict | prediction |
| Tool arguments/results | AGENT_UNTRUSTED | no | bounded authorized | result returned to model | sanitized exact visible form | bounded trace | trajectory evaluation |
| Security event | PUBLIC_SAFE/CONTROL_INTERNAL | no | emitted by boundary | no | safe rule/category only | safe indicator | aggregate safety metrics |
| Pricing/model cutoff evidence | CONTROL_INTERNAL | approved ref | no | request metadata only | version/ref | research config | reporting |

## Transformation order

The only permitted order before provider, persistence, ordinary logging, API, desktop projection, or export is:

1. **Classify and authorize:** resolve the data source and reject any scorer-only, secret, prohibited, or outside-root flow not explicitly allowed.
2. **Redact:** replace configured secrets and prohibited fragments deterministically with typed markers; emit a safe transformation/security record.
3. **Delimit:** wrap candidate/source/tool content as untrusted data, never executable instruction.
4. **Bound/truncate:** apply deterministic byte/line/match limits to the already-redacted form.
5. **Digest:** compute stored pre-truncation digest over sanitized content; compute exact model-visible digest after truncation.
6. **Persist/send:** only now may the sanitized bounded representation enter a model request, run event, ordinary log, API projection, desktop view, or export.

Raw secrets, ground truth and raw host paths are never hashed into run-visible records because low-entropy hashes can leak by guessing. The registration handler may hold a path only until it imports or rejects the source, then releases it; access/error logs receive only safe operation/category/correlation fields.

## `GroundTruthLabel`

The label store uses a credential/schema available only to the scorer process. The evaluator schedules cells by opaque `case_id` and accepted profile/manifest digests without loading labels. Only after a run becomes immutable terminal may the scorer resolve `case_id`, write scorer-only detail and submit `ApprovedScoreV1` through `evaluation.public`. No label value or adjudication/scorer text is copied into `run`, `run_config`, `trajectory_event`, `step`, `provider_attempt`, `tool_call`, `security_event`, verdict, local-runtime OpenAPI, desktop, ordinary log or agent-visible export.

## Logging rule

Ordinary logs contain correlation IDs, safe categories, durations, counts, and rule IDs only. Exact model-visible content belongs in the redacted trajectory store under controlled access, not console/application logs.
