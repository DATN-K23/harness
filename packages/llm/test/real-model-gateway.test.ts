import { describe, expect, test } from "bun:test"
import type { ContextItem, ModelAttemptRequest } from "@harness/protocol"
import OpenAI from "openai"
import {
  RealModelGateway,
  calculateModelCost,
  convertToChatMessages,
  getModelPricing,
  normalizeProviderError,
  redactSecrets,
} from "../src"

describe("Model Pricing Registry", () => {
  test("retrieves pricing for known models and variations", () => {
    const mini = getModelPricing("gpt-4o-mini")
    expect(mini).toBeDefined()
    expect(mini?.inputCostPer1M).toBe(0.15)
    expect(mini?.outputCostPer1M).toBe(0.6)

    const full = getModelPricing("openai/gpt-4o")
    expect(full).toBeDefined()
    expect(full?.inputCostPer1M).toBe(2.5)
    expect(full?.outputCostPer1M).toBe(10.0)

    const datedMini = getModelPricing("gpt-4o-mini-2024-07-18")
    expect(datedMini?.inputCostPer1M).toBe(0.15)

    const unknown = getModelPricing("non-existent-model")
    expect(unknown).toBeUndefined()
  })

  test("calculates token cost accurately", () => {
    // 10,000 prompt tokens ($0.150/1M) = $0.0015
    // 2,000 completion tokens ($0.600/1M) = $0.0012
    // Total = $0.0027
    const costMini = calculateModelCost("gpt-4o-mini", {
      promptTokens: 10_000,
      completionTokens: 2_000,
      totalTokens: 12_000,
    })
    expect(costMini).toBe(0.0027)

    // gpt-4o: 100k input ($2.5/1M = $0.25) + 10k output ($10/1M = $0.1) = $0.35
    const cost4o = calculateModelCost("gpt-4o", {
      promptTokens: 100_000,
      completionTokens: 10_000,
      totalTokens: 110_000,
    })
    expect(cost4o).toBe(0.35)

    // Unknown model or missing usage returns 0
    expect(calculateModelCost("unknown-model", { promptTokens: 100, completionTokens: 100 })).toBe(0)
    expect(calculateModelCost("gpt-4o-mini", null)).toBe(0)
    expect(calculateModelCost("gpt-4o-mini", undefined)).toBe(0)
  })
})

describe("Message Converter", () => {
  test("correctly maps ContextItem types to OpenAI chat messages", () => {
    const items: ContextItem[] = [
      {
        id: "ctx_1",
        turn: 0,
        type: "system_prompt",
        isPinned: true,
        content: "You are an audit agent.",
      },
      {
        id: "ctx_2",
        turn: 0,
        type: "tool_description",
        isPinned: true,
        content: "Available tools: read_file",
      },
      {
        id: "ctx_3",
        turn: 1,
        type: "candidate_finding",
        isPinned: true,
        content: "Audit this reentrancy vulnerability",
      },
      {
        id: "ctx_4",
        turn: 1,
        type: "assistant_reasoning",
        isPinned: false,
        content: "Let me inspect the transfer method first.",
      },
      {
        id: "ctx_5",
        turn: 1,
        type: "tool_request",
        isPinned: false,
        content: '{"path":"Token.sol"}',
        toolMeta: {
          callId: "call_abc123",
          toolName: "read_file",
        },
      },
      {
        id: "ctx_6",
        turn: 1,
        type: "tool_result",
        isPinned: false,
        content: "contract Token { ... }",
        toolMeta: {
          callId: "call_abc123",
          toolName: "read_file",
        },
      },
      {
        id: "ctx_7",
        turn: 2,
        type: "compaction_summary",
        isPinned: false,
        content: "Summary of earlier turns.",
      },
    ]

    const messages = convertToChatMessages(items)

    expect(messages).toHaveLength(6)
    expect(messages[0]).toEqual({ role: "system", content: "You are an audit agent." })
    expect(messages[1]).toEqual({ role: "system", content: "Available tools: read_file" })
    expect(messages[2]).toEqual({ role: "user", content: "Audit this reentrancy vulnerability" })
    expect(messages[3]).toEqual({
      role: "assistant",
      content: "Let me inspect the transfer method first.",
      tool_calls: [
        {
          id: "call_abc123",
          type: "function",
          function: {
            name: "read_file",
            arguments: '{"path":"Token.sol"}',
          },
        },
      ],
    })
    expect(messages[4]).toEqual({
      role: "tool",
      tool_call_id: "call_abc123",
      content: "contract Token { ... }",
    })
    expect(messages[5]).toEqual({ role: "system", content: "Summary of earlier turns." })
  })
})

describe("Provider Error Normalization and Secret Redaction", () => {
  test("redacts explicit secrets, OpenAI keys, bearer tokens, and URLs", () => {
    const raw =
      "Failed to connect to postgresql://postgres:mypassword123@localhost:5432/testdb using key sk-abcdef1234567890xyz and Bearer mytoken12345. Custom secret: super_secret_val"
    const redacted = redactSecrets(raw, ["super_secret_val"])

    expect(redacted).not.toContain("mypassword123")
    expect(redacted).toContain("postgresql://***:***@localhost:5432/testdb")
    expect(redacted).not.toContain("sk-abcdef1234567890xyz")
    expect(redacted).toContain("[REDACTED]")
    expect(redacted).not.toContain("Bearer mytoken12345")
    expect(redacted).toContain("Bearer [REDACTED]")
    expect(redacted).not.toContain("super_secret_val")
  })

  test("normalizes 401 and 403 as non-retryable authentication errors", () => {
    const err401 = {
      status: 401,
      message: "Incorrect API key provided: sk-live-1234567890123456",
    }
    const normalized = normalizeProviderError(err401)
    expect(normalized.category).toBe("authentication")
    expect(normalized.isRetryable).toBe(false)
    expect(normalized.statusCode).toBe(401)
    expect(normalized.message).not.toContain("sk-live-1234567890123456")
    expect(normalized.message).toContain("[REDACTED]")

    const err403 = { status: 403, message: "Forbidden" }
    expect(normalizeProviderError(err403).category).toBe("authentication")
    expect(normalizeProviderError(err403).isRetryable).toBe(false)
  })

  test("normalizes 429 as retryable rate_limit error with retry-after header parsing", () => {
    const err429 = {
      status: 429,
      message: "Rate limit reached for requests",
      headers: {
        get: (h: string) => (h === "retry-after" ? "2.5" : null),
      },
    }
    const normalized = normalizeProviderError(err429)
    expect(normalized.category).toBe("rate_limit")
    expect(normalized.isRetryable).toBe(true)
    expect(normalized.statusCode).toBe(429)
    expect(normalized.retryAfterMs).toBe(2500)
  })

  test("normalizes 400 as non-retryable invalid_request error", () => {
    const err400 = {
      status: 400,
      message: "Invalid parameter: max_tokens must be positive",
    }
    const normalized = normalizeProviderError(err400)
    expect(normalized.category).toBe("invalid_request")
    expect(normalized.isRetryable).toBe(false)
    expect(normalized.statusCode).toBe(400)
  })

  test("normalizes 500 and 503 as retryable transport errors", () => {
    const err500 = { status: 500, message: "Internal server error" }
    expect(normalizeProviderError(err500).category).toBe("transport")
    expect(normalizeProviderError(err500).isRetryable).toBe(true)

    const err503 = { status: 503, message: "Service Unavailable" }
    expect(normalizeProviderError(err503).category).toBe("transport")
    expect(normalizeProviderError(err503).isRetryable).toBe(true)
  })

  test("normalizes timeout and network errors", () => {
    const timeoutErr = new Error("The operation timed out")
    timeoutErr.name = "TimeoutError"
    const normalizedTimeout = normalizeProviderError(timeoutErr)
    expect(normalizedTimeout.category).toBe("transport")
    expect(normalizedTimeout.isTimeout).toBe(true)
    expect(normalizedTimeout.isRetryable).toBe(true)

    const connErr = { code: "ECONNRESET", message: "Connection reset by peer" }
    const normalizedConn = normalizeProviderError(connErr)
    expect(normalizedConn.category).toBe("transport")
    expect(normalizedConn.isRetryable).toBe(true)
  })
})

describe("RealModelGateway", () => {
  const dummyRequest: ModelAttemptRequest = {
    runId: "run-test-1",
    stepIndex: 1,
    attemptIndex: 1,
    profileId: "gpt-4o-mini",
    items: [
      {
        id: "item-1",
        turn: 1,
        type: "candidate_finding",
        isPinned: true,
        content: "Explain reentrancy",
      },
    ],
  }

  test("successfully executes attempt with mock OpenAI client", async () => {
    let capturedParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming | undefined
    let capturedOptions: { signal?: AbortSignal } | undefined

    const mockClient = {
      chat: {
        completions: {
          create: async (
            params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
            options?: { signal?: AbortSignal },
          ) => {
            capturedParams = params
            capturedOptions = options
            return {
              id: "chatcmpl-123",
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: "Reentrancy is when external calls hijack control flow.",
                  },
                },
              ],
              usage: {
                prompt_tokens: 20,
                completion_tokens: 30,
                total_tokens: 50,
              },
            }
          },
        },
      },
    } as unknown as OpenAI

    const gateway = new RealModelGateway({
      client: mockClient,
      model: "gpt-4o-mini",
    })

    const response = await gateway.executeAttempt(dummyRequest)

    expect(response.attemptId).toBe("run-test-1:1:1")
    expect(response.finishReason).toBe("stop")
    expect(response.content).toBe("Reentrancy is when external calls hijack control flow.")
    expect(response.usage.promptTokens).toBe(20)
    expect(response.usage.completionTokens).toBe(30)
    expect(response.usage.totalTokens).toBe(50)
    expect(response.usage.costUsd).toBeGreaterThan(0)
    expect(response.latencyMs).toBeGreaterThanOrEqual(0)
    expect(response.error).toBeUndefined()

    expect(capturedParams?.model).toBe("gpt-4o-mini")
    expect(capturedOptions?.signal).toBeDefined()
  })

  test("parses tool calls from model completion", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_read_1",
                      type: "function",
                      function: {
                        name: "read_file",
                        arguments: '{"path":"contracts/Vault.sol"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 25,
              total_tokens: 40,
            },
          }),
        },
      },
    } as unknown as OpenAI

    const gateway = new RealModelGateway({
      client: mockClient,
      model: "gpt-4o-mini",
    })

    const response = await gateway.executeAttempt(dummyRequest)

    expect(response.finishReason).toBe("tool_calls")
    expect(response.toolCalls).toHaveLength(1)
    expect(response.toolCalls?.[0]?.name).toBe("read_file")
    expect(response.toolCalls?.[0]?.arguments).toEqual({ path: "contracts/Vault.sol" })
  })

  test("NEVER throws on provider error and resolves with finishReason: error and redacted secret", async () => {
    const secretKey = "sk-super-secret-key-that-must-never-leak"
    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            const err = Object.assign(new Error(`Authentication error with key ${secretKey}`), {
              status: 401,
            })
            throw err
          },
        },
      },
    } as unknown as OpenAI

    const gateway = new RealModelGateway({
      client: mockClient,
      apiKey: secretKey,
    })

    const response = await gateway.executeAttempt(dummyRequest)

    expect(response.finishReason).toBe("error")
    expect(response.error).toBeDefined()
    expect(response.error?.category).toBe("authentication")
    expect(response.error?.isRetryable).toBe(false)
    expect(response.error?.message).not.toContain(secretKey)
    expect(response.error?.message).toContain("[REDACTED]")
    expect(response.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, pricing: "priced" })
  })

  test("handles pre-aborted signal gracefully without throwing", async () => {
    const controller = new AbortController()
    controller.abort(new Error("User cancelled request"))

    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("Should not be called")
          },
        },
      },
    } as unknown as OpenAI

    const gateway = new RealModelGateway({ client: mockClient })
    const response = await gateway.executeAttempt(dummyRequest, controller.signal)

    expect(response.finishReason).toBe("error")
    expect(response.error).toBeDefined()
    expect(response.error?.category).toBe("transport")
    expect(response.error?.message).toContain("User cancelled request")
  })
})
