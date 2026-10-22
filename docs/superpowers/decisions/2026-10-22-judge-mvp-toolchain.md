# Judge MVP Solidity / Foundry Toolchain Decision

**Status:** Bounded analysis profile selected; Linux ARM64 disposable-container execution verified for the documented offline toolchain. Production enablement remains **BLOCKED** pending macOS Docker Desktop isolation validation and reviewed PoC claim binding.
**Date:** 2026-10-22

## Decision

- Use the Solidity compiler's Standard JSON AST output as the initial BCE parsing substrate, with source locations resolved against the immutable snapshot's UTF-8 bytes. Use compiler-resolved artifacts only as positive context (declarations, inheritance, calls); absence of an edge is never evidence that a path does not exist.
- Task 3 verification pins the embedded `solc` npm package to `0.8.30` (`solc.version()` must begin `0.8.30+commit.73712a01`), with lockfile integrity and package `LICENSE` verified as MIT. `solc-js` includes its compiler build; it does not download a compiler at runtime. This pin covers the bounded local AST parser only, not the Foundry sandbox image or production runtime.
- MVP analysis profile: Solidity sources read from the immutable snapshot, no dependency installation, compiler download, external import callback, remapping to outside paths, or network access. Imports must be explicit relative paths resolving within the snapshot; unresolved imports, unsupported pragmas/compiler features, source/project bounds, or parse/compile failures mark BCE incomplete and cannot support a negative verdict.
- BCE compiler profile is exact `solc` 0.8.30 only. It does not silently select/download another version. Foundry runtime compiler/image selection and broader project compatibility remain unverified.
- Slither is not selected for the MVP. It offers useful AST-derived information, but its AGPL-3.0-or-later licensing and Python/crytic-compile/solc toolchain are additional distribution and reproducibility obligations; no existing repo installation was found. Reconsider only with an explicit licensing decision and pinned offline environment.
- No soundness or completeness claim is made for this BCE, compiler AST or any call graph. Unsupported/missing edges mean incomplete, not blocked.

## Foundry image and execution status

Registry inspection returned the platform-specific ARM64 manifest digest:

`ghcr.io/foundry-rs/foundry:stable@sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c` (`linux/arm64`)

The digest pins immutable content. Inspected on Linux ARM64 Docker Engine 29.6.1: image user is `foundry` (UID 10001), Forge 1.5.1-stable (`b0a9dd9`), no bundled `solc` and no Node. The image is usable with separately mounted, verified offline compiler artifacts. Node v22.14.0 official Linux ARM64 archive SHA-256 is `08bfbf538bad0e8cbb0269f0173cca28d705874a67a22f60b57d99dc99e30050`; it was checked against Node's published `SHASUMS256.txt`. solc-js 0.8.30+commit.73712a01 and its lockfile-pinned dependencies were mounted read-only. A bounded wrapper reports the exact compiler version, ignores only Forge's `--allow-paths` pair (imports are staged within the immutable workspace), passes Standard JSON to solc-js and strips its non-JSON SMT notice. A benign Foundry test compiled and passed offline. This demonstrates Linux ARM64 compatibility only; assertion/setup/timeout/cancellation classification remains covered by adapter tests, while macOS daemon enforcement remains unverified.

The adapter creates a per-run temporary workspace exclusively from `SourceSnapshotPort` reads plus the stitched test, then mounts source read-only and scratch writable. Docker argv uses the pinned image digest, network none, read-only root, UID 10001, cap-drop all, no-new-privileges, memory/CPU/PID limits, bounded tmpfs, and offline Forge mode. The implementation is opt-in and is not wired into production composition. Linux control behavior is not evidence for macOS Docker Desktop. The text policy remains deny-only and can never return `ok`; it is not a parser, assertion binder, or sandbox.

Required controls before enabling runtime:

- Docker daemon must be a deliberately trusted local daemon. On macOS, Docker Desktop runs Linux containers in a Linux VM, with explicit host file sharing; this is not equivalent to a security proof. Use a dedicated, minimal read-only input mount and a separate bounded writable output/scratch mount. Never mount the Docker socket, home directory, credentials, or the mutable workspace.
- `--network=none`; `--read-only`; run as a dedicated non-root numeric UID/GID (verify writable mount ownership); `--cap-drop=ALL`; `--security-opt=no-new-privileges`; no privileged mode/devices; bounded memory, CPU, PIDs and wall-clock timeout; tmpfs only for explicitly bounded scratch paths; remove container after execution.
- Mount the immutable snapshot read-only and stage only an already-approved stitched test in the isolated writable area. Preserve host-side snapshot/path authorization; container isolation does not replace it.
- Verify daemon enforcement, bind-mount semantics, UID behavior, cgroup resource limits and exact image on the supported macOS Docker Desktop versions before considering execution enabled. Current sandbox defaults (`networkMode`, timeout, memory/CPU, read-only root) are contracts/defaults, not proof that an adapter actually enforces all controls.

Host evidence in this research checkout was Linux ARM64 Docker Engine 29.6.1, not macOS Docker Desktop; it does not establish the target macOS daemon trust assumptions. No hostile workloads were run. As required by the design, until all controls and image metadata are verified, the sandbox adapter must fail closed and submissions needing runtime evidence remain unverified/inconclusive.

## Alternatives considered

| Candidate | Decision / reason |
|---|---|
| `solc` Standard JSON AST | Selected as a narrow parser/source-location substrate. Compiler itself does not provide a complete semantic security call/data-flow model; deliberately treat it as incomplete context. |
| Slither + crytic-compile | Not selected: AGPL-3.0-or-later and Python/compiler-management surface require a separate licensing and offline reproducibility review. No repo installation found. |
| Existing Harness source tools | Reuse for snapshot-safe reads and path validation only. `read_file`, `grep`, `glob`, `list_dir` are not Solidity parsers or BCE/call graphs. |
| Foundry Docker image by tag | Rejected: mutable tag alone is not reproducible. A registry-observed ARM64 digest is recorded above as a candidate, not approved runtime configuration because image contents were not inspected. |

## OpenCode reference reuse map

The requested `.opencode_reference` checkout is absent in this repository (`find`/`ls` found no directory), so direct upstream module inspection was not possible. Existing adapted modules in the repository show the established attribution commit `3f393d78bf` and MIT notice convention. Reuse the current Harness-owned implementations rather than copying anything:

| Concern | Compatible Harness code / action |
|---|---|
| Orchestration | `packages/core/src/runner/judge-runner.ts` and `judge-step.ts`: retain orchestration and ports; no OpenCode runtime coupling. |
| Context | `packages/core/src/context/context-engine.ts`: bounded context shaping; reuse only if BCE output is explicitly marked incomplete and snapshot-derived. |
| Provider | Existing `packages/llm/src/gateway/` adapter: provider-neutral port remains compatible; inspect locally as implementation proceeds, do not import upstream framework abstractions. |
| Process/sandbox | `packages/core/src/sandbox/sandbox-runner.ts` is a constraints contract/defaults, not a verified Docker process adapter. No compatible upstream sandbox module could be inspected. |
| Source access | `packages/protocol/src/ports.ts` `SourceSnapshotPort` and current snapshot-backed tools: compatible boundary; analysis must not bypass it. |

No upstream files were copied or modified; no new attribution header is required by this decision-only change.

## Sources / evidence

- Repository brief: `.superpowers/sdd/2026-10-22-judge-mvp-real-pipeline/task-1-brief.md`.
- Approved scope: `docs/superpowers/specs/2026-10-22-judge-mvp-design.md`, especially BCE incomplete semantics and runtime stop criteria.
- Context: `docs/tv4-judge-pipeline-proposal.md` (proposal only, not implementation authority).
- Contracts: `packages/protocol/src/ports.ts` (`IngestionPort`, `SanitizerPort`, `SandboxPort`, `SourceSnapshotPort`).
- Existing runner and sandbox constraints: `packages/core/src/runner/judge-runner.ts`, `packages/core/src/sandbox/sandbox-runner.ts`, `packages/core/src/context/context-engine.ts`.
- Existing package manifests: root and `packages/core/package.json`; no Solidity/Slither dependency or local `solc`, `forge`, `slither` executable found.
- Commands: `ls -la .opencode_reference` -> absent; `find . -maxdepth 3 ...` -> no Solidity/Foundry reference/tool directories; `command -v slither/solc/forge` -> none; `docker version` -> Docker Engine 29.6.1, linux/arm64; `docker manifest inspect ghcr.io/foundry-rs/foundry:stable --verbose` -> ARM64 manifest digest above; `docker image inspect ...` -> image not present locally. Docker CLI help confirmed availability of required flags (`--network`, `--read-only`, `--user`, `--cap-drop`, `--security-opt`, `--memory`, `--cpus`, `--pids-limit`, `--tmpfs`, `--mount`); this proves CLI support only, not daemon behavior.
- Research search results: Slither AGPL-3.0-or-later and solc AST `src` byte-offset/source-id mapping; Docker Desktop macOS Linux-VM and host file-sharing trust model. These are orientation only; runtime enablement requires primary-source/documentation and local target validation.
