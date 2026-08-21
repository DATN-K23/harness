# Provider Adapter Conformance Matrix

Normative: yes  
Version: `provider-conformance-v1`  
Owners: TV1/TV5

Every adapter/profile must map the following behavior through `model_gateway.public`. `real-primary` evidence is blocked until its profile is Accepted; deterministic rows are blueprint fixture obligations.

| ID | Behavior | OpenAI official async adapter evidence | Scripted/fault evidence | Failure if absent |
|---|---|---|---|---|
| PC-01 | ordered explicit committed history | Responses input mapping; no provider thread ID | unexpected-history fixture | reject request |
| PC-02 | local custom-function schemas/intents | function definition/call mapping; no auto execution | tool-intent fixture | unsupported capability |
| PC-03 | structured response | native response mapping plus independent verdict validation | valid/invalid schema fixtures | validation failure |
| PC-04 | immutable requested/resolved model | request snapshot and safe returned model field | match/mismatch fixtures | preflight or visible mismatch |
| PC-05 | request identity/timing | safe native request ID and project timing | synthetic exact values | explicit unknown, never fabricated |
| PC-06 | native and normalized usage | lossless safe source plus normalization map | complete/missing categories | unknown category retained |
| PC-07 | one primary attempt | SDK retry zero/project attempt one | attempt counter assertion | symmetry rejection |
| PC-08 | normalized errors | native-code mapping table and safe redaction | one fixture/error category | conservative `unknown` |
| PC-09 | timeout/cancellation/late result | project timeout and orphan-attempt rule | fault fixtures | terminal state immutable |
| PC-10 | credentials excluded | client construction only; no serialization | no credential access | security test failure |
| PC-11 | no hosted/provider-owned execution | request allowlist and SDK configuration | forbidden-field fixture | pre-network rejection |
| PC-12 | profile gate | profile and experiment digest before client construction | incomplete-profile fixture | `pre_network_profile_rejected` |

The OpenAI adapter mapping record must state native source path, transformation, absent/unknown behavior, fidelity loss and redaction for every normalized field. A second provider gets a separate versioned mapping record and runs the same IDs; conformance does not mean pretending unsupported fields exist.

