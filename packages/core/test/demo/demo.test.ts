import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BundleFiles } from "../../src/demo/bundle"
import { formatSummary, runDemo, type DemoRow } from "../../src/demo/demo"

let outputDir = ""
let rows: DemoRow[] = []

const read = (scenario: string, file: (typeof BundleFiles)[number]) =>
  readFileSync(join(outputDir, scenario, file), "utf8")
const readJson = (scenario: string, file: (typeof BundleFiles)[number]) => JSON.parse(read(scenario, file))

beforeAll(async () => {
  outputDir = mkdtempSync(join(tmpdir(), "harness-demo-"))
  rows = await runDemo(outputDir)
})

afterAll(() => rmSync(outputDir, { recursive: true, force: true }))

describe("demo", () => {
  test("runs the offline scenarios and prints a summary row for each", () => {
    expect(rows.map((row) => row.scenario)).toEqual(["confirmed-exploit", "missing-poc", "cheating-poc", "failing-poc", "narrative-agreed", "disputed-witness"])
    const summary = formatSummary(rows)
    expect(summary.split("\n")).toHaveLength(2 + rows.length)
    rows.forEach((row) => expect(summary).toContain(row.reason))
    expect(rows[0]).toMatchObject({ state: "completed", reason: "EXPLOIT_CONFIRMED", steps: 3 })
    expect(rows[0].tokens).toBeGreaterThan(0)
  })

  test("missing, cheating and failing PoCs cost zero tokens and report the right reason", () => {
    expect(rows.slice(1, 4).map((row) => [row.reason, row.tokens, row.costUsd, row.steps])).toEqual([
      ["MISSING_POC", 0, 0, 0],
      ["NON_FAITHFUL_OVERRIDE", 0, 0, 0],
      ["EXECUTION_FAILED", 0, 0, 0],
    ])
  })

  test("narrative-only agreement skips PoC stages and commits a source-cited verdict", () => {
    const verdict = readJson("narrative-agreed", "01-verdict.json")
    expect(verdict).toMatchObject({ validity: "valid", verificationStatus: "PASS" })
    expect(verdict.citesEvidence[0]).toMatchObject({ filePath: "src/Vault.sol", startLine: 11, endLine: 16 })
    const trajectory = readJson("narrative-agreed", "03-trajectory.json")
    expect(trajectory.events.filter((event: { type: string }) => event.type === "provider.attempted")).toHaveLength(4)
    expect(trajectory.summary.usage).toMatchObject({ promptTokens: 80, completionTokens: 20, totalTokens: 100, costUsd: 0.02 })
    expect(trajectory.summary).toMatchObject({ steps: 4, state: "completed" })
    const stages = trajectory.events.filter((event: { type: string }) => event.type.startsWith("stage."))
    expect(stages.map((event: { type: string; payload: { stage: string; outcome?: string } }) => [event.type, event.payload.stage, event.payload.outcome])).toEqual([
      ["stage.started", "ingestion", undefined],
      ["stage.finished", "ingestion", "ok"],
    ])
    expect(readJson("narrative-agreed", "04-exploit-proof.json")).toMatchObject({ applicable: false })
    expect(readJson("narrative-agreed", "04-exploit-proof.json").reason).toContain("No execution was performed")
    expect(readJson("narrative-agreed", "05-context-economics.json").totals).toMatchObject({ totalTokens: 100, costUsd: 0.02 })
    expect(read("narrative-agreed", "02-dossier.md")).toContain("external call precedes balance update")
    expect(rows.find((row) => row.scenario === "narrative-agreed")).toMatchObject({ steps: 4, tokens: 100, costUsd: 0.02 })
  })

  test("disputed report resolves through bounded witness evidence and snapshot citation", () => {
    const verdict = readJson("disputed-witness", "01-verdict.json")
    expect(verdict).toMatchObject({ validity: "valid", verificationStatus: "PASS", reasonCode: "EXPLOIT_CONFIRMED" })
    expect(verdict.citesEvidence[0]).toMatchObject({ filePath: "src/Vault.sol", startLine: 17, endLine: 21 })
    expect(verdict.citesEvidence[0].contentDigest).toStartWith("sha256:")
    const trajectory = readJson("disputed-witness", "03-trajectory.json")
    expect(trajectory.events.filter((event: { type: string }) => event.type === "provider.attempted")).toHaveLength(6)
    expect(trajectory.summary).toMatchObject({ state: "completed", steps: 6, usage: { promptTokens: 220, completionTokens: 90, totalTokens: 310 } })
    expect(trajectory.summary.usage.costUsd).toBeCloseTo(0.03)
    const stages = trajectory.events.filter((event: { type: string }) => event.type.startsWith("stage."))
    expect(stages.map((event: { type: string; payload: { stage: string; outcome?: string } }) => [event.type, event.payload.stage, event.payload.outcome])).toEqual([
      ["stage.started", "ingestion", undefined], ["stage.finished", "ingestion", "ok"],
      ["stage.started", "sanitizer", undefined], ["stage.finished", "sanitizer", "ok"],
      ["stage.started", "sandbox", undefined], ["stage.finished", "sandbox", "ok"],
    ])
    const witness = trajectory.events.filter((event: { type: string; payload: { toolName?: string } }) =>
      ["tool.requested", "tool.completed"].includes(event.type) && event.payload.toolName === "run_state_probe")
    expect(witness.map((event: { type: string }) => event.type)).toEqual(["tool.requested", "tool.completed"])
    expect(witness[0].payload.arguments).toEqual({ stateVariables: ["balanceOf(attacker)"] })
    const resultItemId = witness[1].payload.itemId
    const probeResult = trajectory.events.find((event: { type: string; payload: { item: { id: string } } }) => event.type === "context.item_added" && event.payload.item.id === resultItemId)
    expect(probeResult?.payload.item.content).toContain("balanceOf(attacker)")
    expect(probeResult?.payload.item.content).toContain("3000000000000000000")
    expect(read("disputed-witness", "04-exploit-proof.json")).toContain("balanceOf(attacker)")
    expect(readJson("disputed-witness", "05-context-economics.json").totals).toMatchObject({ totalTokens: 310 })
    expect(readJson("disputed-witness", "05-context-economics.json").totals.costUsd).toBeCloseTo(0.03)
    expect(rows.find((row) => row.scenario === "disputed-witness")).toMatchObject({ steps: 6, tokens: 310 })
    expect(rows.find((row) => row.scenario === "disputed-witness")?.costUsd).toBeCloseTo(0.03)
  })
})

describe("output bundle", () => {
  test("confirmed exploit: all seven pillars exist and carry the evidence", () => {
    expect(readdirSync(join(outputDir, "confirmed-exploit")).sort()).toEqual([...BundleFiles])
    const verdict = readJson("confirmed-exploit", "01-verdict.json")
    expect(verdict).toMatchObject({ validity: "valid", verificationStatus: "PASS" })
    expect(verdict.citesEvidence[0].snippet).toBeString()
    expect(verdict.citesEvidence[0].contentDigest).toStartWith("sha256:")

    const dossier = read("confirmed-exploit", "02-dossier.md")
    expect(dossier).toContain("Reentrancy (SWC-107)")
    expect(dossier).toContain(verdict.report.rootCause)

    const trajectory = readJson("confirmed-exploit", "03-trajectory.json")
    expect(trajectory.summary).toMatchObject({ state: "completed", steps: 3, usage: { totalTokens: rows[0].tokens } })
    expect(trajectory.events.map((event: { sequence: number }) => event.sequence)).toEqual(
      trajectory.events.map((_: unknown, index: number) => index + 1),
    )

    const proof = readJson("confirmed-exploit", "04-exploit-proof.json")
    expect(proof).toMatchObject({ applicable: true })
    expect(proof.execution.rawTrace).toContain("testExploit")
    expect(proof.antiCheatReport.findings).toEqual([])

    const economics = readJson("confirmed-exploit", "05-context-economics.json")
    expect(economics.steps).toHaveLength(3)
    expect(economics.totals.tokensSaved).toBeGreaterThan(0)

    // The stream file is what the bus delivered during the run: same events, same order as the ledger.
    const streamed = read("confirmed-exploit", "06-event-stream.jsonl").trim().split("\n").map((line) => JSON.parse(line))
    expect(streamed).toEqual(trajectory.events)

    expect(readJson("confirmed-exploit", "07-reliability.json")).toMatchObject({ crashFree: true, violations: [] })
  })

  test("missing PoC: pillar 4 says nothing was executed and pillar 5 shows zero tokens", () => {
    expect(readdirSync(join(outputDir, "missing-poc")).sort()).toEqual([...BundleFiles])
    expect(readJson("missing-poc", "01-verdict.json")).toMatchObject({ validity: "invalid", reasonCode: "MISSING_POC" })
    const proof = readJson("missing-poc", "04-exploit-proof.json")
    expect(proof).toMatchObject({ applicable: false })
    expect(proof.reason).toContain("No execution was performed")
    expect(proof.stateDeltaTable.rows).toEqual([])
    const economics = readJson("missing-poc", "05-context-economics.json")
    expect(economics.totals).toMatchObject({ totalTokens: 0, costUsd: 0 })
    expect(economics.reason).toContain("zero tokens")
    expect(read("missing-poc", "02-dossier.md")).toContain("Not applicable")
  })
})
