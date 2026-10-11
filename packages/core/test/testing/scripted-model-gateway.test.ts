import { describe, expect, test } from "bun:test"
import type { ModelAttemptRequest, SleepPort } from "@harness/protocol"
import { FakeClock, FakeSleep } from "../../src/testing/deterministic"
import {
  ScriptedModelGateway,
  errorResponse,
  textResponse,
  toolCallResponse,
  usageOf,
} from "../../src/testing/scripted-model-gateway"

const request = (stepIndex = 1, attemptIndex = 0): ModelAttemptRequest => ({
  runId: "run-1",
  stepIndex,
  attemptIndex,
  profileId: "fake-profile",
  items: [{ id: "item-1", turn: 0, type: "system_prompt", isPinned: true, content: "judge" }],
})

describe("ScriptedModelGateway", () => {
  test("plays the script in order with usage and stamps a deterministic attempt id", async () => {
    const gateway = new ScriptedModelGateway([
      toolCallResponse([{ id: "c1", name: "read_file", arguments: { path: "a.sol" } }], {
        usage: usageOf(100, 20, 0.01),
      }),
      textResponse("done", { usage: usageOf(150, 30, 0.02), attemptId: "named" }),
    ])
    const first = await gateway.executeAttempt(request(1))
    const second = await gateway.executeAttempt(request(2))
    expect(first).toEqual({
      attemptId: "run-1:1:0",
      finishReason: "tool_calls",
      toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.sol" } }],
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, costUsd: 0.01 },
      latencyMs: 0,
    })
    expect(second.attemptId).toBe("named")
    expect(second.content).toBe("done")
    expect(second.usage.totalTokens).toBe(180)
  })

  test("counts calls and logs a copy of each request", async () => {
    const gateway = new ScriptedModelGateway([textResponse("a"), textResponse("b")])
    const sent = request(1)
    await gateway.executeAttempt(sent)
    sent.items[0].content = "mutated after the call"
    await gateway.executeAttempt(request(2, 1))
    expect(gateway.callCount).toBe(2)
    expect(gateway.calls.map((call) => [call.stepIndex, call.attemptIndex])).toEqual([
      [1, 0],
      [2, 1],
    ])
    expect(gateway.calls[0].items[0].content).toBe("judge")
  })

  test("scripted provider errors resolve as responses and never throw", async () => {
    const gateway = new ScriptedModelGateway([
      errorResponse({ isRetryable: true, category: "rate_limit", message: "slow down", statusCode: 429 }),
      errorResponse(
        { isRetryable: true, category: "transport", message: "timeout", isTimeout: true },
        { latencyMs: 30_000 },
      ),
      errorResponse({ isRetryable: false, category: "authentication", message: "bad key", statusCode: 401 }),
    ])
    const responses = await Promise.all([1, 2, 3].map((step) => gateway.executeAttempt(request(step))))
    expect(responses.map((response) => response.finishReason)).toEqual(["error", "error", "error"])
    expect(responses.map((response) => response.error?.category)).toEqual(["rate_limit", "transport", "authentication"])
    expect(responses[1].error?.isTimeout).toBe(true)
    expect(responses[1].latencyMs).toBe(30_000)
  })

  test("an exhausted script returns a structured error and still logs the call", async () => {
    const gateway = new ScriptedModelGateway([textResponse("only")])
    await gateway.executeAttempt(request(1))
    const extra = await gateway.executeAttempt(request(2))
    expect(extra.finishReason).toBe("error")
    expect(extra.error).toMatchObject({ isRetryable: false, category: "invalid_request" })
    expect(extra.error?.message).toContain("script exhausted at call 2")
    expect(gateway.callCount).toBe(2)
  })

  test("entries pushed later are played after the existing ones", async () => {
    const gateway = new ScriptedModelGateway([])
    gateway.push(textResponse("late"))
    expect(gateway.remaining).toBe(1)
    expect((await gateway.executeAttempt(request())).content).toBe("late")
    expect(gateway.remaining).toBe(0)
  })

  test("returned responses are copies of the script", async () => {
    const entry = toolCallResponse([{ id: "c1", name: "grep", arguments: { pattern: "x" } }])
    const gateway = new ScriptedModelGateway([entry])
    const response = await gateway.executeAttempt(request())
    const call = response.toolCalls?.[0]
    if (call) call.arguments.pattern = "changed"
    expect(entry.toolCalls?.[0].arguments).toEqual({ pattern: "x" })
  })

  test("latency is slept through the injected sleep, advancing the fake clock", async () => {
    const clock = new FakeClock(0)
    const sleep = new FakeSleep(clock)
    const gateway = new ScriptedModelGateway([textResponse("slow", { latencyMs: 1_500 })], { sleep })
    const response = await gateway.executeAttempt(request())
    expect(response.latencyMs).toBe(1_500)
    expect(sleep.calls).toEqual([1_500])
    expect(clock.nowMs()).toBe(1_500)
  })

  test("a signal already aborted returns an error response without consuming the script", async () => {
    const gateway = new ScriptedModelGateway([textResponse("kept")])
    const response = await gateway.executeAttempt(request(), AbortSignal.abort())
    expect(response.finishReason).toBe("error")
    expect(response.error).toMatchObject({ isRetryable: false, category: "transport" })
    expect(gateway.callCount).toBe(1)
    expect(gateway.remaining).toBe(1)
    expect((await gateway.executeAttempt(request())).content).toBe("kept")
  })

  test("a signal aborted during the latency wait returns an error response", async () => {
    const controller = new AbortController()
    const abortingSleep: SleepPort = {
      sleep: async () => {
        controller.abort()
      },
    }
    const gateway = new ScriptedModelGateway([textResponse("never seen", { latencyMs: 10 })], { sleep: abortingSleep })
    const response = await gateway.executeAttempt(request(), controller.signal)
    expect(response.finishReason).toBe("error")
    expect(response.content).toBeUndefined()
    expect(response.error?.message).toContain("in flight")
  })
})
