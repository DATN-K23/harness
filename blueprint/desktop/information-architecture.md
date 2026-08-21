# Desktop Trace Experience Information Architecture

Normative: yes  
Version: `desktop-ia-v4`  
Owner: TV6  
Requirements: UI-01–UI-06, API-03–API-10

## Product boundary

The downloadable desktop uses React/Vite under `apps/desktop/ui/` and the accepted Tauri 2 Rust host under `apps/desktop/src-tauri/`. Judge data is backed only by the generated client whose later canonical source is `contracts/openapi/local-runtime.v1.openapi.yaml` and destination is `apps/desktop/ui/src/generated/runtime-client/`; this blueprint's `contracts/async-api.openapi.yaml` defines that future source. Generated output is reproducible and never manually edited. Its injected Tauri transport accepts only allowlisted generated operation IDs/payloads and derives endpoint/credential natively. Neither renderer nor Rust host reads PostgreSQL, runtime Python, source tools, provider SDKs, ground truth or scorer records directly. Renderer cache is disposable projection, not authority.

## Primary views

| View | Purpose | Primary local-runtime data | Never shown |
|---|---|---|---|
| runtime connection | starting/health/authorization/version/reconnect state | `/health`, `/runtime-info` handshake and safe recovery action | local credential, executable command, raw internal error |
| repository registration | invoke native picker then register source | ephemeral picker input; safe snapshot response | retained/raw path after registration, adjacent contest data |
| new Judge run | canonical finding and approved configuration | registered snapshots, provider/profile/config catalog | label, credential, direct host path |
| run detail | status, config, ordered trace, terminal result | run view plus cursor event pages | scorer label/adjudication, prohibited original |
| evidence | authorized run-bound source excerpt | evidence ordinal/snapshot-bound projection | arbitrary URL/path input or adjacent file |
| evaluation | safe experiment status/approved aggregates | evaluation public projection | scorer-only schema/raw label query |
| runtime lifecycle | explicit shutdown/update preparation with active-run warning | generated lifecycle operations and safe recovery state | implicit window-close shutdown, arbitrary command/download |

## Native interaction surfaces

| Surface | User-visible action | Authority limit |
|---|---|---|
| runtime connection | retry, start-or-attach, rotate/restart after safe error | no arbitrary executable/endpoint/PID/signal input |
| generated runtime request | use application controls backed by canonical operations | no raw credential, arbitrary URL/method or direct daemon escape |
| repository registration | click picker and confirm registration | short-lived path only; no generic renderer file browsing/read/write |
| notification | receive bounded local status | no untrusted HTML, URL fetch or executable action |
| update | review version, compatibility, active-work and confirmation state | no direct installer invocation, artifact URL or signing-key access from renderer |

Untrusted source/model/trace content cannot invoke a native surface. The main-window Tauri capability excludes generic filesystem, shell, process, environment, opener/arbitrary URL, raw credential and direct updater commands. Any new renderer-to-native operation requires a typed contract, scoped permission, TV4 review and updated acceptance mapping.

No route accepts a filesystem path in URL/query. Evidence navigation uses a persisted ordinal bound to run and snapshot.

## Run page regions

1. connection/banner state and stale/reconnect indicator;
2. run identity/state/timestamps and legal cancellation;
3. immutable config/provider/prompt/tool/schema/flag/budget/pricing/snapshot summary;
4. aggregate steps/attempts/tools/tokens/latency/cost/security blocks;
5. ordered committed trace;
6. terminal panel—verdict only for `completed`;
7. reproduction digests/export references and stochastic-replay caveat.

## Navigation and recovery

- Successful submission returns `run_id` immediately and opens its view.
- Poll finite status/event resources with bounded backoff and opaque cursors.
- Window/Tauri-host reload or reopen reconstructs from local-runtime resources; the independently supervised runtime is never stopped by host exit.
- `Committed so far` never appears as final verdict.
- Runtime failure preserves last safe projection with an explicit stale state.
- Compatible reconnect resumes by sequence; incompatibility disables mutation and requests coordinated update.
- Cursor pages are finite and PostgreSQL-authoritative; local timestamps/cache do not invent ordering or terminal state.

## Accessibility and safety

State/security meaning never relies on color. Text is escaped; untrusted Markdown/HTML/URLs never execute or fetch. Units and UTC timestamps are explicit. Copy/export uses the same safe API projection. The desktop offers no `show original` path for redacted, truncated or blocked content.

Contract generation fails when the OpenAPI digest drifts, generated output differs after regeneration, a schema outside the public allowlist becomes reachable, or any scorer-only schema enters the graph. The Tauri host may mediate protected transport, credential, picker, notification and lifecycle/update preparation but cannot bypass the generated API into Python, PostgreSQL, provider, tools or scorer. Native permission review also fails if an undeclared project command or generic privileged plugin becomes renderer-callable.
