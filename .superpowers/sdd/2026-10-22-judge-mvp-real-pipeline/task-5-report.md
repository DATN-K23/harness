# Task 5 report — PoC policy and Foundry sandbox

## Outcome: Opt-in Linux ARM64 adapter implemented and tested; production remains BLOCKED

The exact ARM64 image `ghcr.io/foundry-rs/foundry@sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c` was inspected: Forge 1.5.1 (`b0a9dd9`), UID 10001, no `solc` or Node. A reproducible offline compiler path was verified: official Node v22.14.0 Linux ARM64 archive SHA-256 `08bfbf538bad0e8cbb0269f0173cca28d705874a67a22f60b57d99dc99e30050` (matched Node's published `SHASUMS256.txt`), repository solc-js 0.8.30+commit.73712a01 with bun.lock integrity-pinned dependencies, mounted read-only. A small checked-in test shim delegates Forge's standard JSON input to solc-js, rejects compiler mismatch through a runtime version probe, and avoids network compiler lookup. A real benign Foundry test passed offline in the bounded container. The daemon is Linux ARM64, not production macOS Docker Desktop.

`ConservativePocPolicy` remains a conservative deny-only text screen: it always rejects and never returns `ok`. `DockerFoundrySandbox` is an explicit opt-in adapter (`enabled` defaults false), stages only `.sol` paths obtained through `SourceSnapshotPort` plus the API-supplied test, rejects traversal, applies bounded size/file/line checks, and runs exact-image Docker argv with network none, read-only source/root, writable scratch, nonroot UID, dropped caps, no-new-privileges, memory/CPU/PID/tmpfs limits, timeout, output cap, cancellation/kill, and cleanup. `runStateProbe` is bounded but currently returns no parsed deltas. Tests assert the exact hardened argv and typed outcome classifications; an environment-gated integration test executes benign and assertion-failure fixtures. The adapter is not wired into production composition, and no claim is made for macOS isolation. Production must continue forcing the PoC option off.

## Prerequisites to resume

1. Run the gated integration on Linux ARM64 with exact provisioned toolchain paths; environment gates are deliberately not committed and must never download artifacts during container execution.
2. Verify on supported macOS Docker Desktop configurations bind/root read-only, UID behavior, dropped capabilities/no-new-privileges, tmpfs and CPU/RAM/PIDs, cancellation/kill, output limits and cleanup. Linux evidence is not macOS evidence.
3. Keep `enablePocExecution` false in all production composition until the compiler, adapter and macOS gates pass review. No composition change is part of this task.
4. Replace the deny-only policy with a reviewed parser plus claim/assertion binding before any policy can return `ok`; acceptance remains eligibility, never isolation or proof of exploitability.

## Verification / scope

- Read Task 5 brief, approved design, Task 1 decision, and Task 3/4 reports; inspected current ports and runner permission semantics.
- Focused server suite: 46 passed. Server typecheck and core typecheck passed. `packages/server/test/docker-foundry-sandbox.test.ts` has exact argv, unsafe path pre-launch rejection, compiler mismatch, and outcome classification assertions.
- Live authorized disposable Linux ARM64 run: benign assertion test passed; additional assertion failure test passed via adapter; Forge `--offline`, no secrets, and test/source-only workspace. Exact image and compiler versions are recorded above.
- Host daemon evidence: Linux ARM64 Docker Engine 29.6.1 only. No macOS Docker Desktop validation; root read-only/mount semantics and resource enforcement on supported macOS configurations remain unverified.
- No production composition enablement. No adversarial resource-abuse fixture was run; text policy is not a sound admission filter and denies all. `runStateProbe` does not parse state deltas. No claim of production readiness or macOS isolation proof is made.
- `bun turbo test` remains red in `@harness/core`: 873 pass, 5 fail, all in the pre-existing `test/demo/demo.test.ts` expectations for old enabled-PoC/witness behavior. This is the carried Task 4 stale-demo blocker; focused server tests and all-package typecheck pass.

## Addendum

- Commit `d9285f7` clarifies separate authorization; current user instruction authorizes image inspection, benign integration, and bounded hostile PoCs within the task scope.
