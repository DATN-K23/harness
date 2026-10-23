import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SnapshotManager } from "@harness/core"
import { textResponse, ScriptedModelGateway } from "@harness/core/testing"
import { InMemoryRunStore } from "@harness/core/testing"
import { createJudgeRuntime } from "../src/judge-runtime"
import { makeProductionJudgeConfig } from "../src/production-runtime"
import { DiskSourceSnapshot } from "@harness/core"
import { createIdGenerator, systemIdSources } from "@harness/core"

console.log("=== Harness Judge End-to-End Self-Contained Demo ===")

const sourceRoot = await mkdtemp(join(tmpdir(), "demo-judge-src-"))
const snapshotRoot = await mkdtemp(join(tmpdir(), "demo-judge-snaps-"))

try {
  await mkdir(join(sourceRoot, "src"), { recursive: true })
  await writeFile(
    join(sourceRoot, "src", "Vault.sol"),
    "pragma solidity ^0.8.20;\ncontract Vault {\n  mapping(address => uint256) public balances;\n  function withdraw() external {\n    uint256 b = balances[msg.sender];\n    balances[msg.sender] = 0;\n    (bool ok,) = msg.sender.call{value: b}(\"\");\n    require(ok);\n  }\n}\n",
  )

  const ingested = await SnapshotManager.ingestRepository({
    sourceDir: sourceRoot,
    storageDir: snapshotRoot,
    snapshotId: `demo-snap-${Date.now()}`,
  })

  console.log(`[1] Created immutable snapshot: ${ingested.snapshotId} (${ingested.manifest.files.length} files)`)

  const findingId = "finding-reentrancy-demo"
  const findingMarkdown = `
# Potential Reentrancy in Vault.withdraw
Target: Vault.withdraw
Root cause: State update balances[msg.sender] = 0 happens before low-level call, preventing recursive reentrancy.
Attack scenario: Attacker attempts to re-enter withdraw in fallback.
Impact: None, contract is safe.
State: balances[msg.sender] is correctly reset before transfer.
`

  const inMemory = new InMemoryRunStore({ clock: { nowMs: () => Date.now() } })
  const outbox = new Set<string>()
  const store = new Proxy(inMemory, {
    get(target, property, receiver) {
      if (property === "admit") return async (input: Parameters<typeof inMemory.admit>[0]) => {
        const result = await inMemory.admit(input)
        if (result.kind === "accepted") outbox.add(result.runId)
        return result
      }
      if (property === "loadPendingOutbox") return async () => [...outbox]
      if (property === "claimOutbox") return async (runId: string) => outbox.has(runId)
      if (property === "markOutboxPublished") return async (runId: string) => outbox.delete(runId)
      const value = Reflect.get(target, property, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  const snapshots = new DiskSourceSnapshot({
    storageDir: snapshotRoot,
    snapshotId: ingested.snapshotId,
    manifest: ingested.manifest,
  })
  const ids = createIdGenerator(systemIdSources)
  const config = makeProductionJudgeConfig({
    providerName: "openai",
    modelName: "demo-model",
    modelBaseUrl: "https://api.openai.com/v1",
  })

  const validVerdictJson = JSON.stringify({
    runId: "run-demo",
    findingId,
    validity: "unverified",
    verificationStatus: "UNVERIFIED",
    confidence: "MEDIUM",
    reasonCode: "UNRESOLVED",
    summary: "Reentrancy claim analyzed against Vault contract; status is UNVERIFIED.",
    reasoning: "The state update balances[msg.sender] = 0 precedes the external call. Incomplete BCE mandates UNVERIFIED verdict.",
    citesEvidence: [
      {
        filePath: "src/Vault.sol",
        startLine: 6,
        endLine: 8,
        explanation: "Checks-effects-interactions pattern observed",
      },
    ],
  })

  const gateway = new ScriptedModelGateway([
    textResponse("acknowledged"),
    textResponse('{"reachability":"incomplete","explanation":"insufficient evidence"}'),
    textResponse('{"reconstruction":"incomplete","explanation":"insufficient evidence"}'),
    textResponse(validVerdictJson, {
      usage: { promptTokens: 45, completionTokens: 60, totalTokens: 105, costUsd: 0.0003 },
    }),
  ])

  const runtime = createJudgeRuntime({
    store: store as never,
    snapshots,
    ids,
    workerId: "demo-worker",
    config,
    cursorSecret: "demo-cursor-secret",
    credential: "demo-credential",
    runnerDeps: async () => ({
      gateway,
      contextEngine: new (await import("@harness/core")).PassThroughContextEngine(),
      snapshot: snapshots,
      tools: new (await import("@harness/core")).ToolRegistry({ snapshot: snapshots, snapshotId: ingested.snapshotId }),
      security: new (await import("@harness/core")).ProductionSecurityFilter(),
      ingestion: {
        ingest: async () => ({
          kind: "narrative_only" as const,
          claim: {
            targetContracts: ["Vault"],
            targetFunctions: ["withdraw"],
            rootCause: "State check reentrancy report",
            attackScenario: "Attacker attempts reentrancy",
            callerAssumptions: [],
            claimedImpact: "None",
            claimedState: "Balance zeroed",
          },
          bceSlices: [],
        }),
      },
      sanitizer: {
        sanitize: async () => ({ kind: "ok" as const, stitchedTestFile: "", hasSubmitterAssertions: false, antiCheatReport: { rulesChecked: [], findings: [] } }),
        injectStateProbes: async () => ({ probedTestFile: "" }),
      },
      sandbox: {
        runSingleShot: async () => ({ outcome: "passed" as const, exitCode: 0, trace: "", durationMs: 0 }),
        runStateProbe: async () => ({ outcome: "passed" as const, exitCode: 0, trace: "", durationMs: 0, observedBefore: null, observedAfter: null, stateDeltas: [] }),
      },
      cancellation: { isRequested: async () => false, request: async () => ({ kind: "requested" as const }) },
      clock: { nowMs: () => Date.now() },
      random: { next: () => Math.random() },
      sleep: { sleep: async () => {} },
      ids,
    }),
  })

  console.log("[2] Submitting finding to local Judge API...")
  const submitRes = await runtime.api.fetch(
    new Request("http://localhost/v1/judge/runs", {
      method: "POST",
      headers: {
        authorization: "Bearer demo-credential",
        "content-type": "application/json",
        "idempotency-key": `demo-key-${Date.now()}`,
      },
      body: JSON.stringify({
        finding: { findingId, reportMarkdown: findingMarkdown },
        snapshotId: ingested.snapshotId,
      }),
    }),
  )

  const { runId } = (await submitRes.json()) as { runId: string }
  console.log(`[3] Run admitted asynchronously: ${runId}`)

  console.log("[4] Worker processing run through 5-stage Judge pipeline...")
  await runtime.worker.runOnce()

  console.log("[5] Polling status and verdict from GET /v1/judge/runs/:id...")
  const statusRes = await runtime.api.fetch(
    new Request(`http://localhost/v1/judge/runs/${runId}`, {
      headers: { authorization: "Bearer demo-credential" },
    }),
  )
  const status = (await statusRes.json()) as { state: string; verdict?: Record<string, unknown> }
  console.log(`    State:   ${status.state}`)
  console.log(`    Verdict: ${JSON.stringify(status.verdict, null, 2)}`)

  console.log("\n[6] Polling trajectory events from GET /v1/judge/runs/:id/events...")
  const eventsRes = await runtime.api.fetch(
    new Request(`http://localhost/v1/judge/runs/${runId}/events?limit=5`, {
      headers: { authorization: "Bearer demo-credential" },
    }),
  )
  const events = (await eventsRes.json()) as { events: Array<{ sequence: number; type: string }> }
  for (const event of events.events) {
    console.log(`    [#${event.sequence}] ${event.type}`)
  }

  console.log("\n✓ E2E Judge Demo completed successfully without requiring external credentials!")
} finally {
  await rm(sourceRoot, { recursive: true, force: true })
  await rm(snapshotRoot, { recursive: true, force: true })
}
