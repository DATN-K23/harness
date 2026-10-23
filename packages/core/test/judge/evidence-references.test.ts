import { describe, expect, test } from "bun:test"
import type { JudgeVerdict } from "@harness/protocol"
import { sourceReferences, withReferencedEvidence } from "../../src/judge/evidence-references"
import { staticVerdictDecision } from "../../src/judge/verdict-policy"
import { InMemorySnapshot } from "../../src/source/in-memory-snapshot"
import { ProductionSecurityFilter } from "../../src/security-filter"

const clearinghouse = [
  "contract Clearinghouse {",
  "  function transferQuote(Txn calldata txn) external {",
  "    // require the sender address to be the same as the recipient address",
  "    require(",
  "      bytes20(txn.sender) == bytes20(txn.recipient),",
  "      ERR_UNAUTHORIZED",
  "    );",
  "  }",
  "}",
].join("\n")
const deps = () => ({
  snapshot: new InMemorySnapshot({ snapshotId: "s", files: { "core/contracts/Clearinghouse.sol": clearinghouse, "core/contracts/Endpoint.sol": "contract Endpoint {}" } }),
  security: new ProductionSecurityFilter(),
})
const invalid: JudgeVerdict = {
  runId: "r", findingId: "f", validity: "invalid", verificationStatus: "FAIL", reasonCode: "BENIGN_MECHANICS", confidence: "MEDIUM",
  summary: "TransferQuote cannot reach an arbitrary recipient.",
  reasoning: "EndpointTx forwards to Clearinghouse.transferQuote. In Clearinghouse.sol (lines 4-7) a require checks the sender equals the recipient.",
  citesEvidence: [],
}

describe("source references in the model's own words", () => {
  test("reads the forms models write", () => {
    expect(sourceReferences("see core/contracts/Endpoint.sol:189-199 and Clearinghouse.sol:228, Clearinghouse.sol (lines 228-231), Vault.sol lines 3–5")).toEqual([
      { filePath: "core/contracts/Endpoint.sol", startLine: 189, endLine: 199 },
      { filePath: "Clearinghouse.sol", startLine: 228, endLine: 228 },
      { filePath: "Clearinghouse.sol", startLine: 228, endLine: 231 },
      { filePath: "Vault.sol", startLine: 3, endLine: 5 },
    ])
  })

  test("a rejection whose guard was named but not cited is confirmed once the harness reads the named lines", async () => {
    expect(staticVerdictDecision(invalid, "agreed-invalid").kind).toBe("withhold")
    const verdict = await withReferencedEvidence(deps(), { verdict: invalid, texts: [invalid.reasoning], snapshotId: "s" })
    expect(verdict.citesEvidence).toMatchObject([{ filePath: "core/contracts/Clearinghouse.sol", startLine: 4, endLine: 7 }])
    expect(verdict.citesEvidence[0]?.snippet).toContain("require(")
    expect(verdict.citesEvidence[0]?.contentDigest).toStartWith("sha256:")
    expect(staticVerdictDecision(verdict, "agreed-invalid")).toEqual({ kind: "accept" })
  })

  test("references to unknown files, ambiguous names or lines outside the file add nothing", async () => {
    const texts = ["Missing.sol:1-2", "Endpoint.sol:40-50", "../secret.sol:1"]
    const verdict = await withReferencedEvidence(deps(), { verdict: invalid, texts, snapshotId: "s" })
    expect(verdict.citesEvidence).toEqual([])
  })
})
