import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
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
    expect(result).toMatchObject({ kind: "incomplete", reason: "bce_unavailable", claim: { targetContracts: ["Vault"], targetFunctions: ["withdraw"] } })
    expect(result.kind === "incomplete" && result.bceSlices?.some((slice) => slice.filePath === "src/Vault.sol" && slice.content === "function withdraw() external {}" && slice.lineRange?.[0] === 3)).toBe(true)
    expect(source.reads.every((read) => read.path === "src/Vault.sol")).toBe(true)
  })

  test("returns AST-mapped bounded call, modifier, and state evidence from snapshot sources", async () => {
    const fixture = await readFile(new URL("./fixtures/ast-evidence.sol", import.meta.url), "utf8")
    const source = snapshot({ "src/Vault.sol": fixture.replaceAll("AstEvidence", "Vault").replaceAll("_debit", "_withdraw") })
    const result = await new SnapshotIngestion({ source }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative) })
    expect(result).toMatchObject({ kind: "incomplete", reason: "bce_unavailable" })
    expect(result.kind === "incomplete" && result.bceSlices?.some((slice) => slice.content.includes("function withdraw() external onlyOwner"))).toBe(true)
    expect(result.kind === "incomplete" && result.bceSlices?.some((slice) => slice.content.includes("function _withdraw() internal"))).toBe(true)
    expect(result.kind === "incomplete" && result.bceSlices?.some((slice) => slice.content.includes("balance = balance - 1"))).toBe(true)
    expect(result.kind === "incomplete" && result.bceSlices?.some((slice) => slice.content.includes("modifier onlyOwner()"))).toBe(true)
    expect(result.kind === "incomplete" && result.bceSlices?.some((slice) => slice.content.includes("this.withdraw()"))).toBe(true)
    expect(result.kind === "incomplete" && result.bceSlices?.every((slice) => slice.lineRange !== undefined && slice.content.length <= 2000)).toBe(true)
    expect(result.kind === "incomplete" && result.bceSlices?.every((slice) => slice.filePath === "src/Vault.sol" && slice.lineRange?.[0]! > 0)).toBe(true)
  })

  test("keeps unresolved imports and incompatible compiler pragmas explicitly incomplete", async () => {
    for (const sourceCode of [
      `pragma solidity ^0.8.20; import "./Missing.sol"; contract Vault { function withdraw() external {} }`,
      `pragma solidity ^0.9.0; contract Vault { function withdraw() external {} }`,
      `pragma solidity ^0.8.20; contract Vault { function withdraw( external {`,
    ]) {
      const result = await new SnapshotIngestion({ source: snapshot({ "src/Vault.sol": sourceCode }) }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative) })
      expect(result).toMatchObject({ kind: "incomplete", reason: "bce_unavailable" })
    }
  })

  test("does not accept unresolved imports even when solc emits a partial AST", async () => {
    const result = await new SnapshotIngestion({ source: snapshot({
      "src/Vault.sol": `pragma solidity ^0.8.20; import "./Missing.sol"; contract Vault { function withdraw() external {} }`,
    }) }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative) })
    expect(result).toMatchObject({ kind: "incomplete", reason: "bce_unavailable" })
    expect(result.kind === "incomplete" && result.bceSlices).toBeUndefined()
  })

  test("resolves imports only when their normalized path exists inside the snapshot", async () => {
    const source = snapshot({
      "src/Vault.sol": `pragma solidity ^0.8.20; import "./lib/Guard.sol"; contract Vault is Guard { function withdraw() external {} }`,
      "src/lib/Guard.sol": `pragma solidity ^0.8.20; contract Guard { modifier guarded() { _; } }`,
    })
    const result = await new SnapshotIngestion({ source }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative) })
    expect(result).toMatchObject({ kind: "incomplete", reason: "bce_unavailable" })
    expect(source.reads.every((read) => read.path.startsWith("src/") && !read.path.includes(".."))).toBe(true)
  })

  test("associates a bounded Solidity test block with the narrative claim", async () => {
    const report = `${narrative}\n\n\`\`\`solidity\ncontract Exploit { function testExploit() public { require(true); } }\n\`\`\``
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(report) })
    expect(result).toMatchObject({ kind: "incomplete", reason: "bce_unavailable", pocCode: "contract Exploit { function testExploit() public { require(true); } }" })
  })

  test("does not interpret code-fenced Solidity as report metadata or JSON", async () => {
    const report = `${narrative}\n\n\`\`\`solidity\ncontract Exploit { string label = \"safe\"; function testExploit() public { assert(true); } }\n\`\`\``
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(report) })
    expect(result).toMatchObject({ kind: "incomplete", pocCode: "contract Exploit { string label = \"safe\"; function testExploit() public { assert(true); } }" })
  })

  test("returns explicit incomplete for unsupported report shapes", async () => {
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding("An unstructured report") })
    expect(result).toEqual({ kind: "incomplete", reason: "unsupported_report" })
  })

  test("rejects malformed embedded metadata instead of treating it as a claim", async () => {
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(`${narrative}\n\n\`\`\`json\n{ malformed json }\n\`\`\``) })
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
    expect(result).toMatchObject({ kind: "incomplete", reason: "bce_unavailable" })
    expect(result.kind === "incomplete" && result.bceSlices).toBeUndefined()
    expect(hugeSource.reads.every((read) => read.endLine <= 121)).toBe(true)
  })

  test("marks an omitted Solidity file as incomplete rather than compiling a partial graph", async () => {
    const source = snapshot({ "src/Other.sol": `${"// bounded omission\n".repeat(121)}contract Other {}` })
    const result = await new SnapshotIngestion({ source }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative) })
    expect(result).toMatchObject({ kind: "incomplete", reason: "bce_unavailable" })
    expect(result.kind === "incomplete" && result.bceSlices).toBeUndefined()
  })

  test("does not map absent or denied targets", async () => {
    const absent = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative.replace("Vault.withdraw", "Missing.withdraw")) })
    expect(absent).toEqual({ kind: "incomplete", reason: "target_not_found" })
    const denied = new InMemorySnapshot({ snapshotId: "snap-1", files: { "src/ground-truth/Vault.sol": files["src/Vault.sol"] } })
    const result = await new SnapshotIngestion({ source: denied }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative.replace("Vault.withdraw", "Vault.withdraw")) })
    expect(result).toEqual({ kind: "incomplete", reason: "target_not_found" })
    expect(denied.reads.every((read) => !read.path.includes("ground-truth"))).toBe(true)
  })

  test("does not combine a contract declaration and function from separate contracts", async () => {
    const source = new InMemorySnapshot({ snapshotId: "snap-1", files: {
      "src/Vault.sol": "contract Vault {}",
      "src/Other.sol": "contract Other { function withdraw() external {} }",
    } })
    const result = await new SnapshotIngestion({ source }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative) })
    expect(result).toMatchObject({ kind: "incomplete", reason: "target_not_found" })
  })

  test("does not map target names found only in comments", async () => {
    const source = snapshot({ "src/Vault.sol": "// contract Vault { function withdraw() external {} }\ncontract Other {}" })
    const result = await new SnapshotIngestion({ source }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(narrative) })
    expect(result).toEqual({ kind: "incomplete", reason: "target_not_found" })
  })

  test("rejects prohibited metadata keys at any depth", async () => {
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(`${narrative}\n\n{\"nested\":{\"groundTruthLabel\":\"vulnerable\"}}`) })
    expect(result).toEqual({ kind: "invalid_report" })
  })
})
