import { describe, expect, test } from "bun:test"
import { InMemorySnapshot } from "../../src/source/in-memory-snapshot"
import { SnapshotIngestion } from "../../src/ingestion/snapshot-ingestion"

const files = {
  "src/Vault.sol": "pragma solidity ^0.8.20;\ncontract Vault {\n    function withdraw() external {}\n}\n",
}
const finding = (reportMarkdown: string) => ({ findingId: "candidate-1", reportMarkdown })
const narrative = `Target: Vault.withdraw\nRoot cause: access check missing\nAttack scenario: attacker withdraws\nImpact: funds stolen\nState: vault balance decreases`
const snapshot = (more: Record<string, string> = {}) => new InMemorySnapshot({ snapshotId: "snap-1", files: { ...files, ...more } })

describe("SnapshotIngestion", () => {
  test("maps a narrative claim to authorized snapshot lines and leaves BCE incomplete", async () => {
    const source = snapshot()
    const result = await new SnapshotIngestion({ source }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative) })
    expect(result).toMatchObject({ kind: "incomplete", reason: "bce_unavailable", claim: { targetContracts: ["Vault"], targetFunctions: ["withdraw"] }, bceSlices: [{ filePath: "src/Vault.sol", lineRange: [1, 4] }] })
    expect(source.reads.every((read) => read.path === "src/Vault.sol")).toBe(true)
  })

  test("associates a bounded Solidity test block with the narrative claim", async () => {
    const report = `${narrative}\n\n\`\`\`solidity\nfunction testExploit() public {}\n\`\`\``
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(report) })
    expect(result).toMatchObject({ kind: "incomplete", reason: "bce_unavailable", pocCode: "function testExploit() public {}" })
  })

  test("returns explicit incomplete for unsupported report shapes", async () => {
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding("An unstructured report") })
    expect(result).toEqual({ kind: "incomplete", reason: "unsupported_report" })
  })

  test("rejects malformed embedded metadata instead of treating it as a claim", async () => {
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(`${narrative}\n\n{ malformed json }`) })
    expect(result).toEqual({ kind: "invalid_report" })
  })

  test("rejects oversized reports before reading the snapshot", async () => {
    const source = snapshot()
    const result = await new SnapshotIngestion({ source, maxReportBytes: 32 }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative) })
    expect(result).toEqual({ kind: "invalid_report" })
    expect(source.reads).toHaveLength(0)
  })

  test("does not read a source file beyond the bounded slice size", async () => {
    const hugeSource = new InMemorySnapshot({ snapshotId: "snap-1", files: { "src/Vault.sol": `${files["src/Vault.sol"]}${"// extra\n".repeat(130)}` } })
    const result = await new SnapshotIngestion({ source: hugeSource }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative) })
    expect(result).toEqual({ kind: "incomplete", reason: "bce_unavailable" })
    expect(hugeSource.reads.every((read) => read.endLine <= 121)).toBe(true)
  })

  test("does not map absent or denied targets", async () => {
    const absent = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative.replace("Vault.withdraw", "Missing.withdraw")) })
    expect(absent).toEqual({ kind: "incomplete", reason: "target_not_found" })
    const denied = new InMemorySnapshot({ snapshotId: "snap-1", files: { "src/ground-truth/Vault.sol": files["src/Vault.sol"] } })
    const result = await new SnapshotIngestion({ source: denied }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative.replace("Vault.withdraw", "Vault.withdraw")) })
    expect(result).toEqual({ kind: "incomplete", reason: "target_not_found" })
    expect(denied.reads.every((read) => !read.path.includes("ground-truth"))).toBe(true)
  })

  test("rejects prohibited metadata keys at any depth", async () => {
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(`${narrative}\n\n{\"nested\":{\"groundTruthLabel\":\"vulnerable\"}}`) })
    expect(result).toEqual({ kind: "invalid_report" })
  })
})
