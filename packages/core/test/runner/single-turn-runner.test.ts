import { describe, expect, test } from "bun:test"
import { SingleTurnRunner, validateSingleTurnInput } from "../../src/runner/single-turn-runner"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { ScriptedModelGateway, errorResponse, textResponse } from "../../src/testing/scripted-model-gateway"

describe("validateSingleTurnInput", () => {
  test("accepts valid input with default options", () => {
    const result = validateSingleTurnInput({
      prompt: "Hello world",
    })
    expect(result).toEqual({ valid: true })
  })

  test("accepts valid input with custom options", () => {
    const result = validateSingleTurnInput({
      prompt: "Custom options test",
      profileId: "gpt-4o",
      timeoutMs: 5000,
      maxOutputTokens: 1024,
      workerId: "test-worker",
      maxPromptLength: 1000,
    })
    expect(result).toEqual({ valid: true })
  })

  test("rejects empty prompt", () => {
    const result = validateSingleTurnInput({
      prompt: "",
    })
    expect(result).toEqual({
      valid: false,
      reason: "Prompt must not be empty or whitespace only",
      errorCategory: "invalid_request",
    })
  })

  test("rejects whitespace prompt", () => {
    const result = validateSingleTurnInput({
      prompt: "   \t \n ",
    })
    expect(result).toEqual({
      valid: false,
      reason: "Prompt must not be empty or whitespace only",
      errorCategory: "invalid_request",
    })
  })

  test("rejects prompt exceeding maximum allowed length with default threshold", () => {
    const longPrompt = "a".repeat(65_537)
    const result = validateSingleTurnInput({
      prompt: longPrompt,
    })
    expect(result).toEqual({
      valid: false,
      reason: "Prompt length exceeds maximum allowed characters",
      errorCategory: "invalid_request",
    })
  })

  test("rejects prompt exceeding custom maximum allowed length", () => {
    const result = validateSingleTurnInput({
      prompt: "123456",
      maxPromptLength: 5,
    })
    expect(result).toEqual({
      valid: false,
      reason: "Prompt length exceeds maximum allowed characters",
      errorCategory: "invalid_request",
    })
  })

  test("accepts prompt exactly at maximum allowed length", () => {
    const result = validateSingleTurnInput({
      prompt: "12345",
      maxPromptLength: 5,
    })
    expect(result).toEqual({ valid: true })
  })

  test("rejects non-positive timeoutMs (zero)", () => {
    const result = validateSingleTurnInput({
      prompt: "valid prompt",
      timeoutMs: 0,
    })
    expect(result).toEqual({
      valid: false,
      reason: "timeoutMs must be positive",
      errorCategory: "invalid_request",
    })
  })

  test("rejects non-positive timeoutMs (negative)", () => {
    const result = validateSingleTurnInput({
      prompt: "valid prompt",
      timeoutMs: -10,
    })
    expect(result).toEqual({
      valid: false,
      reason: "timeoutMs must be positive",
      errorCategory: "invalid_request",
    })
  })

  test("rejects non-positive maxOutputTokens (zero)", () => {
    const result = validateSingleTurnInput({
      prompt: "valid prompt",
      maxOutputTokens: 0,
    })
    expect(result).toEqual({
      valid: false,
      reason: "maxOutputTokens must be positive",
      errorCategory: "invalid_request",
    })
  })

  test("rejects non-positive maxOutputTokens (negative)", () => {
    const result = validateSingleTurnInput({
      prompt: "valid prompt",
      maxOutputTokens: -50,
    })
    expect(result).toEqual({
      valid: false,
      reason: "maxOutputTokens must be positive",
      errorCategory: "invalid_request",
    })
  })
})

describe("SingleTurnRunner", () => {
  test("successfully executes a prompt run with InMemoryRunStore and ScriptedModelGateway", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1_000 } })
    const gateway = new ScriptedModelGateway([
      textResponse("Smart contracts are immutable bytecode on EVM.", {
        usage: { promptTokens: 12, completionTokens: 18, totalTokens: 30, costUsd: 0.0003 },
      }),
    ])

    const runner = new SingleTurnRunner({
      store,
      gateway,
      clock: { nowMs: () => 1_000 },
    })

    const result = await runner.execute({
      prompt: "Explain smart contracts",
      profileId: "test-profile",
    })

    expect(result.state).toBe("completed")
    expect(result.content).toBe("Smart contracts are immutable bytecode on EVM.")
    expect(result.usage?.totalTokens).toBe(30)
    expect(result.usage?.costUsd).toBe(0.0003)

    // Verify run record in store
    const runRecord = await store.loadRun(result.runId)
    expect(runRecord).toBeDefined()
    expect(runRecord?.state).toBe("completed")

    // Verify events in store
    const events = await store.loadEvents({ runId: result.runId })
    const eventTypes = events.map((e) => e.type)
    expect(eventTypes).toContain("run.queued")
    expect(eventTypes).toContain("run.started")
    expect(eventTypes).toContain("provider.attempted")
  })

  test("validation failure returns failed result without calling store or gateway", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1_000 } })
    const gateway = new ScriptedModelGateway([])

    const runner = new SingleTurnRunner({
      store,
      gateway,
      clock: { nowMs: () => 1_000 },
    })

    const result = await runner.execute({
      prompt: "   ",
    })

    expect(result.state).toBe("failed")
    expect(result.error).toBe("Prompt must not be empty or whitespace only")
    expect(result.errorCategory).toBe("invalid_request")
    expect(result.terminalReason).toBe("invalid_input")
    expect(gateway.calls).toHaveLength(0)

    const runRecord = await store.loadRun(result.runId)
    expect(runRecord).toBeUndefined()
  })

  test("provider error returns failed result with redacted error message and store transitioned to failed", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1_000 } })
    const secretKey = "sk-secret-provider-key-1234"
    const gateway = new ScriptedModelGateway([
      errorResponse({
        category: "authentication",
        message: `Unauthorized access with key ${secretKey}`,
        isRetryable: false,
      }),
    ])

    const runner = new SingleTurnRunner({
      store,
      gateway,
      clock: { nowMs: () => 1_000 },
      secrets: [secretKey],
    })

    const result = await runner.execute({
      prompt: "Run secure prompt",
    })

    expect(result.state).toBe("failed")
    expect(result.errorCategory).toBe("authentication")
    expect(result.error).not.toContain(secretKey)
    expect(result.error).toContain("<redacted>")

    const runRecord = await store.loadRun(result.runId)
    expect(runRecord?.state).toBe("failed")

    const events = await store.loadEvents({ runId: result.runId })
    const eventTypes = events.map((e) => e.type)
    expect(eventTypes).toContain("run.queued")
    expect(eventTypes).toContain("run.started")
    expect(eventTypes).toContain("provider.failed")
    expect(eventTypes).toContain("run.failed")

    // Verify secrets are redacted from stored events as well
    for (const evt of events) {
      expect(JSON.stringify(evt.payload)).not.toContain(secretKey)
    }
  })

  test("gateway timeout returns failed result with wall_clock terminal reason", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1_000 } })
    const gateway = new ScriptedModelGateway([
      errorResponse({
        category: "transport",
        message: "request timed out after 5000ms",
        isRetryable: true,
        isTimeout: true,
      }),
    ])

    const runner = new SingleTurnRunner({
      store,
      gateway,
      clock: { nowMs: () => 1_000 },
    })

    const result = await runner.execute({
      prompt: "Timeout test",
      timeoutMs: 5_000,
    })

    expect(result.state).toBe("failed")
    expect(result.terminalReason).toBe("wall_clock")
    expect(result.errorCategory).toBe("transport")

    const runRecord = await store.loadRun(result.runId)
    expect(runRecord?.state).toBe("failed")
    expect(runRecord?.terminalReason).toBe("wall_clock")
  })

  test("redacts secrets from result content, error message, and stored events", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1_000 } })
    const secretApiKey = "sk-prod-super-secret-api-token"
    const secretDbUrl = "postgres://admin:topsecretpassword@db.internal:5432/main"

    const gateway = new ScriptedModelGateway([
      textResponse(`Response contains key ${secretApiKey} and db ${secretDbUrl}`),
    ])

    const runner = new SingleTurnRunner({
      store,
      gateway,
      clock: { nowMs: () => 1_000 },
      secrets: [secretApiKey],
    })

    const result = await runner.execute({
      prompt: `Prompt leaking ${secretApiKey}`,
    })

    expect(result.state).toBe("completed")
    expect(result.content).not.toContain(secretApiKey)
    expect(result.content).not.toContain("topsecretpassword")
    expect(result.content).toContain("<redacted>")

    const events = await store.loadEvents({ runId: result.runId })
    for (const evt of events) {
      const serialized = JSON.stringify(evt.payload)
      expect(serialized).not.toContain(secretApiKey)
      expect(serialized).not.toContain("topsecretpassword")
    }
  })

  test("handles unexpected exceptions safely without throwing unhandled rejection", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1_000 } })
    const throwingGateway = {
      async executeAttempt(): Promise<never> {
        throw new Error("Unexpected network socket failure")
      },
    }

    const runner = new SingleTurnRunner({
      store,
      gateway: throwingGateway,
      clock: { nowMs: () => 1_000 },
    })

    const result = await runner.execute({
      prompt: "Will throw internally",
    })

    expect(result.state).toBe("failed")
    expect(result.error).toContain("Unexpected network socket failure")
    expect(result.errorCategory).toBe("internal_error")

    const runRecord = await store.loadRun(result.runId)
    expect(runRecord?.state).toBe("failed")
  })
})
