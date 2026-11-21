# @harness/core

The TV1 Judge agent loop: stages 1-3 with zero-token fast-reject, the reasoning loop (`JudgeRunner`, `JudgeStep`), retry,
parallel tool dispatch, compaction, cooperative cancellation, crash recovery by hydration, the event sink and bus, and
deterministic fakes for every port. It depends only on `@harness/protocol`. It has no provider SDK, database driver or
Docker code: everything outside the loop is a port (see below).

## Install

Bun 1.3.14 is required (the workspace pins it in `packageManager`).

```sh
bun install            # at the repo root
```

On Windows with Git Bash, `bun` may not be on `PATH` when it was installed through npm; add the npm global directory
first:

```sh
export PATH="$PATH:$(cygpath "$(npm prefix -g)")"   # cygpath turns C:\... into the /c/... form Git Bash needs
```

## Commands

Run all of these from `packages/core` (at the repo root `bun run test` delegates through turbo).

| Command | What it does |
| --- | --- |
| `bun run typecheck` | `tsc --noEmit` for the package. At the repo root, `bun run typecheck` checks every package. |
| `bun test` | The whole suite: unit, scenario, architecture and stress tests. |
| `bun run demo` | Runs the four judge scenarios offline (confirmed exploit through Tier 2 with a state probe, missing PoC, cheating PoC, failing PoC), prints a table of state, reason, steps, tokens and cost, and writes one seven-pillar bundle per scenario to `demo-output/<scenario>/`. The repo root `bun run demo` delegates here. |
| `bun run stress` | Runs 100 seeded runs over the scenario mixture (the last 10 concurrently), checks the per-run invariants and writes `demo-output/reliability-report.json`. Exits 1 on any violation or unhandled error. |

Everything is offline and deterministic: the demo and stress runs use scripted ports, a fake clock, a seeded random
source and a fake sleep. `demo-output/` is git-ignored.

### Demo bundle

Each scenario directory holds the seven pillars of the demo specification:

| File | Pillar |
| --- | --- |
| `01-verdict.json` | Structured verdict (evidence items carry a snippet and a digest). |
| `02-dossier.md` | Audit dossier rendered from the verdict by a fixed template (no model call). |
| `03-trajectory.json` | Run summary and the ordered events. |
| `04-exploit-proof.json` | PoC, raw trace, state-delta table and anti-cheat report; a `reason` when no execution happened. |
| `05-context-economics.json` | Per-step context allocation and tokens saved; a `reason` when no model call was made. |
| `06-event-stream.jsonl` | The events as the live `EventBus` delivered them during the run. |
| `07-reliability.json` | The run's invariant checks and recovery counts. |

## Ports and who implements them

The fakes in `@harness/core/testing` show the expected behavior. Shared ports live in `@harness/protocol`, and execution
and verification ports live in their core capability subpaths.

| Port | Owner | What the owner must implement |
| --- | --- | --- |
| `ContextEnginePort` | TV2 | `prepare` (token accounting with the authoritative `o200k_base` tokenizer, transformations, compaction and stop signals, telemetry), `record` and `shapeToolResult`. The fakes use a characters/4 estimate and are labeled as stand-ins. |
| `ToolRegistryPort` | TV3 | Read-only snapshot tools (`read_file`, `grep`, `glob`, `list_dir`): definitions, execution with failures returned as error results, path containment. |
| `IngestionPort`, `SanitizerPort`, `SecurityFilterPort` | TV4 | PoC ingestion, anti-cheat checks and secret filtering for tool output and traces. |
| `LocalExecutionPort`, `VerificationPort` | Core | Rule-checked host execution and reviewed fixture evidence. Ordinary Judge uses unavailable verification. |
| `RunStorePort` | TV6 | Durable runs and events: unique contiguous sequences, compare-and-set transitions, claim tokens with lease expiry, immutable terminal runs. Proven with the contract tests below. |
| `ModelGatewayPort` | TV1 with `packages/llm` | One provider attempt per call, usage and cost on every response, provider errors returned as data. The scripted gateway here is the only implementation in this package. |

`SourceSnapshotPort` (evidence lines for the verdict), `CancellationPort`, and the clock, random and sleep ports are also
injected; `@harness/core/testing` has fakes for all of them.

Event payloads are scanned for credential, label and scorer-metadata keys, with one deliberate exception:
`tool.requested.arguments` is stored exactly as the model sent it and is exempt from the key scan, so a recorded call
can always be replayed and audited.

## Running the contract tests against a real adapter

`runStoreContractTests` is the conformance suite every `RunStorePort` must pass. From a test file in the adapter's
package:

```ts
import { runStoreContractTests } from "@harness/core/testing"

runStoreContractTests(async () => {
  const store = await createRealStore() // your adapter, pointed at a clean database
  return {
    store,
    seedRun: (runId, state) => createRun(runId, state), // creates a non-terminal run the store can claim
    expireLeases: () => expireAllClaimLeases(),          // makes every live claim count as expired
  }
})
```

The factory is called once per test and must return an isolated store. The in-memory fake runs the same suite in
`test/testing/in-memory-run-store.test.ts`. Import it only from `bun test` files: it uses `bun:test`.

## Approval gates

Decisions that are not settled yet (G1 verdict shape, G2 execution authority, G3 OpenCode reuse, G4 retry in the primary
arms, G5 additive demo fields, G6 event vocabulary) are listed with their current handling in
[`openspec/changes/bootstrap-agent-loop-core/design.md`](../../openspec/changes/bootstrap-agent-loop-core/design.md),
section "Approval gates".

## Reviewed local Foundry fixtures

`@harness/core/execution` checks executable digests, exact argv and canonical staged paths before direct host spawn.
The service supervises the owned process with a deadline, cancellation and a combined output limit. This is
application permission. The child keeps the host account's filesystem and network permissions. The driver
provides neither aggregate resource quotas nor crash cleanup guarantees for detached descendants.

`@harness/core/verification` exposes `createReviewedFoundryVerification` for internal composition. A maintainer
reviews and pins the test, all staged Solidity sources and dependencies, and both executables in the manifest.
Source digests cover snapshot lines joined with LF. Run reviewed fixtures in a scorer-free environment with no
accessible research labels or scorer credentials. The flag alone cannot admit a new PoC. Server and ordinary CLI
Judge use unavailable verification, and real state probes remain unavailable.

The driver checks runtime and toolchain availability on the host. This does not establish full Harness support
for that platform. Prepare the official Forge and solc releases offline and verify their release checksums before
passing their absolute executable paths and `sha256:` digests to the opt-in fixture test:

```sh
export HARNESS_TEST_FORGE=/absolute/path/to/forge
export HARNESS_TEST_FORGE_SHA256=sha256:REPLACE_WITH_VERIFIED_EXECUTABLE_DIGEST
export HARNESS_TEST_SOLC=/absolute/path/to/solc
export HARNESS_TEST_SOLC_SHA256=sha256:REPLACE_WITH_VERIFIED_EXECUTABLE_DIGEST
bun test --cwd packages/core test/verification/foundry-fixture.test.ts
HARNESS_TEST_NATIVE_BENCHMARK=1 bun test --cwd packages/core test/verification/foundry-fixture.test.ts -t 'measures first'
```

New run snapshots record `localExecution.version` and the `disabled`, `scripted` or `host` backend. Use the
resolved snapshot digest for frozen experiment identity. A backend, platform, policy, toolchain or input digest
change requires a new profile. The verifier records safe permission decisions, output bytes, phase timings and
observed peak RSS when available. Raw compiler output stays private to the verification operation. Historical
sandbox stages and configuration remain readable with their original payloads and digests.

### Replacement evidence

On macOS 26.2 ARM64 with Bun 1.4.3, Forge 1.5.1 and solc 0.8.30, native pass, assertion failure and zero-test
fixtures produced the expected outcomes. Unreviewed inputs and missing toolchains were rejected before spawn.
Linux and Windows are unverified for this fixture. The demo uses scripted execution evidence and requires no
native toolchain.

The following numbers are from one benchmark process. First invocation means the first fixture in that process,
without flushing the OS cache. Subsequent invocations use the same artifacts and fresh staging. Warm p95 uses
nearest rank. RSS is an observation reported by Bun for the owned child, not a limit.

| Metric | First invocation (n=1) | Subsequent median (n=10) | Subsequent p95 (n=10) |
| --- | ---: | ---: | ---: |
| Preparation and permission (ms) | 95.52 | 49.69 | 51.49 |
| Process (ms) | 180.59 | 71.10 | 74.99 |
| Cleanup (ms) | 0.97 | 0.88 | 1.19 |
| Total (ms) | 278.17 | 120.60 | 125.04 |
| Peak RSS (MiB) | 29.73 | 29.75 | 30.03 |

Toolchain profile digest is `sha256:6a46f93e08caad9dae31c46a96065193219040c80382fc666100d1c0af89f20e`.
Policy digest is `sha256:caef294d134295893d77405d4df1b26398ee97e0cfadaffaffdab0de65284803`.
There is no comparable Docker baseline for this fixture.
