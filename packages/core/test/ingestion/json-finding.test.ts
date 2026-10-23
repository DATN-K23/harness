import { describe, expect, test } from "bun:test"
import { claimMarkdown } from "../../src/ingestion/json-finding"
import { draftClaim } from "../../src/ingestion/report-normalizer"

const houndHypothesis = {
  title: "Premium threshold check blocks repayment",
  description: "ROOT CAUSE: Hub._applyPremiumDelta checks aggregated shares.\nATTACK VECTOR: borrower repays.\nAFFECTED CODE: src/hub/Hub.sol:restore",
  vulnerability_type: "Denial of Service",
  severity: "high",
  node_refs: ["func:Hub.restore"],
  properties: { source_files: ["src/hub/Hub.sol"], graph_name: "SystemArchitecture" },
  status: "rejected",
  confidence: 0.9,
  reported_by_model: "Gemini:gemini-3.8-flash",
  id: "hyp_2a3c4fa9521a",
}

describe("claimMarkdown", () => {
  test("a markdown report is returned unchanged", () => {
    expect(claimMarkdown("# Title\n\nRoot cause: x")).toBe("# Title\n\nRoot cause: x")
  })

  test("a JSON finding keeps its claim fields and drops adjudication metadata", () => {
    const markdown = claimMarkdown(JSON.stringify(houndHypothesis)) ?? ""
    for (const leaked of ["rejected", "confidence", "0.9", "reported_by_model", "hyp_2a3c4fa9521a", "graph_name"])
      expect(markdown).not.toContain(leaked)
    expect(markdown).toContain("Hub._applyPremiumDelta")
    expect(markdown).toContain("src/hub/Hub.sol")
    expect(draftClaim(markdown)).toMatchObject({ format: "hound", rootCause: "Hub._applyPremiumDelta checks aggregated shares." })
  })

  test("JSON that is not one finding object is refused, never passed through", () => {
    expect(claimMarkdown(JSON.stringify([houndHypothesis]))).toBeUndefined()
    expect(claimMarkdown(JSON.stringify({ version: 1, hypotheses: { h1: houndHypothesis }, metadata: {} }))).toBeUndefined()
    expect(claimMarkdown("42")).toBeUndefined()
  })
})
