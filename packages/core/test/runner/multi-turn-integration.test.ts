import { describe, expect, test } from "bun:test"
import type {
  ModelAttemptRequest,
  ModelAttemptResponse,
  ModelGatewayPort,
  SourceSnapshotPort,
  ToolCall,
  ToolDefinition,
  ToolExecutionResult,
  ToolRegistryPort,
} from "@harness/protocol"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { MultiTurnRunner } from "../../src/runner/multi-turn-runner"
import { getMultiTurnExecutionSummary } from "../../src/runner/run-queries"

class MultiTurnScriptedGateway implements ModelGatewayPort {
  private turn = 0

  async executeAttempt(request: ModelAttemptRequest): Promise<ModelAttemptResponse> {
    this.turn += 1
    if (this.turn === 1) {
      return {
        attemptId: "att-turn-1",
        finishReason: "tool_calls",
        toolCalls: [
          { id: "call-vault", name: "read_file", arguments: { path: "contracts/Vault.sol" } },
        ],
        usage: { promptTokens: 30, completionTokens: 10, totalTokens: 40, costUsd: 0.001 },
        latencyMs: 80,
      }
    }
    if (this.turn === 2) {
      return {
        attemptId: "att-turn-2",
        finishReason: "tool_calls",
        toolCalls: [
          { id: "call-token", name: "read_file", arguments: { path: "contracts/Token.sol" } },
        ],
        usage: { promptTokens: 60, completionTokens: 15, totalTokens: 75, costUsd: 0.002 },
        latencyMs: 95,
      }
    }
    return {
      attemptId: "att-turn-3",
      finishReason: "stop",
      content: "Audit analysis complete: cross-contract reentrancy verified between Vault and Token.",
      usage: { promptTokens: 100, completionTokens: 25, totalTokens: 125, costUsd: 0.003 },
      latencyMs: 110,
    }
  }
}

class IntegrationRegistry implements ToolRegistryPort {
  definitions(): readonly ToolDefinition[] {
    return [
      {
        name: "read_file",
        description: "read source lines",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ]
  }

  async execute(call: ToolCall): Promise<ToolExecutionResult> {
    const p = String(call.arguments.path)
    if (p.includes("Vault")) return { content: "contract Vault { function withdraw() external {} }", isError: false }
    if (p.includes("Token")) return { content: "contract Token { function transfer() external {} }", isError: false }
    return { content: `File not found: ${p}`, isError: true }
  }
}

class IntegrationSnapshot implements SourceSnapshotPort {
  async listFiles() {
    return ["contracts/Vault.sol", "contracts/Token.sol"]
  }
  async readLines() {
    return { kind: "ok" as const, lines: ["contract code"] }
  }
}

describe("MultiTurnRunner Full Integration", () => {
  test("executes 3-turn chain with tools, verifies persistence and reads back summary", async () => {
    const clock = { nowMs: () => 5000 }
    const store = new InMemoryRunStore({ clock })
    const gateway = new MultiTurnScriptedGateway()
    const registry = new IntegrationRegistry()
    const snapshot = new IntegrationSnapshot()

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry,
      snapshot,
      clock,
    })

    const runResult = await runner.execute({
      prompt: "Find reentrancy vulnerability between contracts",
      snapshotId: "snap-integration-sprint3",
      profileId: "audit-agent-v1",
      limits: {
        maxSteps: 5,
        maxToolCalls: 10,
        wallClockTimeoutMs: 30000,
      },
    })

    expect(runResult.state).toBe("completed")
    expect(runResult.stepsExecuted).toBe(3)
    expect(runResult.toolCallsExecuted).toBe(2)
    expect(runResult.output).toContain("cross-contract reentrancy verified")

    // Readback via getMultiTurnExecutionSummary from store
    const summary = await getMultiTurnExecutionSummary(runResult.runId, store)
    expect(summary).toBeDefined()
    expect(summary?.snapshotId).toBe("snap-integration-sprint3")
    expect(summary?.state).toBe("completed")

    // Verify tool calls
    expect(summary?.toolCalls).toHaveLength(2)
    expect(summary?.toolCalls[0].toolName).toBe("read_file")
    expect(summary?.toolCalls[0].arguments.path).toBe("contracts/Vault.sol")
    expect(summary?.toolCalls[0].status).toBe("completed")
    expect(summary?.toolCalls[0].resultContent).toContain("contract Vault")

    expect(summary?.toolCalls[1].toolName).toBe("read_file")
    expect(summary?.toolCalls[1].arguments.path).toBe("contracts/Token.sol")
    expect(summary?.toolCalls[1].status).toBe("completed")
    expect(summary?.toolCalls[1].resultContent).toContain("contract Token")

    // Verify model attempts recorded in store
    expect(summary?.attempts).toHaveLength(3)
    expect(summary?.attempts[0].stepIndex).toBe(1)
    expect(summary?.attempts[1].stepIndex).toBe(2)
    expect(summary?.attempts[2].stepIndex).toBe(3)

    // Verify sequence integrity in events
    const sequences = (summary?.events ?? []).map((e) => e.sequence)
    for (let i = 0; i < sequences.length; i++) {
      expect(sequences[i]).toBe(i + 1)
    }
  })
})
