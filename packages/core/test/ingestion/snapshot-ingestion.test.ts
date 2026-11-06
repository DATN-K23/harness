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

  test("pairs code fences in order, so prose between two fences is never taken as the PoC", async () => {
    const ingest = (report: string) =>
      new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(report) })
    const textOnly = `${narrative}\n\n\`\`\`text\nx = y + z\n\`\`\`\n\nprose between fences\n\n\`\`\`text\na = b\n\`\`\``
    expect(await ingest(textOnly)).not.toHaveProperty("pocCode")
    const withPoc = `${narrative}\n\n\`\`\`text\nx = y + z\n\`\`\`\n\nprose\n\n\`\`\`solidity\ncontract Exploit {}\n\`\`\``
    expect(await ingest(withPoc)).toMatchObject({ pocCode: "contract Exploit {}" })
  })

  test("does not interpret code-fenced Solidity as report metadata or JSON", async () => {
    const report = `${narrative}\n\n\`\`\`solidity\ncontract Exploit { string label = \"safe\"; function testExploit() public { assert(true); } }\n\`\`\``
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(report) })
    expect(result).toMatchObject({ kind: "incomplete", pocCode: "contract Exploit { string label = \"safe\"; function testExploit() public { assert(true); } }" })
  })

  test("returns explicit incomplete for unsupported report shapes", async () => {
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding("An unstructured report") })
    expect(result).toEqual({
      kind: "incomplete",
      reason: "unsupported_report",
      missingFields: ["target", "rootCause", "attackOrImpact"],
    })
  })

  test("rejects malformed embedded metadata instead of treating it as a claim", async () => {
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(`${narrative}\n\n\`\`\`json\n{ malformed json }\n\`\`\``) })
    expect(result).toEqual({ kind: "invalid_report" })
  })

  test.each([
    "Ground Truth: valid",
    "groundTruthLabel: vulnerable",
    '"score": 9',
    "- Adjudication: confirmed",
    "label: true positive",
  ])("rejects prose metadata key %p", async (line) => {
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(`${narrative}\n${line}`) })
    expect(result).toEqual({ kind: "invalid_report" })
  })

  test.each([
    "The fix omits Admin, Guardian, and Labeled Roles from _rolesSet in AccessManager: roles stay stale.",
    "executeRoleUpdates guards label processing with if (bytes(update.label).length > 0): empty labels are skipped.",
  ])("keeps a report whose prose merely mentions labels: %p", async (line) => {
    const result = await new SnapshotIngestion({ source: snapshot() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(`${narrative}\n${line}`) })
    expect(result.kind).not.toBe("invalid_report")
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

  describe("real report layouts", () => {
    // A contract longer than the 120-line BCE bound, as in real codebases.
    const hub = `pragma solidity ^0.8.20;\ncontract Hub {\n${"    uint256 internal pad;\n".repeat(130)}    function reportDeficit(uint256 amount) external {\n        drawn -= amount;\n    }\n    uint256 internal drawn;\n}\n`
    const source = () => new InMemorySnapshot({ snapshotId: "snap-1", files: { "src/hub/Hub.sol": hub } })
    const ingest = (reportMarkdown: string, extracted?: Record<string, string>) =>
      new SnapshotIngestion({ source: source() }).ingest({ runId: "run-1", snapshotId: "snap-1", finding: finding(reportMarkdown), ...(extracted === undefined ? {} : { extracted }) })

    const hound = [
      "# Bad debt write-off leaves realizedFees unbacked",
      "",
      "VULNERABILITY TYPE: Arithmetic Underflow / DoS",
      "ROOT CAUSE: In AssetLogic.accrue, asset.realizedFees accumulates fee claims; reportDeficit never adjusts them.",
      "ATTACK VECTOR: A borrower defaults, reportDeficit() writes off the debt and totalAddedAssets() underflows.",
      "AFFECTED NODES: func:Hub.reportDeficit, contract:Hub",
      "AFFECTED CODE: src/hub/Hub.sol:reportDeficit",
      "SEVERITY: medium",
    ].join("\n")

    test("Hound: fields map by excerpt and the target comes from AFFECTED NODES", async () => {
      const result = await ingest(hound)
      expect(result).toMatchObject({
        kind: "incomplete",
        reason: "bce_unavailable",
        claim: {
          targetContracts: ["Hub"],
          targetFunctions: ["reportDeficit"],
          rootCause: "In AssetLogic.accrue, asset.realizedFees accumulates fee claims; reportDeficit never adjusts them.",
          attackScenario: "A borrower defaults, reportDeficit() writes off the debt and totalAddedAssets() underflows.",
          claimedImpact: "",
          claimedState: "",
        },
      })
    })

    const sherlock = [
      "Proud Porcelain Antelope",
      "",
      "Medium",
      "",
      "# Deficit reporting underflows the hub accounting",
      "",
      "### Root Cause",
      "",
      "In `Hub.sol` the deficit is subtracted from `drawn` without a bound check.",
      "",
      "### Internal pre-conditions",
      "",
      "1. A borrower has outstanding debt.",
      "",
      "### Attack Path",
      "",
      "1. The borrower defaults.",
      "2. The admin calls reportDeficit with the full amount.",
      "",
      "### Impact",
      "",
      "All hub operations revert for the asset.",
      "",
      "## Code Snippet",
      "",
      "https://github.com/sherlock-audit/2025-aave/blob/main/aave-v4/src/hub/Hub.sol#L134",
    ].join("\n")

    test("Sherlock: sections map verbatim and the target is the function around the linked line", async () => {
      const result = await ingest(sherlock)
      expect(result).toMatchObject({
        kind: "incomplete",
        reason: "bce_unavailable",
        claim: {
          targetContracts: ["Hub"],
          targetFunctions: ["reportDeficit"],
          rootCause: "In `Hub.sol` the deficit is subtracted from `drawn` without a bound check.",
          attackScenario: "1. The borrower defaults.\n2. The admin calls reportDeficit with the full amount.",
          claimedImpact: "All hub operations revert for the asset.",
          callerAssumptions: ["1. A borrower has outstanding debt."],
        },
      })
    })

    test("Code4rena: Vulnerability details and Lines of code links are enough", async () => {
      const report = [
        "# Lines of code",
        "",
        "https://github.com/code-423n4/2025-aave/blob/abc/src/hub/Hub.sol#L134",
        "",
        "# Vulnerability details",
        "",
        "reportDeficit subtracts from drawn without checking the outstanding amount.",
        "",
        "## Impact",
        "",
        "The hub reverts for the asset.",
      ].join("\n")
      expect(await ingest(report)).toMatchObject({ kind: "incomplete", reason: "bce_unavailable", claim: { targetContracts: ["Hub"], targetFunctions: ["reportDeficit"] } })
    })

    test("a target named only in prose is accepted once the snapshot confirms it, and rejected otherwise", async () => {
      const prose = "## Summary\n\nCalling Hub.reportDeficit( with the full debt underflows drawn.\n\n## Impact\n\nThe hub reverts."
      expect(await ingest(prose)).toMatchObject({ claim: { targetContracts: ["Hub"], targetFunctions: ["reportDeficit"] } })
      expect(await ingest(prose.replace("reportDeficit", "liquidate"))).toEqual({ kind: "incomplete", reason: "target_not_found", missingFields: ["target"] })
    })

    test("extracted fields fill gaps only as verbatim excerpts with a snapshot-confirmed target", async () => {
      const vague = "Something is wrong with deficits: the accounting breaks when debt is written off."
      expect(await ingest(vague)).toMatchObject({ kind: "incomplete", missingFields: ["target", "rootCause", "attackOrImpact"] })
      const filled = await ingest(vague, {
        target: "Hub.reportDeficit",
        rootCause: "Something is wrong with deficits",
        impact: "the accounting breaks when debt is written off",
      })
      expect(filled).toMatchObject({ kind: "incomplete", reason: "bce_unavailable", claim: { targetFunctions: ["reportDeficit"], claimedImpact: "the accounting breaks when debt is written off" } })
      // A paraphrase is not an excerpt, and an unknown target is not confirmed: both stay missing.
      const rewritten = await ingest(vague, { target: "Hub.withdraw", rootCause: "Deficit accounting is broken", impact: "Loss of funds" })
      expect(rewritten).toMatchObject({ kind: "incomplete", missingFields: ["target", "rootCause", "attackOrImpact"] })
    })
  })
})
