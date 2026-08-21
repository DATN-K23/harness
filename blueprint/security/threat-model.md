# Judge MVP Threat Model

Normative: yes  
Version: `threat-model-v3`  
Owner: TV4; collaborators: TV1, TV6

## Security objectives

1. Preserve evaluation validity by keeping ground truth outside the agent path.
2. Prevent filesystem escape, host discovery, write/execute, and network access.
3. Prevent secrets/prohibited originals from provider traffic, persistence, logs, API, desktop, and export.
4. Preserve run/event integrity under retries, redelivery, cancellation, and stale workers.
5. Make every denial and transformation observable without leaking what was denied.
6. Keep untrusted rendered content behind a least-authority Tauri command boundary.
7. Preserve accepted work across window/native-host exit and coordinated release updates.

## Assets

Authorized source, candidate content, scorer-only labels/adjudication, provider credentials, installation-scoped local credential, release signing keys, compatibility manifests, immutable run configuration, exact sanitized trajectories, evaluation manifests/protocols, cost budget, and research conclusions.

## Actors

- Trusted local operator who may make mistakes but is not treated as a hostile tenant.
- Untrusted candidate/source author capable of prompt injection and crafted paths/content.
- Model output capable of requesting malicious or malformed actions.
- Compromised or confused renderer executing attacker-controlled model/source/trace content.
- External provider and network failures; provider is trusted to process submitted content under its service terms but not to enforce project isolation.
- Stale/failed worker and duplicate queue delivery.
- Future public/multi-tenant attacker is outside deployment scope; public exposure is forbidden.

## Entry points and boundaries

Protected Tauri native commands, local source registration, submission JSON, idempotency header, managed snapshot content, model response/tool arguments, provider errors/metadata, queue delivery, stored event retrieval, desktop rendering, release/update manifest, evaluation manifest, and scorer join. Boundaries are documented in `architecture/containers-and-trust-boundaries.md` and `security/source-registration-and-data-flow.md`.

## Threats, mitigations, and residual risk

| ID | Threat | Mitigation in blueprint | Residual risk / future proof |
|---|---|---|---|
| TM-01 | Ground truth mounted or joined into agent data | Separate scorer store/credential; source-only workspace; forbidden data-flow audit | Runtime deployment/IAM and adversarial tests required. |
| TM-02 | Absolute/traversal/encoded path escape | Literal canonical parser, reject forms, root containment, inventory and real-path recheck before I/O | Platform-specific APIs require implementation tests. |
| TM-03 | Symlink/TOCTOU escape | Symlinks excluded, no-follow walk, immutable read-only tree, checked handle | Filesystem/container behavior must be proven per platform. |
| TM-04 | Prompt injection in candidate/source | Untrusted delimiters, least-authority tools, no shell/network/write, trajectory review | Model reasoning can still be influenced; no complete semantic prevention claim. |
| TM-05 | Secret copied into model/log/trace | Redaction before truncation/persistence/send, allowlisted metadata, secret fixtures | Pattern/config coverage may miss novel formats. |
| TM-06 | Model requests network or process execution | Capabilities absent from tool registry and workspace | Host/container configuration must confirm no alternate channel. |
| TM-07 | Snapshot changes after authorization | Tree digest preflight, immutable mount, inventory, checked handles | Registry compromise is outside agent boundary and needs operational controls. |
| TM-08 | Queue redelivery duplicates cost/events | Idempotent claim, unique event sequence, CAS terminal state, attempt ambiguity record | Paid provider calls cannot be exactly once across crash. |
| TM-09 | Malformed provider output bypasses verdict rules | Provider-independent JSON/evidence validation and bounded repair | Provider-native parser may have schema subset differences. |
| TM-10 | Desktop trace/API discloses blocked path or secret | Safe event schema, bounded projections, disclosure review | Desktop implementation must not render raw adapter exceptions. |
| TM-11 | Split/manifest drift inflates results | Whole-contest schema, freeze digest, scorer-only labels, drift rejection | Dataset provenance can still be incorrect and needs review. |
| TM-12 | Cost denial through loops/retries | Hard steps/tokens/time/cost, retry caps, no-progress detector | External billing may arrive late or differ from estimate. |
| TM-13 | Native picker path leaks into API/log/run/provider/trace | Registration-only ephemeral class; managed snapshot import; raw-path schema and logging exclusion | OS/native crash diagnostics require later platform review. |
| TM-14 | Malicious repository selection or registration race | Runtime canonicalization/authorization, checked handles, bounded inventory, no-follow import and digest | OS/filesystem semantics require per-platform tests. |
| TM-15 | Dynamic plugin/tool fallback expands authority | Immutable four-tool registry; no discovery/install/fallback; composition import checks | A future tool change needs separate threat/ablation review. |
| TM-16 | PoC feature silently grants Judge execution | Separate future VerificationRunner capability/entrypoint and sandbox contract | Future implementation must prove process/IAM isolation. |
| TM-17 | Untrusted rendered content invokes a privileged native operation | Per-window Tauri capabilities, scoped project permissions, typed command validation; no generic filesystem/shell/process/env/URL/credential/updater command | Effective merged permissions and custom-command defaults require packaged review. |
| TM-18 | Local credential falls back to plaintext or renderer custody | Approved OS-protected credential-store adapter, shell-mediated transport, fail closed when unavailable, rotation case | OS/backend availability and access semantics require per-platform proof. |
| TM-19 | Tauri child/window lifecycle terminates accepted work | Independently supervised/detached runtime; no close-to-stop edge; PostgreSQL recovery and rediscovery | OS service/detach behavior requires close/crash/reboot tests. |
| TM-20 | Partial/incompatible update corrupts or strands work | Signed compatibility manifest, active/ambiguous work preflight, explicit reject/quiesce policy, DB compatibility, post-update handshake and rollback | Atomicity differs by OS/package format and must be demonstrated. |
| TM-21 | Signing key or update artifact is exposed/replaceable | Release-CI/operator key custody, OS signing plus mandatory artifact signature, approved channel/manifest digest; renderer receives neither key nor arbitrary artifact URL | Release infrastructure and key recovery/rotation remain future operational evidence. |

## Deployment assumptions

The MVP binds only to loopback or an OS-equivalent local IPC endpoint with installation-scoped access control, runs for one local research operator, and has no public authentication or tenant-isolation contract. The accepted Tauri host derives endpoint and credential from OS-protected state and exposes only the declared project commands. LAN/public bind, reverse proxy, permissive native plugin defaults, insecure credential fallback, or remote multi-user access without a separate security change violates this threat model.

## Claims

The future implementation may claim only that specified boundaries and adversarial cases passed on its recorded platform/configuration. It may not claim full prompt-injection prevention, perfect secret detection, exactly-once provider execution, public deployment safety or PoC verification. The MVP contains no VerificationRunner implementation.
