import { describe, expect, test } from "bun:test"
import { isTemplateFinding, normalizeFinding } from "../../src/ingestion/finding-normalizer"
import { ScriptedModelGateway, errorResponse, textResponse, usageOf } from "../../src/testing/scripted-model-gateway"

const template = [
  "Target: Vault.withdraw",
  "Root cause: balance is cleared after the external call",
  "Attack scenario: attacker re-enters withdraw from receive()",
  "Impact: vault drained",
  "State: balances",
].join("\n")

const claimJson = JSON.stringify({
  target: "JackpotLPManager.processDrawingSettlement",
  rootCause: "settlement adds LP earnings without checking lpPoolCap",
  attackScenario: "a drawing with no winner settles and the pool grows past the cap",
  impact: "bonusballMax exceeds 255 - normalBallMax and ticket purchases revert",
  state: "lpDrawingState.lpPoolTotal, drawingState.bonusballMax",
})

const houndHypothesis = JSON.stringify({
  title: "Premium threshold check blocks repayment",
  description: "ROOT CAUSE: Hub._applyPremiumDelta checks aggregated shares.\nATTACK VECTOR: borrower repays.",
  vulnerability_type: "Denial of Service",
  severity: "high",
  node_refs: ["func:Hub.restore"],
  properties: { source_files: ["src/hub/Hub.sol"], graph_name: "SystemArchitecture" },
  status: "rejected",
  confidence: 0.9,
  reported_by_model: "Gemini:gemini-3.8-flash",
  id: "hyp_2a3c4fa9521a",
})

const deps = (gateway: ScriptedModelGateway) => ({ gateway, profileId: "test/model", maxOutputTokens: 1024 })

describe("finding normalizer", () => {
  test("a report already in the template is returned unchanged without a provider call", async () => {
    const gateway = new ScriptedModelGateway([])
    expect(isTemplateFinding(template)).toBe(true)
    const result = await normalizeFinding(deps(gateway), { runId: "run-1", reportMarkdown: template })
    expect(result).toEqual({ kind: "template", reportMarkdown: template })
    expect(gateway.callCount).toBe(0)
  })

  test("a free-form report is rewritten into the template, keeping the narrative and only real PoC code", async () => {
    const gateway = new ScriptedModelGateway([textResponse(claimJson, { usage: usageOf(100, 40, 0.001) })])
    const report = [
      "# LP pool cap is not enforced on settlement",
      "```",
      "newLPValue = postDrawLpValue + pendingDeposits",
      "```",
      "```",
      "pragma solidity ^0.8.28;",
      "contract POC is Test { function testCap() public {} }",
      "```",
    ].join("\n")
    const result = await normalizeFinding(deps(gateway), { runId: "run-1", reportMarkdown: report })
    if (result.kind !== "normalized") throw new Error(`expected normalized, got ${result.kind}`)
    expect(isTemplateFinding(result.reportMarkdown)).toBe(true)
    expect(result.reportMarkdown).toContain("Target: JackpotLPManager.processDrawingSettlement")
    expect(result.reportMarkdown).toContain("# LP pool cap is not enforced on settlement")
    expect(result.reportMarkdown).toContain("```text\nnewLPValue")
    expect(result.reportMarkdown).toContain("```solidity\npragma solidity")
    expect(result.usage).toMatchObject({ promptTokens: 100, completionTokens: 40 })
    expect(gateway.calls[0]?.tools).toBeUndefined()
  })

  test("adjudication fields of a JSON finding never reach the provider or the normalized report", async () => {
    const gateway = new ScriptedModelGateway([textResponse(claimJson)])
    const result = await normalizeFinding(deps(gateway), { runId: "run-1", reportMarkdown: houndHypothesis })
    if (result.kind !== "normalized") throw new Error(`expected normalized, got ${result.kind}`)
    const sent = gateway.calls[0]?.items.find((item) => item.type === "candidate_finding")?.content ?? ""
    for (const leaked of ["rejected", "confidence", "0.9", "reported_by_model", "hyp_2a3c4fa9521a", "graph_name"]) {
      expect(sent).not.toContain(leaked)
      expect(result.reportMarkdown).not.toContain(leaked)
    }
    expect(sent).toContain("Hub._applyPremiumDelta")
    expect(sent).toContain("src/hub/Hub.sol")
  })

  test("an output that is not the claim JSON is repaired once, then the normalization fails", async () => {
    const repaired = new ScriptedModelGateway([textResponse("not json"), textResponse(claimJson)])
    expect((await normalizeFinding(deps(repaired), { runId: "run-1", reportMarkdown: "free text" })).kind).toBe("normalized")
    expect(repaired.callCount).toBe(2)

    const bad = JSON.stringify({ ...JSON.parse(claimJson), target: "processDrawingSettlement" })
    const failing = new ScriptedModelGateway([textResponse(bad), textResponse(bad)])
    const result = await normalizeFinding(deps(failing), { runId: "run-1", reportMarkdown: "free text" })
    expect(result).toMatchObject({ kind: "failed", attempts: 2 })
  })

  test("a provider error fails the normalization with the provider message", async () => {
    const gateway = new ScriptedModelGateway([errorResponse({ isRetryable: false, category: "authentication", message: "bad key" })])
    const result = await normalizeFinding(deps(gateway), { runId: "run-1", reportMarkdown: "free text" })
    expect(result).toMatchObject({ kind: "failed", message: expect.stringContaining("bad key") })
  })
})
