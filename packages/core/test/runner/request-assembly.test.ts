import { describe, expect, test } from "bun:test"
import type { ToolDefinition, ToolRegistryPort } from "@harness/protocol"
import { assembleTurnRequest, type AssembleRequestInput } from "../../src/runner/request-assembly"

class MockToolRegistry implements ToolRegistryPort {
  definitions(): readonly ToolDefinition[] {
    return [
      { name: "read_file", description: "read", parameters: { type: "object" } },
      { name: "list_dir", description: "list", parameters: { type: "object" } },
    ]
  }
  async execute() {
    return { content: "ok", isError: false }
  }
}

describe("assembleTurnRequest", () => {
  const registry = new MockToolRegistry()
  const baseInput: AssembleRequestInput = {
    runId: "run-test-1",
    stepIndex: 1,
    attemptIndex: 1,
    profileId: "gpt-4o",
    prompt: "Audit contract Vault.sol for reentrancy",
    snapshotId: "snap-abc",
    availableFiles: ["contracts/Vault.sol", "contracts/Token.sol"],
    registry,
    historyItems: [],
    maxToolCalls: 15,
  }

  test("assembles system instruction, source info, prompt and tool definitions", () => {
    const request = assembleTurnRequest(baseInput)
    expect(request.runId).toBe("run-test-1")
    expect(request.stepIndex).toBe(1)
    expect(request.attemptIndex).toBe(1)
    expect(request.profileId).toBe("gpt-4o")
    expect(request.maxToolCalls).toBe(15)
    expect(request.tools).toHaveLength(2)
    expect(request.tools?.[0].name).toBe("read_file")

    const types = request.items.map((i) => i.type)
    expect(types).toContain("system_prompt")
    expect(types).toContain("candidate_finding")

    const systemItem = request.items.find((i) => i.type === "system_prompt")
    expect(systemItem?.content).toContain("snap-abc")
    expect(systemItem?.content).toContain("contracts/Vault.sol")

    const promptItem = request.items.find((i) => i.type === "candidate_finding")
    expect(promptItem?.content).toBe("Audit contract Vault.sol for reentrancy")
  })

  test("redacts or sanitizes absolute host paths and rejects ground-truth labels", () => {
    const inputWithLeaks: AssembleRequestInput = {
      ...baseInput,
      prompt: "Check /Users/developer/secret-repo/Vault.sol with GroundTruthLabel: true",
      availableFiles: ["/Users/developer/repo/Vault.sol", "contracts/Vault.sol"],
    }
    const request = assembleTurnRequest(inputWithLeaks)
    for (const item of request.items) {
      expect(item.content).not.toContain("/Users/developer")
      expect(item.content).not.toContain("GroundTruthLabel")
    }
  })

  test("bounds initial source files list according to maxEntries", () => {
    const manyFiles = Array.from({ length: 150 }, (_, i) => `contract_${i}.sol`)
    const request = assembleTurnRequest({
      ...baseInput,
      availableFiles: manyFiles,
      maxSourceEntries: 100,
    })
    const systemItem = request.items.find((i) => i.type === "system_prompt")
    expect(systemItem?.content).toContain("...50 lines truncated...")
    expect(systemItem?.content).not.toContain("contract_149.sol")
  })
})
