import { describe, expect, test } from "bun:test"
import {
  ModelUsageSchema,
  ProviderErrorCategories,
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
  })
})
