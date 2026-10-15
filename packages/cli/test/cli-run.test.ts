import { describe, expect, test } from "bun:test"
import { executeRunCommand } from "../src/commands/run"
import { InMemoryRunStore, ScriptedModelGateway, errorResponse, textResponse } from "@harness/core/testing"

describe("executeRunCommand", () => {
  test("fails when prompt flag is omitted or empty", async () => {
    const { exitCode, output } = await executeRunCommand({ prompt: "" })
    expect(exitCode).toBe(1)
    expect(output).toContain("Error: --prompt is required")
  })

  test("successfully executes prompt with injected gateway and store", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const gateway = new ScriptedModelGateway([
      textResponse("Smart contracts are immutable programs on blockchain.", {
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0.00015 },
      }),
    ])

    const { exitCode, result, output } = await executeRunCommand(
      {
        prompt: "Explain smart contracts",
        model: "gpt-4o-mini",
      },
      { store, gateway },
    )

    expect(exitCode).toBe(0)
    expect(result).toBeDefined()
    expect(result?.state).toBe("completed")
    expect(result?.content).toBe("Smart contracts are immutable programs on blockchain.")
    expect(result?.usage?.totalTokens).toBe(30)
    expect(result?.usage?.costUsd).toBe(0.00015)

    expect(output).toContain("Run Execution Summary")
    expect(output).toContain("State:        completed")
    expect(output).toContain("Model:        gpt-4o-mini")
    expect(output).toContain("Smart contracts are immutable programs on blockchain.")
  })

  test("gracefully handles and redacts errors during model execution", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const apiKey = "sk-secret-leaked-key-123456"
    const gateway = new ScriptedModelGateway([
      errorResponse({
        category: "authentication",
        message: `Authentication failed using key ${apiKey}`,
        isRetryable: false,
      }),
    ])

    const { exitCode, result, output } = await executeRunCommand(
      {
        prompt: "Will fail",
        model: "gpt-4o-mini",
      },
      { store, gateway, secrets: [apiKey] },
    )

    expect(exitCode).toBe(1)
    expect(result?.state).toBe("failed")
    expect(result?.errorCategory).toBe("authentication")
    expect(result?.error).not.toContain(apiKey)
    expect(output).toContain("State:        failed")
    expect(output).toContain("Category:     authentication")
    expect(output).not.toContain(apiKey)
  })

  test("instantiates RealModelGateway when modelApiKey is in config and gateway is not injected", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const apiKey = "sk-test-live-key-999999999999"

    // Invoking with invalid key against real gateway should safely fail with authentication category without crashing
    const { exitCode, result, output } = await executeRunCommand(
      {
        prompt: "Test prompt with real gateway",
        model: "gpt-4o-mini",
      },
      {
        store,
        config: {
          databaseUrl: "postgresql://localhost:5432/test",
          providerName: "openai",
          modelName: "gpt-4o-mini",
          modelApiKey: apiKey,
          modelTimeoutMs: 1000,
          modelMaxOutputTokens: 256,
        },
      },
    )

    expect(exitCode).toBe(1)
    expect(result?.state).toBe("failed")
    expect(["authentication", "transport"]).toContain(result?.errorCategory as string)
    expect(output).toContain("State:        failed")
    expect(output).not.toContain(apiKey)
  })
})
