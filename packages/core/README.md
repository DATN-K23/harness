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

On Windows with Git Bash, `bun` may not be on `PATH`; add the npm global directory first:

```sh
export PATH="$PATH:/c/Users/NHAT DAT/AppData/Roaming/npm"
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

The loop is complete against fakes. Each real implementation belongs to another track and must satisfy the port in
`@harness/protocol`; the fakes in `@harness/core/testing` show the expected behavior.

| Port | Owner | What the owner must implement |
| --- | --- | --- |
| `ContextEnginePort` | TV2 | `prepare` (token accounting with the authoritative `o200k_base` tokenizer, transformations, compaction and stop signals, telemetry), `record` and `shapeToolResult`. The fakes use a characters/4 estimate and are labeled as stand-ins. |
| `ToolRegistryPort` | TV3 | Read-only snapshot tools (`read_file`, `grep`, `glob`, `list_dir`): definitions, execution with failures returned as error results, path containment. |
| `IngestionPort`, `SanitizerPort`, `SandboxPort`, `SecurityFilterPort` | TV4 | PoC ingestion, the pre-execution anti-cheat sanitizer with state-probe injection, isolated sandbox execution (single shot and state probe), and the secret filter for tool output and traces. |
| `RunStorePort` | TV6 | Durable runs and events: unique contiguous sequences, compare-and-set transitions, claim tokens with lease expiry, immutable terminal runs. Proven with the contract tests below. |
| `ModelGatewayPort` | TV1 with `packages/llm` | One provider attempt per call, usage and cost on every response, provider errors returned as data. The scripted gateway here is the only implementation in this package. |

`SourceSnapshotPort` (evidence lines for the verdict), `CancellationPort`, and the clock, random and sleep ports are also
injected; `@harness/core/testing` has fakes for all of them.

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
