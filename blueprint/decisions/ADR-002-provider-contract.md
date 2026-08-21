# ADR-002: Direct official SDK behind the project provider port

- Status: `Accepted`
- Version: `adr-002-v2`
- Decision date: `2026-08-14`
- Owner/approvers: TV1 architecture owner and TV5 evaluation owner
- Governing requirements: PROV-01–PROV-04, ORCH-02, ORCH-04, VER-01, DATA-02
- Affected work packages: WP-03, WP-04, WP-08

## Decision scope

This ADR accepts the provider integration strategy, not a model, price, credential, or paid experiment. Those changing values belong to versioned provider and experiment profiles.

The only project contract visible to orchestration is `harness.modules.model_gateway.public`. The first real adapter calls the OpenAI Responses API through the official asynchronous Python SDK and lives at:

`runtime/src/harness/modules/model_gateway/adapters/outbound/providers/openai/`

The adapter translates project-owned requests and responses at the boundary. No provider SDK type, client, credential, retry policy, hosted tool, or native event enters another module.

## Accepted first-adapter behavior

1. Each logical step sends the complete, explicit, committed model-visible history selected by `agent_runtime`; the provider is not the conversation authority.
2. Calls are non-streaming and one-attempt for the primary RQ1 profile.
3. Official SDK automatic retries are set to zero; project retry is disabled for primary direct and harness arms.
4. Only normalized local custom-function definitions may be sent. Tool requests are dispatched by `source_access`; automatic SDK/provider tool execution is forbidden.
5. Hosted tools, provider-owned loops, Agents SDK orchestration and background/provider conversation state are forbidden in MVP.
6. Returned structured data is independently parsed and validated against the project verdict schema. Provider structured-output success is not acceptance.
7. Native request ID, resolved model when exposed, usage, finish/error metadata and timings are preserved through allowlisted mappings; secrets and raw unsafe errors are not.

## Rejected MVP options

| Option | Disposition | Reason |
|---|---|---|
| LiteLLM or another in-process gateway | Rejected for MVP | Adds a semantic/retry layer before native fidelity is established. |
| external provider proxy | Rejected for MVP | Adds trust, logging, latency and failure boundaries without an MVP need. |
| OpenAI Agents SDK orchestration | Rejected for MVP | Provider/library loop ownership conflicts with the project-owned agent state machine and ablation controls. |
| hosted web/file/computer tools | Rejected for MVP | Expands network and execution authority beyond read-only registered source. |
| provider-owned conversation/thread state | Rejected for MVP | Prevents exact committed-history replay and symmetric accounting. |

Multiple providers remain supported by the port and profile schemas. Adding a second adapter does not require changing the agent loop.

## Profile and pre-network gate

`providers/real-primary.profile.yaml` is the only selectable real-provider identity for the initial confirmatory experiment. It remains `Proposed` until it records an immutable model snapshot, official SDK/version evidence, capability/context/cutoff evidence, pricing source/version/currency, credential owner, paid-call and cost ceilings, approval identities/date/digest, and `network_ready: true`.

Before constructing a provider client or reading a credential, `model_gateway` validates the provider profile and experiment-profile cross-reference. Missing, null, floating, unapproved, expired or digest-mismatched fields produce `pre_network_profile_rejected`. No DNS, SDK client construction, token exchange or paid request may occur.

Direct and harness arms reference the same accepted provider-profile identifier and digest. Deterministic profiles do not require a real profile, credential, network, paid budget, or provider SDK.

## Consequences

- Native fidelity and retry behavior are reviewable at one adapter boundary.
- Exact model/pricing/cutoff changes version a profile instead of reopening this ADR.
- Multi-provider support is an interface property from the start, not a gateway dependency.
- Retry-enabled research, streaming, hosted tools, provider state, external gateways and provider-owned agents require separate flags/protocol changes or superseding ADRs.

## Acceptance evidence

Accepted by TV1/TV5 on `2026-08-14` against this `adr-002-v2` content and the project-port boundary in `architecture/agent-runtime-boundaries.md`. Acceptance authorizes blueprint architecture only. It does not approve a credential, model, price, network call, dependency installation or experiment.

