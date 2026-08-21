# ADR-006: Downloadable desktop client over an independent local runtime

- Status: `Accepted`
- Version: `adr-006-v1`
- Decision date: 2026-08-14
- Owner: TV6/TV1
- Collaborators: TV2, TV3, TV4, TV5
- Governing requirements: API-01–API-10, UI-01–UI-06, DATA-05–DATA-06, TOOL-01
- Accepted by: project owner/team lead after product-topology review
- Affected work packages: WP-01, WP-02, WP-05–WP-10

## Decision

Deliver the MVP as one coordinated product consisting of:

1. a downloadable desktop client whose renderer uses React, TypeScript and Vite;
2. a local headless runtime bundle containing daemon, worker, evaluator and scorer process entrypoints from one Python modular-monolith source and compatibility version;
3. PostgreSQL as the durable run/job/event/evaluation authority.

The desktop is a thin presentation/control client. It uses only the generated local-runtime API client. It never imports Python internals, opens PostgreSQL, invokes providers/tools, resolves runtime/scorer credentials, or fabricates authoritative events.

## Local boundary

- The daemon binds only to loopback or an OS-equivalent local IPC endpoint.
- A protected installation-scoped rendezvous record identifies endpoint and runtime instance.
- Requests use a rotatable installation-scoped credential or equivalent OS access control.
- The credential remains in native-shell/OS-protected custody and never enters URLs, renderer persistence, ordinary logs, trajectories or exports.
- Public binding, remote access, production authentication/authorization and multi-tenancy are outside MVP.

This protects a local process boundary; it is not a claim of hostile multi-user isolation.

## Compatibility handshake

Before normal API calls, the generated client obtains runtime identity, API version, canonical contract digest, runtime build, supported capability set and health. Incompatible major/API/digest pairs fail closed. Submission/mutation remains disabled and the UI offers a version-specific restart/update action; it never bypasses the API through direct DB/provider access.

## Lifecycle ownership

Desktop window closure, renderer crash, disconnect, update or reinstall does not cancel an accepted run. PostgreSQL records, work claims, versions, budgets and committed events control recovery. On reconnect the desktop resumes finite cursor polling and de-duplicates by `(run_id, sequence)`.

Runtime shutdown, update and run cancellation are explicit control-plane operations. They observe safe worker boundaries and terminal immutability; closing a window is not a lifecycle command.

## Source registration custody

The native repository picker may return a host path only as ephemeral sensitive input to the source-registration operation. `source_access` canonicalizes, authorizes, snapshots and digests it. Run submission accepts only `source_snapshot_id`; raw host paths never enter run/event payloads, provider traffic, ordinary logs, experiment identity or desktop trace persistence.

## Packaging contract

`packaging/local-runtime/` owns reproducible runtime/PostgreSQL process setup and health checks. Under accepted ADR-007, `packaging/desktop/` owns per-OS Tauri packaging inputs while `apps/desktop/src-tauri/` owns the narrow Rust host. Desktop and runtime use a coordinated compatibility/release policy, but runtime processes remain one modular-monolith release rather than microservices.

The MVP does not promise a single-file, database-free installer. PostgreSQL is not silently replaced by embedded SQLite to simplify packaging.

## Options considered

| Option | Disposition | Rationale |
|---|---|---|
| Public/browser-hosted web application | Rejected for MVP | Conflicts with downloadable local-first product and expands auth/multi-tenancy threat scope. |
| Desktop embeds and owns the agent loop | Rejected | Window lifecycle would become execution authority and weaken crash recovery. |
| Desktop thin client + independent local runtime | **Accepted** | Preserves durable async execution, local repository UX and contract-first separation. |
| Independently deployed backend services | Rejected | Adds distributed release/version/failure ownership without evidence. |

## Consequences

- OpenAPI remains a local process boundary and canonical generated-client source.
- Desktop availability is not required for run correctness.
- Local endpoint access control and compatibility states become required contracts/wireframes.
- ADR-007 selects Tauri 2 and its least-authority/signing/updater boundary; three-OS lifecycle, credential, packaging and rollback readiness remains future WP-01/WP-10 evidence.
- Offline replay remains a later projection over committed events, not desktop-owned authoritative state.

## Supersession

Changing to hosted SaaS, renderer-owned execution, direct desktop database/provider access, embedded SQLite authority or independently released runtime services requires a superseding ADR and threat/migration review.
