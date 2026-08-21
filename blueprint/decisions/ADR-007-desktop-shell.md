# ADR-007: Tauri 2 native desktop shell, signing, and updater boundary

- Status: `Accepted`
- Version: `adr-007-v2`
- Decision date: 2026-08-19
- Owner: TV6
- Collaborators: TV1, TV4
- Governing requirements: API-04, API-06–API-10, UI-01, UI-04–UI-06
- Accepted by: project owner after ADR-007 option review
- Approval scope: native-host family and authority boundary; distribution readiness remains unproven
- Planning evidence: proposal `sha256:2ea42e08578df7f19bfbcbdcfd62cb69db0e9b00e4a4cb48014663c1f8e30b55`, design `sha256:8a966115fd3f86ebc44857530a0c8a42b1654c184f688e0b560d4269209ab864`
- Affected work packages: WP-01, WP-07, WP-10
- Does not authorize: source scaffolding in this blueprint change, release signing-key creation, installer publication, or claims that the readiness spike passed

## Fixed context

ADR-001 accepts React/TypeScript/Vite for the renderer. ADR-006 accepts a thin downloadable desktop over an independent Python/PostgreSQL runtime. This ADR selects only the native OS host responsible for windows, runtime discovery/start-or-attach, repository selection, protected local credential mediation, notifications, OS signing integration, and coordinated updates. It does not reopen the renderer, runtime, database, canonical contracts, generated-client boundary, or PostgreSQL execution authority.

## Decision

Select **Tauri 2** with a narrow Rust host under the future `apps/desktop/src-tauri/` tree.

The Tauri host is an OS adapter, not a Judge business capability or an alternate runtime composition root. The React/Vite renderer remains a generated-local-runtime-client consumer. Renderer-to-native access is deny-by-default and described by explicit per-window capabilities, project permissions/scopes, and typed commands. The allowed command families are limited to:

- runtime discovery, start-or-attach, health, and compatibility status;
- shell-mediated authenticated local-runtime requests without disclosing the installation credential;
- an operator-initiated native repository picker whose result is used only for source registration;
- local notifications containing safe projection data;
- update availability and explicit coordinated-update preparation.

The renderer receives no generic filesystem, shell, process, environment-variable, arbitrary-URL, raw-credential, direct-updater, database, provider, Judge-tool, or scorer capability. Displayed model/source/trace content cannot widen this allowlist. A new native authority requires a versioned command/permission change, TV4 review, and updated acceptance evidence.

## Runtime lifecycle boundary

The Python daemon, worker, evaluator, scorer, and PostgreSQL are independently supervised or detached from the Tauri window/native-host lifecycle. A runtime executable may be bundled as distribution payload, but it cannot remain an ordinary Tauri child whose handle, parent exit, or last-window close terminates accepted work.

Tauri discovers an OS-protected rendezvous record and starts or attaches through a platform lifecycle adapter. PostgreSQL records, work claims, versions, budgets, and committed events remain authoritative. Closing or crashing the renderer/native host issues no implicit run cancellation or runtime shutdown; a later compatible desktop rediscovers the runtime and resumes finite cursor polling.

## Credential and repository custody

The installation-scoped local credential remains behind an approved OS-protected credential-store adapter. Windows, macOS, and Linux backends, access scope, rotation, and unavailable-backend behavior must be declared during readiness work. If an approved secure backend cannot be established, connection fails closed: no plaintext file, renderer storage, anonymous access, or silent insecure fallback is allowed.

Tauri Stronghold or another encrypted store is not automatically equivalent to an OS credential manager; it may be selected only after its threat model and custody evidence satisfy the same contract. The renderer receives at most a shell-mediated request capability or least-lived non-persisted session representation, never a long-lived raw secret.

The repository picker returns an operator-selected path only as short-lived sensitive control-plane input. It is sent once through source registration, discarded after success/failure handling, and never grants the renderer or model arbitrary filesystem authority. All later flows use `source_snapshot_id`, immutable revision, tree digest, and approved source-relative evidence.

## Signing and coordinated update

Tauri's updater is the signed native artifact transport, not the complete product update protocol. A project-owned update coordinator must verify:

1. OS code signing/notarization as applicable and the Tauri update-artifact signature;
2. release channel plus desktop/runtime/API/contract/database compatibility manifest;
3. active, claimed, and ambiguous paid work before mutation;
4. one explicit policy: `reject_if_active` or operator-confirmed `quiesce_then_stop` at safe worker boundaries;
5. post-install runtime health and compatibility before re-enabling mutations;
6. rollback behavior that preserves committed state and ambiguous-attempt evidence.

Signing private keys belong to release CI or an explicit release-owner secret boundary. Renderer and runtime processes never receive them. Losing the updater or closing the desktop is not cancellation and cannot erase committed work.

## Candidate comparison

| Candidate | Architecture fit | Decision | Remaining evidence |
|---|---|---|---|
| Tauri 2 + system webview + narrow Rust host | Keeps React/Vite, supports explicit capabilities/permissions and native integration without bundling a Node/Chromium authority into the thin host. | **Accepted** | Three-OS packaging, system-webview variance, lifecycle, secure-store, signed-update, rollback, reproducibility, startup/memory/bundle measurements. |
| Electron + bundled Chromium/Node | Mature React desktop ecosystem and consistent renderer, but adds preload/IPC/Node/Chromium privilege and update maintenance this thin client does not need. | Rejected as primary; contingency only through a superseding ADR. | Would still require strict sandbox/IPC/sender validation, secure-store checks, Linux distribution/update design, and independent runtime proof. |
| Python-hosted webview/native UI | Reuses Python knowledge, but no nominated candidate demonstrated an equally clear React/Vite, per-window permission, signing, and three-OS updater boundary. | Rejected for MVP. | A future concrete candidate must satisfy the same matrix through a superseding ADR. |

Bundle size alone is not the decision. The primary reason is the smallest reviewable native-authority surface for a trace UI that displays untrusted model/source content while the independent Python runtime owns all Judge behavior.

## Official documentation evidence

Sources were reviewed for the 2026-08-19 decision. They establish available framework mechanisms, not project readiness evidence.

| Evidence | Official source | Decision use and limit |
|---|---|---|
| Tauri capabilities | [Capabilities](https://v2.tauri.app/security/capabilities/) | Supports per-window/webview capability sets; merged capabilities and custom-command exposure still require project review. |
| Tauri permissions | [Permissions](https://v2.tauri.app/security/permissions/) | Supports command allow/deny scopes; a plugin default cannot substitute for the explicit project allowlist. |
| Native picker | [Dialog plugin](https://v2.tauri.app/plugin/dialog/) | Supports operator path selection; it does not authorize runtime/model filesystem access. |
| Signed updater | [Updater plugin](https://v2.tauri.app/plugin/updater/) | Supports signed update artifacts on Windows/Linux/macOS; it does not coordinate Python runtime, PostgreSQL migrations, active work, or rollback by itself. |
| Encrypted store | [Stronghold plugin](https://v2.tauri.app/plugin/stronghold/) | Demonstrates encrypted secret storage but is not presumed equivalent to each OS credential manager. |
| Electron hardening/store | [Security](https://www.electronjs.org/docs/latest/tutorial/security), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) | Confirms Electron can be hardened while leaving preload/IPC/Node and Linux secure-backend fallback review to the project. |
| Electron updater | [autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater) | Documents built-in macOS/Windows updating and no equivalent built-in Linux path. |

## Required readiness spike

ADR acceptance selects the host family; it does **not** claim distribution readiness. Before a native release is considered ready, WP-01/WP-10 must produce reproducible evidence that a minimal package:

1. builds on every claimed Windows/macOS/Linux target and records unsupported combinations;
2. discovers, starts or attaches to a dummy-compatible independently supervised runtime;
3. performs compatible and incompatible runtime/API/contract-digest/capability handshakes;
4. uses and rotates an OS-protected local credential without renderer persistence, and fails closed when no approved backend exists;
5. uses the repository picker only for registration and retains no raw path in later requests, logs, traces, or desktop state;
6. closes/crashes/reopens while synthetic committed work continues and can be rediscovered;
7. denies undeclared native commands from untrusted rendered content;
8. demonstrates signed update availability, active-work rejection/quiesce, interruption, incompatible partial update, post-update health, and rollback states;
9. reproduces a clean-machine build with pinned Rust/Tauri/plugin and JavaScript toolchains;
10. records measured startup, memory, and bundle evidence rather than marketing estimates.

No provider call, contest data, Judge implementation, scorer access, installer publication, or production signing key is part of this blueprint application.

## Consequences

- The future physical desktop tree uses standard `apps/desktop/src-tauri/` configuration and Rust ownership next to `apps/desktop/ui/`.
- Rust is limited to native-host integration; Judge/domain logic remains in the Python modular monolith.
- System-webview and per-OS packaging variance become explicit release risks and test-matrix obligations.
- Shell implementation may begin only in a separate implementation change and cannot be called complete until readiness evidence passes.
- Failure of one readiness case pauses distribution for that target and triggers remediation or a superseding ADR; it does not silently switch to Electron.

## Supersession

Changing the host family, granting renderer generic native authority, coupling runtime lifetime to the desktop, replacing OS-protected credential custody, or weakening coordinated signed-update behavior requires a superseding ADR with TV6/TV4 review, measured incompatibility evidence, migration impact, and project-owner approval.
