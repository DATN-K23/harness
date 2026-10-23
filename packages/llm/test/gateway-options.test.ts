import { describe, expect, test } from "bun:test"
import type { ModelAttemptRequest, ToolDefinition } from "@harness/protocol"
import type OpenAI from "openai"
import { RealModelGateway, projectOpenAIToolSchema, sanitizeToolArguments } from "../src"
import { readRecordingFixture, RecordingClient } from "./support/recording-client"

const baseRequest = (overrides: Partial<ModelAttemptRequest> = {}): ModelAttemptRequest => ({
  runId: "options-run",
  stepIndex: 1,
  attemptIndex: 0,
  profileId: "gpt-4o-mini",
  items: [{ id: "prompt", turn: 0, type: "candidate_finding", isPinned: true, content: "Inspect." }],
  ...overrides,
})

const tools: ToolDefinition[] = [
  { name: "read_file", description: "Read a file.", parameters: { type: "object", properties: { path: { type: "string" } } } },
]

describe("gateway request options", () => {
  test("disabled tools omit tool definitions and tool choice", async () => {
    const recording = new RecordingClient(readRecordingFixture("content-filter"))
    await new RealModelGateway({ client: recording.client }).executeAttempt(
      baseRequest({ toolsDisabled: true, tools }),
    )
    expect(recording.requests[0]?.tools).toBeUndefined()
    expect(recording.requests[0]?.tool_choice).toBeUndefined()
  })

  test("disabled tools send none only when tool history is present", async () => {
    const noHistory = new RecordingClient(readRecordingFixture("content-filter"))
    await new RealModelGateway({ client: noHistory.client }).executeAttempt(baseRequest({ toolsDisabled: true }))
    expect(noHistory.requests[0]?.tool_choice).toBeUndefined()

    const withHistory = new RecordingClient(readRecordingFixture("content-filter"))
    await new RealModelGateway({ client: withHistory.client }).executeAttempt(baseRequest({
      toolsDisabled: true,
      items: [
        { id: "prompt", turn: 0, type: "candidate_finding", isPinned: true, content: "Inspect." },
        { id: "request", turn: 1, type: "tool_request", isPinned: false, content: "{}", toolMeta: { callId: "call-1", toolName: "read_file" } },
        { id: "result", turn: 1, type: "tool_result", isPinned: false, content: "source", toolMeta: { callId: "call-1", toolName: "read_file" } },
      ],
    }))
    expect(withHistory.requests[0]?.tools).toBeUndefined()
    expect(withHistory.requests[0]?.tool_choice).toBe("none")
  })

  test("a required tool choice is lowered for structured output", async () => {
    const recording = new RecordingClient(readRecordingFixture("content-filter"))
    await new RealModelGateway({ client: recording.client }).executeAttempt(baseRequest({ tools, toolChoice: "required" }))
    expect(recording.requests[0]?.tool_choice).toBe("required")
  })

  test("one allowed call disables provider parallel calls", async () => {
    const recording = new RecordingClient(readRecordingFixture("content-filter"))
    await new RealModelGateway({ client: recording.client }).executeAttempt(
      baseRequest({ tools, maxToolCalls: 1 }),
    )
    expect(recording.requests[0]?.parallel_tool_calls).toBe(false)
  })

  test("projects nullable unions and root anyOf schemas to OpenAI object schemas", () => {
    expect(projectOpenAIToolSchema({
      anyOf: [
        { type: "object", properties: { path: { anyOf: [{ type: "string" }, { type: "null" }] } } },
        { type: "object", properties: { startLine: { type: "integer" } } },
      ],
    })).toEqual({
      type: "object",
      properties: {
        path: { type: "string" },
        startLine: { type: "integer" },
      },
      additionalProperties: false,
    })
  })

  test("parallel call history lowers to one assistant message and ordered tool messages", async () => {
    const recording = new RecordingClient(readRecordingFixture("content-filter"))
    const items = [
      { id: "prompt", turn: 0, type: "candidate_finding" as const, isPinned: true, content: "Inspect." },
      { id: "reasoning", turn: 1, type: "assistant_reasoning" as const, isPinned: false, content: "I will inspect two files." },
      { id: "request-1", turn: 1, type: "tool_request" as const, isPinned: false, content: "{\"path\":\"src/A.sol\"}", toolMeta: { callId: "c1", toolName: "read_file" } },
      { id: "result-1", turn: 1, type: "tool_result" as const, isPinned: false, content: "A", toolMeta: { callId: "c1", toolName: "read_file" } },
      { id: "request-2", turn: 1, type: "tool_request" as const, isPinned: false, content: "{\"path\":\"src/B.sol\"}", toolMeta: { callId: "c2", toolName: "read_file" } },
      { id: "result-2", turn: 1, type: "tool_result" as const, isPinned: false, content: "B", toolMeta: { callId: "c2", toolName: "read_file" } },
    ]
    await new RealModelGateway({ client: recording.client }).executeAttempt(baseRequest({ items }))
    expect(recording.requests[0]?.messages).toEqual([
      { role: "user", content: "Inspect." },
      {
        role: "assistant",
        content: "I will inspect two files.",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"src/A.sol\"}" } },
          { id: "c2", type: "function", function: { name: "read_file", arguments: "{\"path\":\"src/B.sol\"}" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "A" },
      { role: "tool", tool_call_id: "c2", content: "B" },
    ])
  })

  test("a harness instruction added mid-run is sent with the user role", async () => {
    const recording = new RecordingClient(readRecordingFixture("content-filter"))
    const items = [
      { id: "system", turn: 0, type: "system_prompt" as const, isPinned: true, content: "You are the Judge." },
      { id: "prompt", turn: 0, type: "candidate_finding" as const, isPinned: true, content: "Inspect." },
      { id: "forcing", turn: 5, type: "harness_instruction" as const, isPinned: false, content: "Answer now." },
    ]
    await new RealModelGateway({ client: recording.client }).executeAttempt(baseRequest({ items }))
    expect(recording.requests[0]?.messages.at(-1)).toEqual({ role: "user", content: "Answer now." })
  })

  test("tool descriptions are not repeated as system messages when the tools themselves are sent", async () => {
    const items = [
      { id: "prompt", turn: 0, type: "candidate_finding" as const, isPinned: true, content: "Inspect." },
      { id: "tool", turn: 0, type: "tool_description" as const, isPinned: true, content: "read_file: Read a file." },
    ]
    const withTools = new RecordingClient(readRecordingFixture("content-filter"))
    await new RealModelGateway({ client: withTools.client }).executeAttempt(baseRequest({ items, tools }))
    expect(withTools.requests[0]?.messages).toEqual([{ role: "user", content: "Inspect." }])

    const disabled = new RecordingClient(readRecordingFixture("content-filter"))
    await new RealModelGateway({ client: disabled.client }).executeAttempt(baseRequest({ items, tools, toolsDisabled: true }))
    expect(disabled.requests[0]?.messages).toContainEqual({ role: "system", content: "read_file: Read a file." })
  })

  test("Judge-style {name, arguments} request content replays only the arguments", async () => {
    const recording = new RecordingClient(readRecordingFixture("content-filter"))
    const items = [
      { id: "prompt", turn: 0, type: "candidate_finding" as const, isPinned: true, content: "Inspect." },
      {
        id: "request", turn: 1, type: "tool_request" as const, isPinned: false,
        content: JSON.stringify({ name: "glob", arguments: { pattern: "**" } }),
        toolMeta: { callId: "c1", toolName: "glob" },
      },
      { id: "result", turn: 1, type: "tool_result" as const, isPinned: false, content: "src/A.sol", toolMeta: { callId: "c1", toolName: "glob" } },
    ]
    await new RealModelGateway({ client: recording.client }).executeAttempt(baseRequest({ items }))
    const assistant = recording.requests[0]?.messages[1] as OpenAI.Chat.ChatCompletionAssistantMessageParam
    expect(assistant.tool_calls?.[0]).toEqual({ id: "c1", type: "function", function: { name: "glob", arguments: "{\"pattern\":\"**\"}" } })
  })

  test("orphan tool results fail before calling the client", async () => {
    const recording = new RecordingClient(readRecordingFixture("parallel-tool-calls"))
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(baseRequest({
      items: [
        { id: "prompt", turn: 0, type: "candidate_finding", isPinned: true, content: "Inspect." },
        { id: "orphan", turn: 1, type: "tool_result", isPinned: false, content: "orphan", toolMeta: { callId: "c9", toolName: "read_file" } },
      ],
    }))
    expect(recording.callCount).toBe(0)
    expect(response.finishReason).toBe("error")
    expect(response.error?.category).toBe("invalid_request")
  })

  test("stop with tool calls is mapped to a tool request", async () => {
    const fixture = readRecordingFixture("parallel-tool-calls") as OpenAI.Chat.ChatCompletion
    const recording = new RecordingClient({
      ...fixture,
      choices: fixture.choices.map((choice) => ({ ...choice, finish_reason: "stop" as const })),
    } as OpenAI.Chat.ChatCompletion)
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(
      baseRequest({ tools }),
    )
    expect(response.finishReason).toBe("tool_calls")
    expect(response.toolCalls).toHaveLength(2)
  })

  test("default and configured output token fields are sent", async () => {
    const defaultRecording = new RecordingClient(readRecordingFixture("content-filter"))
    await new RealModelGateway({ client: defaultRecording.client }).executeAttempt(
      baseRequest({ maxOutputTokens: 512 }),
    )
    expect(defaultRecording.requests[0]?.max_tokens).toBe(512)
    expect(defaultRecording.requests[0]?.max_completion_tokens).toBeUndefined()

    const configuredRecording = new RecordingClient(readRecordingFixture("content-filter"))
    await new RealModelGateway({
      client: configuredRecording.client,
      outputTokensField: "max_completion_tokens",
    }).executeAttempt(baseRequest({ maxOutputTokens: 512 }))
    expect(configuredRecording.requests[0]?.max_completion_tokens).toBe(512)
    expect(configuredRecording.requests[0]?.max_tokens).toBeUndefined()
  })

  test("unknown models are unpriced while configured prices are honored", async () => {
    const fixture = readRecordingFixture("parallel-tool-calls") as OpenAI.Chat.ChatCompletion
    const unpricedRecording = new RecordingClient(fixture)
    const unpriced = await new RealModelGateway({ client: unpricedRecording.client }).executeAttempt(
      baseRequest({ profileId: "proxy/custom-model" }),
    )
    expect(unpriced.usage).toMatchObject({
      promptTokens: 30,
      completionTokens: 18,
      totalTokens: 48,
      costUsd: 0,
      pricing: "unpriced",
    })

    const pricedRecording = new RecordingClient(fixture)
    const priced = await new RealModelGateway({
      client: pricedRecording.client,
      inputCostPerMTok: 2,
      outputCostPerMTok: 3,
    }).executeAttempt(baseRequest({ profileId: "proxy/custom-model" }))
    expect(priced.usage.pricing).toBe("priced")
    expect(priced.usage.costUsd).toBe(0.000114)
  })

  test("unknown finish reasons become invalid-provider-output errors", async () => {
    const fixture = readRecordingFixture("content-filter") as OpenAI.Chat.ChatCompletion
    const recording = new RecordingClient({
      ...fixture,
      choices: fixture.choices.map((choice) => ({ ...choice, finish_reason: null })),
    } as unknown as OpenAI.Chat.ChatCompletion)
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(baseRequest())
    expect(response.finishReason).toBe("error")
    expect(response.error).toMatchObject({
      category: "invalid_request",
      classification: "invalid_provider_output",
    })
  })

  test("an empty provider response (no choice, no usage) is a retryable error", async () => {
    const recording = new RecordingClient({ id: "chatcmpl-empty", object: "chat.completion", created: 0, model: "m", choices: [] } as unknown as OpenAI.Chat.ChatCompletion)
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(baseRequest())
    expect(response.finishReason).toBe("error")
    expect(response.error).toMatchObject({ category: "transport", isRetryable: true, classification: "invalid_provider_output" })
  })

  test("malformed_function_call is a non-retryable malformed_tool_call error, left to the runner to repair", async () => {
    const fixture = readRecordingFixture("content-filter") as OpenAI.Chat.ChatCompletion
    const recording = new RecordingClient({
      ...fixture,
      choices: fixture.choices.map((choice) => ({ ...choice, finish_reason: "malformed_function_call" })),
    } as unknown as OpenAI.Chat.ChatCompletion)
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(baseRequest())
    expect(response.finishReason).toBe("error")
    expect(response.error).toMatchObject({ category: "invalid_request", isRetryable: false, classification: "malformed_tool_call" })
  })

  test("missing provider usage is unpriced and price overrides must be paired", async () => {
    const fixture = readRecordingFixture("content-filter") as OpenAI.Chat.ChatCompletion
    const noUsageRecording = new RecordingClient({ ...fixture, usage: undefined } as OpenAI.Chat.ChatCompletion)
    const response = await new RealModelGateway({ client: noUsageRecording.client }).executeAttempt(baseRequest())
    expect(response.usage).toMatchObject({ promptTokens: 0, completionTokens: 0, totalTokens: 0, pricing: "unpriced" })
    expect(() => new RealModelGateway({ inputCostPerMTok: 2 })).toThrow(/must be configured together/)
  })

  test("full-tier argument sanitization redacts paths, credentials, and research markers", () => {
    const sanitized = sanitizeToolArguments(
      '{"path":"/home/alice/Vault.sol","credential":"Bearer explicit-secret"}\nGroundTruthLabel: hidden key sk-1234567890abcdef',
      ["explicit-secret"],
    )
    expect(sanitized).toContain("<absolute path redacted>")
    expect(sanitized).toContain("Bearer [REDACTED]")
    expect(sanitized).not.toContain("/home/alice")
    expect(sanitized).not.toContain("explicit-secret")
    expect(sanitized).not.toContain("GroundTruthLabel")
    expect(sanitized).not.toContain("sk-1234567890abcdef")
  })

  test("read-only tool validation happens before the network call", async () => {
    const recording = new RecordingClient(readRecordingFixture("parallel-tool-calls"))
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(baseRequest({
      tools: [{ name: "shell_exec", description: "execute", parameters: { type: "object" } }],
    }))
    expect(recording.callCount).toBe(0)
    expect(response.error?.category).toBe("invalid_request")
  })
})

describe("gateway outcome edge cases", () => {
  test("a failed attempt on a priced model costs zero and stays priced", async () => {
    const recording = new RecordingClient(readRecordingFixture("server-500"))
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(baseRequest())
    expect(response.finishReason).toBe("error")
    expect(response.usage).toMatchObject({ totalTokens: 0, costUsd: 0, pricing: "priced" })
  })

  test("a failed attempt on an unpriced model stays unpriced", async () => {
    const recording = new RecordingClient(readRecordingFixture("server-500"))
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(
      baseRequest({ profileId: "cx/gpt-6-luna" }),
    )
    expect(response.usage).toMatchObject({ costUsd: 0, pricing: "unpriced" })
  })

  test("a tool_calls finish without any tool call is invalid provider output", async () => {
    const completion = {
      id: "chatcmpl-empty-tools",
      object: "chat.completion",
      created: 0,
      model: "gpt-4o-mini",
      choices: [{ index: 0, finish_reason: "tool_calls", logprobs: null, message: { role: "assistant", content: null, refusal: null } }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    } as OpenAI.Chat.ChatCompletion
    const recording = new RecordingClient(completion)
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(baseRequest({ tools }))
    expect(response.finishReason).toBe("error")
    expect(response.toolCalls).toBeUndefined()
    expect(response.error).toMatchObject({ category: "invalid_request", classification: "invalid_provider_output" })
  })
})
