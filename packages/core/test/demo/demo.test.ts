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
  test("runs the four scenarios offline and prints a summary row for each", () => {
    expect(rows.map((row) => row.scenario)).toEqual(["confirmed-exploit", "missing-poc", "cheating-poc", "failing-poc"])
    const summary = formatSummary(rows)
    expect(summary.split("\n")).toHaveLength(2 + rows.length)
    rows.forEach((row) => expect(summary).toContain(row.reason))
    expect(rows[0]).toMatchObject({ state: "completed", reason: "EXPLOIT_CONFIRMED", steps: 3 })
    expect(rows[0].tokens).toBeGreaterThan(0)
  })

  test("missing, cheating and failing PoCs cost zero tokens and report the right reason", () => {
    expect(rows.slice(1).map((row) => [row.reason, row.tokens, row.costUsd, row.steps])).toEqual([
      ["MISSING_POC", 0, 0, 0],
      ["NON_FAITHFUL_OVERRIDE", 0, 0, 0],
      ["EXECUTION_FAILED", 0, 0, 0],
    ])
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
    expect(proof.stateDeltaTable.rows.length).toBeGreaterThan(0)
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
