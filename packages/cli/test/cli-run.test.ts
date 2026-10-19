import { describe, expect, test } from "bun:test"
import { executeRunCommand } from "../src/commands/run"
import { runCli } from "../src/index"
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
          modelOutputTokensField: "max_tokens",
          snapshotDir: "data/snapshots",
          runLimits: {},
        },
      },
    )

    expect(exitCode).toBe(1)
    expect(result?.state).toBe("failed")
    expect(["authentication", "transport"]).toContain(result?.errorCategory as string)
    expect(output).toContain("State:        failed")
    expect(output).not.toContain(apiKey)
  })

  test("runCli surfaces ConfigValidationError when required env vars are missing without --mock", async () => {
    const prevEnv = { ...process.env }
    delete process.env.DATABASE_URL
    delete process.env.PROVIDER_NAME
    delete process.env.MODEL_NAME
    delete process.env.MODEL_API_KEY

    const errLogs: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => {
      errLogs.push(args.map(String).join(" "))
    }

    try {
      const exitCode = await runCli(["run", "--prompt", "test without config"])
      expect(exitCode).toBe(1)
      expect(errLogs.join("\n")).toContain("Invalid runtime configuration")
      expect(errLogs.join("\n")).toContain("DATABASE_URL")
    } finally {
      console.error = originalError
      process.env = prevEnv
    }
  })

  test("runCli supports --mock flag without throwing or requiring config", async () => {
    const prevEnv = { ...process.env }
    delete process.env.DATABASE_URL
    delete process.env.PROVIDER_NAME
    delete process.env.MODEL_NAME
    delete process.env.MODEL_API_KEY

    const outLogs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => {
      outLogs.push(args.map(String).join(" "))
    }

    try {
      const exitCode = await runCli(["run", "--prompt", "hello mock", "--mock"])
      expect(exitCode).toBe(0)
      expect(outLogs.join("\n")).toContain("Run Execution Summary")
      expect(outLogs.join("\n")).toContain("Hello from Harness CLI mock runner.")
    } finally {
      console.log = originalLog
      process.env = prevEnv
    }
  })

  test("runCli view requires DATABASE_URL unless --mock is specified", async () => {
    const prevEnv = { ...process.env }
    delete process.env.DATABASE_URL

    const errLogs: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => {
      errLogs.push(args.map(String).join(" "))
    }

    try {
      const exitCode = await runCli(["view", "--id", "run-123"])
      expect(exitCode).toBe(1)
      expect(errLogs.join("\n")).toContain("Error: DATABASE_URL is required to inspect persistent runs. Use --mock for in-memory testing.")
    } finally {
      console.error = originalError
      process.env = prevEnv
    }
  })

  test("runCli view supports --mock flag", async () => {
    const prevEnv = { ...process.env }
    delete process.env.DATABASE_URL

    const outLogs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => {
      outLogs.push(args.map(String).join(" "))
    }

    try {
      const exitCode = await runCli(["view", "--id", "run-mock-123", "--mock"])
      // Run is not found in fresh mock store, but it executes through view command without DATABASE_URL error
      expect(exitCode).toBe(1)
      expect(outLogs.join("\n")).toContain("Error: Run 'run-mock-123' not found in persistent store.")
    } finally {
      console.log = originalLog
      process.env = prevEnv
    }
  })
})
