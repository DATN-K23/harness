# Task 1 Report — Judge MVP toolchain audit

## Outcome

Created `docs/superpowers/decisions/2026-10-22-judge-mvp-toolchain.md`. Selected a bounded Solidity Standard JSON AST analysis profile, with incomplete-by-default semantics and no negative claim from missing graph edges. Slither was not selected. The Foundry registry manifest ARM64 digest is recorded as a candidate, but runtime execution is **BLOCKED** because image contents and target macOS isolation controls have not been verified. No production code or dependencies changed; no hostile Docker workload was run.

## Inspected

- Task brief, approved Judge design, TV4 proposal and repository instructions.
- `packages/protocol/src/ports.ts`: ingestion, sanitizer, sandbox and snapshot interfaces.
- `packages/core/src/runner/judge-runner.ts`, `packages/core/src/runner/judge-step.ts`, `packages/core/src/judge/bidirectional-verifier.ts`.
- `packages/core/src/sandbox/sandbox-runner.ts`, `packages/core/src/context/context-engine.ts`, existing snapshot tools.
- Root and core package manifests; existing OpenCode attribution headers.
- `.opencode_reference`: absent; could not inspect upstream files.

## Alternatives and decision

Decision and rationale are detailed in the created decision record. Summary: compiler Standard JSON AST gives deterministic syntax/location context when exact compiler selection is project-pinned; it is not a complete BCE/call graph, so missing edges remain incomplete. Slither has materially broader analysis but AGPL-3.0-or-later licensing plus Python/crytic-compile/solc management make it a larger distribution/reproducibility decision, with no installed repo tool. Existing Harness snapshot-backed tools are reusable for authorized reads, not AST/BCE. Do not add dependencies in this task.

Foundry manifest query returned an ARM64 digest, `sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c`, for the mutable `stable` tag. The digest is immutable, but the image was not present locally and was not pulled/inspected; versions and runtime behavior are unknown. It is therefore only a candidate, not a trusted, approved runtime pin. Runtime stays blocked. The policy requirements (no network, non-root numeric identity, all capabilities dropped, no-new-privileges, read-only root/input mount, bounded tmpfs/output, resource caps, timeout, no socket/secrets) and macOS Docker Desktop VM/file-sharing trust caveat are recorded in the decision document.

## Commands and results

- `git status --short`: found pre-existing unrelated user changes in `.gitignore`, old sprint plan, server test, new plan and specs; preserved them.
- `git rev-parse HEAD`: starting commit `381f31220436daa1f3025be544a74c326f603307`.
- `bun --version`: `1.4.3`.
- `command -v slither/solc/forge`: none found.
- `docker version --format ...`: `29.6.1 linux/arm64`.
- `docker info --format '{{json .SecurityOptions}}'`: `seccomp=profile=builtin`, `cgroupns`.
- `docker manifest inspect ghcr.io/foundry-rs/foundry:stable --verbose`: returned multi-platform OCI index; ARM64 manifest digest recorded above.
- `docker image inspect ghcr.io/foundry-rs/foundry@sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c`: image absent locally.
- `docker run --help`: supports controls including `--network`, `--read-only`, `--user`, `--cap-drop`, `--security-opt`, memory/CPU/PID limits, tmpfs and mounts. This does not show actual daemon enforcement.
- Search research summarized: Slither AGPL licensing; solc AST `src` byte-offset/source-id mapping; Docker Desktop macOS Linux VM and file-sharing trust model. No hostile workload or Foundry test was executed.

## Concerns / limitations

- Search summaries are not sufficient evidence to bless an image or macOS sandbox. Pulling/inspecting a production candidate and testing hardening under supported macOS Docker Desktop configurations is a gate before enabling runtime.
- Exact Solidity compiler version range remains intentionally unset until image contents and project-level compiler resolution can be verified. Any unresolvable import/compiler error makes BCE incomplete.
- A Solidity AST is not proof of call/data-flow completeness; no soundness or completeness claims.
- Reference source checkout missing; compatibility map is based on current repository implementations and attribution headers only.
- No tests applicable to this research-only decision; no production tests run.

## Commit

`889c49ba2461d9b5052948b3726720538a5494ee` (`docs: decide Judge MVP Solidity toolchain`). Only the decision and this report were committed; pre-existing unrelated worktree changes remain untouched.
