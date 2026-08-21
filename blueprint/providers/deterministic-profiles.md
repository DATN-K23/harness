# Deterministic Provider Profiles

Normative: yes  
Version: `deterministic-provider-profiles-v1`  
Owners: TV1/TV5

Deterministic profiles implement `model_gateway.public` without importing or constructing a network SDK. They are valid independently of `real-primary` and are mandatory for architecture, contract, lifecycle and failure-path verification.

| Profile | Fixture key | Covers |
|---|---|---|
| `deterministic-scripted-v1` | profile version + scenario + request digest + step index | ordered messages, local tool intent, structured verdict, exact usage/model/request metadata, repeated response |
| `deterministic-faults-v1` | profile version + fault scenario + attempt index | auth, authorization, rate limit, timeout, network, unavailable, policy refusal, malformed response, unsupported capability, missing metadata |

Rules:

1. Fixtures never inspect wall clock, credential environment or network state.
2. A request digest is over canonical project-owned fields after redaction, not Python/native SDK objects.
3. Recorded fixture values are explicitly synthetic and cannot be reported as real provider cost or model evidence.
4. Both profiles use the same `ProviderRequest`, `ProviderResponse` and `ProviderError` shapes as the real adapter.
5. Tool requests are returned as intents only; the deterministic adapter never executes them.
6. Each scripted step defines expected history digest and rejects unexpected ordering/content.
7. Fault fixtures exercise accounting and terminal mapping without enabling primary retries.

Minimum fixture scenarios are `simple-valid-verdict`, `list-read-search-verdict`, `invalid-verdict-repair`, `tool-denied`, `context-budget`, every normalized provider error, missing usage, model mismatch, late result after cancellation and ambiguous process interruption.

Acceptance checks prove: zero network socket/client construction, zero credential access, stable byte-equivalent normalized result for the same fixture key, independent verdict validation, and substitutability without edits to `judge` or `agent_runtime`.

