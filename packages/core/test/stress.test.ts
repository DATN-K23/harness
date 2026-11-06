import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RunStorePort } from "@harness/protocol"
import { checkRunInvariants } from "../src/demo/invariants"
import { runStress, writeReliabilityReport } from "../src/demo/reliability"
import { stressScenarios } from "../src/demo/scenarios"
import { runScenario } from "../src/demo/world"

/** Lists the first event twice, as a store that handed out one sequence number two times would. */
class DuplicatingStore implements RunStorePort {
  constructor(private readonly inner: RunStorePort) {}

  admit(...args: Parameters<RunStorePort["admit"]>) {
    return this.inner.admit(...args)
  }

  claim(...args: Parameters<RunStorePort["claim"]>) {
    return this.inner.claim(...args)
  }

  appendEvent(...args: Parameters<RunStorePort["appendEvent"]>) {
    return this.inner.appendEvent(...args)
  }

  transition(...args: Parameters<RunStorePort["transition"]>) {
    return this.inner.transition(...args)
  }

  loadRun(...args: Parameters<RunStorePort["loadRun"]>) {
    return this.inner.loadRun(...args)
  }

  async loadEvents(...args: Parameters<RunStorePort["loadEvents"]>) {
    const events = await this.inner.loadEvents(...args)
    return events.length === 0 ? events : [events[0], ...events]
  }
}

describe("stress", () => {
  test("100 seeded runs over the scenario mixture, 10 of them concurrent, are all crash-free", async () => {
    const report = await runStress()
    const outputDir = mkdtempSync(join(tmpdir(), "harness-stress-"))
    const path = writeReliabilityReport(report, outputDir)
    const written = JSON.parse(readFileSync(path, "utf8"))
    rmSync(outputDir, { recursive: true, force: true })

    expect(report.violations).toEqual([])
    expect(report.unhandledErrors).toEqual([])
    expect(report).toMatchObject({ totalRuns: 100, crashFreeRuns: 100, invariantViolations: 0 })
    expect(report.concurrentBatch.size).toBe(10)
    expect(Object.keys(report.perScenario).sort()).toEqual(stressScenarios.map((spec) => spec.name).sort())
    expect(Object.values(report.terminalDistribution).reduce((sum, count) => sum + count, 0)).toBe(100)
    expect(written).toEqual(report)
  })

  test("a store that duplicates a sequence makes the invariant check report a violation", async () => {
    const run = await runScenario(stressScenarios[0], {
      seed: 1,
      runId: "faulty-1",
      decorateStore: (store) => new DuplicatingStore(store),
    })
    const report = checkRunInvariants(run)
    expect(report.crashFree).toBe(false)
    expect(report.checks.contiguousSequences).toBe(false)
    expect(report.violations.join("\n")).toContain("not contiguous")
  })
})
