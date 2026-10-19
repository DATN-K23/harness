import { describe, expect, test } from "bun:test"
import {
  ModelUsageSchema,
  ModelAttemptErrorClassifications,
  ProviderErrorCategories,
  type ModelAttemptError,
  type ModelToolCall,
  type ModelAttemptRequest,
  type ModelAttemptResponse,
  type ModelGatewayPort,
} from "../src/model-gateway"

class RateLimitedGateway implements ModelGatewayPort {
  calls = 0

  async executeAttempt(_request: ModelAttemptRequest): Promise<ModelAttemptResponse> {
    this.calls += 1
    return {
      attemptId: "attempt-1",
      finishReason: "error",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
      latencyMs: 12,
      error: { isRetryable: true, category: "rate_limit", message: "429 too many requests", statusCode: 429 },
    }
  }
}

const request: ModelAttemptRequest = {
  runId: "run-1",
  stepIndex: 1,
  attemptIndex: 0,
  profileId: "openai-responses-gpt-4o",
  items: [],
}

describe("ModelGatewayPort", () => {
  test("a provider failure resolves as data with finishReason error and a category", async () => {
    const gateway = new RateLimitedGateway()
    const response = await gateway.executeAttempt(request)
    expect(gateway.calls).toBe(1)
    expect(response.finishReason).toBe("error")
    expect(response.error?.category).toBe("rate_limit")
    expect(response.error?.isRetryable).toBe(true)
  })

  test("error categories are the four documented ones", () => {
    expect([...ProviderErrorCategories]).toEqual(["transport", "rate_limit", "authentication", "invalid_request"])
  })

  test("usage requires non-negative integer tokens and a non-negative cost", () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.01 }
    expect(ModelUsageSchema.safeParse(usage).success).toBe(true)
    expect(ModelUsageSchema.safeParse({ ...usage, promptTokens: -1 }).success).toBe(false)
    expect(ModelUsageSchema.safeParse({ ...usage, costUsd: -0.5 }).success).toBe(false)
    expect(ModelUsageSchema.safeParse({ ...usage, totalTokens: 1.5 }).success).toBe(false)
    expect(ModelUsageSchema.parse(usage).pricing).toBeUndefined()
    expect(ModelUsageSchema.parse({ ...usage, pricing: "unpriced" }).pricing).toBe("unpriced")
    expect(ModelUsageSchema.safeParse({ ...usage, pricing: "unknown" }).success).toBe(false)
  })

  test("tool calls carry optional invalid-argument details", () => {
    const toolCall: ModelToolCall = {
      id: "call-1",
      name: "read_file",
      arguments: {},
      argumentsError: "Tool arguments are not valid JSON",
      rawArguments: "{\"path\":",
    }
    expect(toolCall.argumentsError).toContain("not valid JSON")
    expect(toolCall.rawArguments).toBe("{\"path\":")
  })

  test("provider error classifications are exported and typed", () => {
    const error: ModelAttemptError = {
      isRetryable: false,
      category: "invalid_request",
      message: "Input exceeds context length",
      classification: "context_overflow",
    }
    expect([...ModelAttemptErrorClassifications]).toEqual([
      "context_overflow",
      "content_filter",
      "invalid_provider_output",
    ])
    expect(error.classification).toBe("context_overflow")
  })

  test("a provider error may carry the Retry-After delay it saw, in milliseconds", () => {
    const error: ModelAttemptError = {
      isRetryable: true,
      category: "rate_limit",
      message: "429 too many requests",
      statusCode: 429,
      retryAfterMs: 30_000,
    }
    expect(error.retryAfterMs).toBe(30_000)
  })

  test("ModelAttemptRequest accepts optional read-only tools and maxToolCalls", () => {
    const { validateAttemptRequestTools } = require("../src/model-gateway")
    const reqWithTools: ModelAttemptRequest = {
      ...request,
      tools: [
        { name: "read_file", description: "read a file", parameters: { type: "object" } },
        { name: "grep", description: "grep pattern", parameters: { type: "object" } },
      ],
      maxToolCalls: 10,
    }
    expect(validateAttemptRequestTools(reqWithTools.tools)).toBe(true)
    expect(reqWithTools.maxToolCalls).toBe(10)
  })

  test("ModelAttemptRequest refuses write, shell, network or arbitrary execution tools", () => {
    const { validateAttemptRequestTools } = require("../src/model-gateway")
    expect(() =>
      validateAttemptRequestTools([
        { name: "write_file", description: "write", parameters: { type: "object" } },
      ]),
    ).toThrow(/read-only/)

    expect(() =>
      validateAttemptRequestTools([
        { name: "shell_exec", description: "run shell", parameters: { type: "object" } },
      ]),
    ).toThrow(/read-only/)

    expect(() =>
      validateAttemptRequestTools([
        { name: "fetch_url", description: "fetch network", parameters: { type: "object" } },
      ]),
    ).toThrow(/read-only/)
  })

  test("ModelAttemptRequest with absent tools is valid (baseline behavior)", () => {
    const { validateAttemptRequestTools } = require("../src/model-gateway")
    expect(validateAttemptRequestTools(undefined)).toBe(true)
  })
})
