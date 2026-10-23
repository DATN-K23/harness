import { describe, expect, test } from "bun:test"
import type { JudgeVerdict } from "@harness/protocol"
import { citesGuard, staticVerdictDecision } from "../../src/judge/verdict-policy"

const verdict = (validity: "valid" | "invalid", snippets: string[]): JudgeVerdict => ({
  runId: "run-1", findingId: "f-1", validity,
  verificationStatus: validity === "valid" ? "PASS" : "FAIL",
  reasonCode: validity === "valid" ? "EXPLOIT_CONFIRMED" : "BENIGN_MECHANICS",
  ...(validity === "valid" ? { severity: "HIGH" as const } : {}),
  confidence: "MEDIUM",
  summary: "A summary of at least twenty characters.",
  reasoning: "A reasoning text that is long enough to satisfy the verdict schema minimum.",
  citesEvidence: snippets.map((snippet, index) => ({ filePath: "src/Vault.sol", startLine: index + 1, endLine: index + 1, explanation: "cited", snippet })),
})

describe("TV4 conclusion rules for static verdicts", () => {
  test("row 1: both directions support the claim and citations resolve, so valid is accepted", () => {
    expect(staticVerdictDecision(verdict("valid", ["balances[msg.sender] -= amount;"]), "agreed-valid")).toEqual({ kind: "accept" })
  })

  test("valid without the agreed consensus, or without citations, is withheld", () => {
    expect(staticVerdictDecision(verdict("valid", ["x"]), "disputed").kind).toBe("withhold")
    expect(staticVerdictDecision(verdict("valid", ["x"]), undefined).kind).toBe("withhold")
    expect(staticVerdictDecision(verdict("valid", []), "agreed-valid").kind).toBe("withhold")
  })

  test("row 2: both directions blocked and a cited span contains a guard, so invalid is accepted", () => {
    for (const guard of ["require(msg.sender == owner);", "if (x) revert Unauthorized();", "function withdraw() external onlyOwner {", "function rely(address usr) external auth {"])
      expect(staticVerdictDecision(verdict("invalid", [guard]), "agreed-invalid")).toEqual({ kind: "accept" })
  })

  test("a rejection without a guard in the cited source, or without the blocking consensus, is withheld", () => {
    expect(staticVerdictDecision(verdict("invalid", ["balances[msg.sender] -= amount;"]), "agreed-invalid").kind).toBe("withhold")
    expect(staticVerdictDecision(verdict("invalid", ["// require(msg.sender == owner) was removed"]), "agreed-invalid").kind).toBe("withhold")
    expect(staticVerdictDecision(verdict("invalid", ["require(ok);"]), "disputed").kind).toBe("withhold")
    expect(citesGuard(verdict("invalid", ["/* onlyOwner */ x = 1;"]))).toBe(false)
  })
})
