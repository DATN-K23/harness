import { describe, expect, test } from "bun:test"
import type { IngestionResult, SandboxResult, SanitizerResult, StageInput, StateProbeResult } from "@harness/protocol"
import {
  FakeCancellation,
  ScriptedIngestion,
  ScriptedSandbox,
  ScriptedSanitizer,
} from "../../src/testing/scripted-stages"

const stage: StageInput = { runId: "run-1", snapshotId: "snap-1" }
const finding = { findingId: "f-1", reportMarkdown: "## Reentrancy in withdraw()" }

const okIngestion: IngestionResult = {
  kind: "ok",
  pocCode: "contract Poc {}",
  bceSlices: [{ filePath: "src/Vault.sol", content: "function withdraw() {}", lineRange: [10, 14] }],
}
const missing: IngestionResult = { kind: "missing_poc" }

const okSanitizer: SanitizerResult = {
  kind: "ok",
  stitchedTestFile: "contract T {}",
  hasSubmitterAssertions: false,
  antiCheatReport: { rulesChecked: ["no-vm-store", "no-hardcoded-balance"], findings: [] },
}
const cheat: SanitizerResult = {
  kind: "cheat_detected",
  findings: [{ ruleId: "no-vm-store", message: "vm.store overwrites victim state", line: 7 }],
}

describe("ScriptedIngestion", () => {
  test("returns the scripted result verbatim, the same object", async () => {
    const ingestion = new ScriptedIngestion([okIngestion])
    expect(await ingestion.ingest({ ...stage, finding })).toBe(okIngestion)
  })

  test("plays results in order and repeats the last one", async () => {
    const ingestion = new ScriptedIngestion([missing, okIngestion])
    const results = await Promise.all([1, 2, 3].map(() => ingestion.ingest({ ...stage, finding })))
    expect(results).toEqual([missing, okIngestion, okIngestion])
  })

  test("logs the inputs it was called with", async () => {
    const ingestion = new ScriptedIngestion([missing])
    await ingestion.ingest({ ...stage, finding })
    expect(ingestion.calls).toEqual([{ ...stage, finding }])
  })

  test("an aborted signal rejects before consuming a result", async () => {
    const ingestion = new ScriptedIngestion([missing])
    await expect(ingestion.ingest({ ...stage, finding }, AbortSignal.abort())).rejects.toBeDefined()
    expect(ingestion.calls).toEqual([])
  })
})

describe("ScriptedSanitizer", () => {
  test("returns ok and cheat_detected results verbatim", async () => {
    const sanitizer = new ScriptedSanitizer([cheat, okSanitizer])
    expect(await sanitizer.sanitize({ ...stage, pocCode: "x" })).toBe(cheat)
    expect(await sanitizer.sanitize({ ...stage, pocCode: "y" })).toBe(okSanitizer)
    expect(sanitizer.sanitizeCalls.map((call) => call.pocCode)).toEqual(["x", "y"])
  })

  test("injects state probes deterministically and logs the request", async () => {
    const sanitizer = new ScriptedSanitizer([okSanitizer])
    const probed = await sanitizer.injectStateProbes("contract T {}", ["balances[victim]", "totalSupply"])
    expect(probed).toEqual({ probedTestFile: "contract T {}\n// state probes: balances[victim], totalSupply\n" })
    expect(sanitizer.probeCalls).toEqual([
      { stitchedTestFile: "contract T {}", stateVariables: ["balances[victim]", "totalSupply"] },
    ])
  })

  test("a custom probe builder replaces the default", async () => {
    const sanitizer = new ScriptedSanitizer([okSanitizer], {
      probe: (file, variables) => `${variables.length}:${file}`,
    })
    expect(await sanitizer.injectStateProbes("T", ["a", "b"])).toEqual({ probedTestFile: "2:T" })
  })
})

describe("ScriptedSandbox", () => {
  const passed: SandboxResult = { exitCode: 0, trace: "[PASS] test_exploit() (gas: 91234)", durationMs: 420 }
  const failed: SandboxResult = { exitCode: 1, trace: "[FAIL] test_exploit()", durationMs: 90 }
  const probe: StateProbeResult = {
    exitCode: 0,
    trace: "probe trace",
    stateDeltas: [{ variable: "balances[victim]", before: "100 ether", after: "0" }],
  }

  test("single-shot results come back verbatim, in order, with the last repeating", async () => {
    const sandbox = new ScriptedSandbox({ singleShot: [failed, passed] })
    const results = await Promise.all([1, 2, 3].map(() => sandbox.runSingleShot({ ...stage, testFile: "T" })))
    expect(results[0]).toBe(failed)
    expect(results[1]).toBe(passed)
    expect(results[2]).toBe(passed)
    expect(sandbox.singleShotCalls).toHaveLength(3)
  })

  test("state probe results, including state deltas, come back verbatim", async () => {
    const sandbox = new ScriptedSandbox({ singleShot: [passed], stateProbe: [probe] })
    const result = await sandbox.runStateProbe({ ...stage, probedTestFile: "P" })
    expect(result).toBe(probe)
    expect(result.stateDeltas).toEqual([{ variable: "balances[victim]", before: "100 ether", after: "0" }])
    expect(sandbox.stateProbeCalls).toEqual([{ ...stage, probedTestFile: "P" }])
  })

  test("calling an unscripted method fails loudly instead of inventing a result", async () => {
    const sandbox = new ScriptedSandbox({ singleShot: [passed] })
    await expect(sandbox.runStateProbe({ ...stage, probedTestFile: "P" })).rejects.toThrow(
      "ScriptedSandbox.runStateProbe: no result was scripted",
    )
  })
})

describe("FakeCancellation", () => {
  test("reports only runs that were asked to cancel and logs every poll", async () => {
    const cancellation = new FakeCancellation()
    expect(await cancellation.isRequested("run-1")).toBe(false)
    cancellation.request("run-1")
    expect(await cancellation.isRequested("run-1")).toBe(true)
    expect(await cancellation.isRequested("run-2")).toBe(false)
    expect(cancellation.polls).toEqual(["run-1", "run-1", "run-2"])
  })

  test("can start reporting a request from a chosen poll number", async () => {
    const cancellation = new FakeCancellation()
    cancellation.requestOnPoll(3)
    const polls = await Promise.all([1, 2, 3, 4].map(() => cancellation.isRequested("run-1")))
    expect(polls).toEqual([false, false, true, true])
  })
})
