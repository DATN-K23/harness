# Normalized Provider Contract

Normative: yes  
Version: `provider-contract-v2`  
Owner: TV1; collaborators: TV2, TV5  
Requirements: PROV-01–PROV-04, ORCH-02, ORCH-04

## Public project port

Only `harness.modules.model_gateway.public` exposes provider operations. `agent_runtime` sends project-owned `ProviderRequest` and receives project-owned `ProviderResponse | ProviderError`. Provider SDK clients/types and profile implementation details remain private to `model_gateway`.

The primary adapter is `modules/model_gateway/adapters/outbound/providers/openai` and uses the official asynchronous Python SDK Responses API. This path is descriptive source architecture; no adapter is implemented by this blueprint.

### ProviderRequest

| Field | Required | Meaning |
|---|---:|---|
| `provider_profile_ref` | yes | Immutable profile ID, version and content digest; identical for matched arms. |
| `experiment_profile_ref` | real evaluation | Immutable experiment ID/version/digest authorizing this arm/call. |
| `run_id`, `step_id`, `attempt_id` | yes | Opaque safe project correlations. |
| `messages` | yes | Ordered exact sanitized committed model-visible history; no provider thread reference. |
| `tools` | optional | Allowlisted versioned local custom-function definitions only. |
| `response_schema` | final verdict | Exact schema ID/version/digest and native mode mapping. |
| `sampling` | yes | Explicit requested values; unsupported/unknown is represented, not invented. |
| `seed` | optional | Sent only with recorded model capability support. |
| `max_output_tokens` | yes | Reserved output allowance included in preflight. |
| `timeout_ms` | yes | Attempt deadline bounded by run wall clock. |

Forbidden request fields/content include provider credential, raw host path, ground truth, scorer data, hosted-tool configuration, automatic execution callback, provider-owned conversation state and arbitrary native kwargs.

### ProviderResponse

| Field | Meaning |
|---|---|
| `native_request_id` | Safe provider identifier when exposed. |
| `model_id_requested`, `model_id_resolved` | Immutable requested snapshot and safe returned identity; mismatch remains visible. |
| `assistant_content` | Exact sanitized assistant content. |
| `tool_intents` | Ordered normalized call IDs/names/JSON arguments; never executed by adapter. |
| `structured_output_candidate` | Provider-parsed candidate; still independently validated. |
| `finish_reason_native`, `finish_reason_normalized` | Loss-aware termination mapping. |
| `usage_native_safe`, `usage_normalized` | Allowlisted lossless fields plus input/output/cached/reasoning/tool/total where knowable. |
| `timing` | Project attempt start/end/latency; native timing where available. |
| `endpoint_region_safe` | Optional allowlisted endpoint/deployment metadata. |

### ProviderError

Every error includes normalized category, safe native code, retryable-as-capability metadata, attempt identifiers, timing, known usage/cost, and redaction decision. Raw headers, credential fragments and unreviewed native text are forbidden.

| Category | Primary action |
|---|---|
| `pre_network_profile_rejected` | Stop before SDK client/credential/network; configuration failure. |
| `authentication`, `authorization` | Permanent failure; safe operational hint only. |
| `invalid_request`, `unsupported_capability` | Permanent; unsupported known fields should have failed preflight. |
| `content_policy` | Distinct provider outcome, not an invalid Judge verdict. |
| `rate_limited`, `provider_unavailable`, `network`, `timeout` | Recorded transient classification; no retry in primary profile. |
| `malformed_response`, `unknown` | Conservative permanent handling; never fabricate fields. |

## Pre-network gate

Before provider client construction or credential access, validate:

1. provider profile schema/status/`network_ready` and self-digest;
2. exact model snapshot and official SDK version/evidence;
3. capability/context/knowledge-cutoff evidence freshness;
4. pricing version/currency/source and paid-call/cost ceilings;
5. credential owner and approval identities/date/digest;
6. experiment profile status/digest and arm reference;
7. direct/harness profile-digest equality for matched primary pairs;
8. non-streaming, SDK retry zero, project attempts one, local custom functions only.

Any failure returns `pre_network_profile_rejected`. A schema-valid `Proposed` profile is intentionally incomplete and never network-ready.

## Explicit history and one-attempt semantics

`agent_runtime` reconstructs the exact next request from durably committed events and sends the full selected history. The adapter does not use `previous_response_id`, a provider thread, background mode or provider memory as conversation authority.

For primary RQ1, each logical call has exactly one attempt, the SDK retry setting is zero and streaming is disabled. The attempt is persisted even on timeout or unknown outcome. A crash may produce an ambiguous paid attempt; the system records ambiguity and does not silently replay it as the same primary pair. Retry-enabled research requires a distinct flag, snapshot field, acceptance IDs and experiment identity.

## Tool and verdict boundary

Only local `source_access` function schemas may be sent. The adapter and SDK never execute a function or hosted tool. `agent_runtime` dispatches returned intents, commits tool results and builds the next explicit history. A structured-output candidate becomes a verdict only after project JSON Schema, semantic and evidence validation.

## Profile and capability mapping

Every adapter records native source path, transform, absent/unknown behavior, fidelity loss and redaction for each normalized field. `providers/conformance-matrix.md` defines PC-01–PC-12. Unsupported differs from unknown and from false.

`real-primary` is the sole real initial profile and remains Proposed until its separate approval gate closes. `deterministic-scripted-v1` and `deterministic-faults-v1` conform without network, credentials, SDK installation or paid budget.

## Security and module rules

- Provider profile/credential resolution is private to `model_gateway` composition.
- Desktop, `judge`, `agent_runtime`, `source_access`, `evaluation` and `scoring` do not import provider SDKs.
- Credential values are never contract fields, events, logs, exports or model messages.
- Provider requests contain no label, scorer record, raw host path or unregistered content.
- No external proxy, LiteLLM, hosted tool or Agents SDK orchestration exists in MVP.

