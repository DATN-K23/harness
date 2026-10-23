import { describe, expect, test } from "bun:test"
import {
  DefaultRetryConfig,
  type ModelAttemptError,
  type ModelAttemptRequest,
  type ModelAttemptResponse,
  type ModelGatewayPort,
  type RetryConfig,
  type StopReason,
} from "@harness/protocol"
import {
  classifyError,
  createRetryPolicy,
  isContextOverflow,
  retryDelayMs,
  type RetryOutcome,
} from "../../src/runner/retry-policy"

const usage = { promptTokens: 100, completionTokens: 20, totalTokens: 120, costUsd: 0.01 }

const success = (attemptId = "ok"): ModelAttemptResponse => ({
  attemptId,
  finishReason: "stop",
  content: "done",
  usage,
  latencyMs: 40,
})

const failure = (error: ModelAttemptError, attemptId = "err"): ModelAttemptResponse => ({
  attemptId,
  finishReason: "error",
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
  latencyMs: 15,
  error,
})

const categoryByStatus: Record<number, ModelAttemptError["category"]> = {
  400: "invalid_request",
  401: "authentication",
  429: "rate_limit",
}

const http = (statusCode: number, message = `HTTP ${statusCode}`): ModelAttemptError => ({
  isRetryable: false,
  category: categoryByStatus[statusCode] ?? "transport",
  message,
  statusCode,
})

const timeout: ModelAttemptError = {
  isRetryable: true,
  category: "transport",
  message: "request timed out",
  isTimeout: true,
}

class ScriptedGateway implements ModelGatewayPort {
  readonly requests: ModelAttemptRequest[] = []
  readonly signals: Array<AbortSignal | undefined> = []
  constructor(private readonly script: (callNumber: number) => ModelAttemptResponse) {}

  async executeAttempt(request: ModelAttemptRequest, signal?: AbortSignal) {
    this.requests.push(request)
    this.signals.push(signal)
    return this.script(this.requests.length)
  }
}

class FakeSleep {
  readonly waits: number[] = []
  constructor(private readonly onSleep: (ms: number) => void = () => {}) {}

  async sleep(ms: number) {
    this.waits.push(ms)
    this.onSleep(ms)
  }
}

class FakeCancellation {
  polls = 0
  requested = false
  async request() { this.requested = true; return { kind: "requested" as const } }
  async isRequested() {
    this.polls += 1
    return this.requested
  }
}

const fixedRandom = (value: number) => ({ next: () => value })

const baseRequest: Omit<ModelAttemptRequest, "attemptIndex"> = {
  runId: "run-1",
  stepIndex: 2,
  profileId: "profile-a",
  items: [],
}

interface Setup {
  gateway: ModelGatewayPort & { requests: ModelAttemptRequest[] }
  sleep?: FakeSleep
  cancellation?: FakeCancellation
  random?: number
  enableInfraRetry?: boolean
  config?: RetryConfig
  nowMs?: number
}

const setup = (options: Setup) => {
  const sleep = options.sleep ?? new FakeSleep()
  const cancellation = options.cancellation ?? new FakeCancellation()
  const policy = createRetryPolicy({
    gateway: options.gateway,
    cancellation,
    sleep,
    random: fixedRandom(options.random ?? 0),
    clock: { nowMs: () => options.nowMs ?? 0 },
    config: options.config ?? DefaultRetryConfig,
    flags: { enableInfraRetry: options.enableInfraRetry ?? true },
  })
  return { policy, sleep, cancellation }
}

const kinds = (outcome: RetryOutcome) => outcome.attempts.map((attempt) => attempt.retryDecision)

describe("classifyError", () => {
  test("a safety-filter block is retryable: Gemini blocks the same request only some of the time", () => {
    const blocked = { isRetryable: true, category: "invalid_request" as const, classification: "content_filter" as const, message: "blocked (blockReason OTHER)" }
    expect(classifyError(blocked, DefaultRetryConfig)).toBe("retryable")
  })

  test("HTTP 429 is retryable", () => {
    expect(classifyError(http(429), DefaultRetryConfig)).toBe("retryable")
  })

  test("HTTP 500 and 503 are retryable", () => {
    const classes = [500, 503].map((status) => classifyError(http(status), DefaultRetryConfig))
    expect(classes).toEqual(["retryable", "retryable"])
  })

  test("HTTP 401 is permanent", () => {
    expect(classifyError(http(401), DefaultRetryConfig)).toBe("permanent")
  })

  test("HTTP 400 and unsupported-feature errors are permanent", () => {
    const unsupported: ModelAttemptError = {
      isRetryable: false,
      category: "invalid_request",
      message: "tool calling is not supported by this model",
    }
    expect(classifyError(http(400), DefaultRetryConfig)).toBe("permanent")
    expect(classifyError(unsupported, DefaultRetryConfig)).toBe("permanent")
  })

  test("transport timeouts and disconnects are retryable", () => {
    const disconnect: ModelAttemptError = { isRetryable: true, category: "transport", message: "read ECONNRESET" }
    expect(classifyError(timeout, DefaultRetryConfig)).toBe("retryable")
    expect(classifyError(disconnect, DefaultRetryConfig)).toBe("retryable")
  })

  test("a transport error the gateway marks retryable is retryable even when no pattern matches", () => {
    const odd: ModelAttemptError = { isRetryable: true, category: "transport", message: "weird glitch" }
    expect(classifyError(odd, DefaultRetryConfig)).toBe("retryable")
  })

  test("a transport error with no status, no flag and no matching message is permanent", () => {
    const odd: ModelAttemptError = { isRetryable: false, category: "transport", message: "weird glitch" }
    expect(classifyError(odd, DefaultRetryConfig)).toBe("permanent")
  })

  test("retryable message patterns classify errors that carry no status", () => {
    const overloaded: ModelAttemptError = {
      isRetryable: false,
      category: "transport",
      message: "Provider is overloaded",
    }
    expect(classifyError(overloaded, DefaultRetryConfig)).toBe("retryable")
  })

  test("authentication and invalid-request categories stay permanent even if the message looks transient", () => {
    const lying: ModelAttemptError = { isRetryable: true, category: "authentication", message: "connection refused" }
    expect(classifyError(lying, DefaultRetryConfig)).toBe("permanent")
  })

  test("a rate_limit error without a status code is retryable even when the message matches no pattern", () => {
    const limited: ModelAttemptError = { isRetryable: false, category: "rate_limit", message: "slow down" }
    expect(classifyError(limited, DefaultRetryConfig)).toBe("retryable")
  })

  test("the retryable status list is configurable", () => {
    const config = { ...DefaultRetryConfig, retryableStatuses: [502] }
    expect(classifyError(http(502), config)).toBe("retryable")
    expect(classifyError(http(429), config)).toBe("permanent")
    expect(classifyError(http(503), config)).toBe("permanent")
  })

  test.each([
    "prompt is too long: 250000 tokens > 200000 maximum",
    "This model's maximum context length is 128000 tokens",
    "Your input exceeds the context window of this model",
    "context_length_exceeded",
    "Request Entity Too Large",
  ])("context overflow message %p is classified context_overflow", (message) => {
    const error: ModelAttemptError = { isRetryable: false, category: "invalid_request", message, statusCode: 400 }
    expect(classifyError(error, DefaultRetryConfig)).toBe("context_overflow")
  })

  test("context overflow wins over a retryable status", () => {
    const error: ModelAttemptError = {
      isRetryable: true,
      category: "transport",
      message: "exceeds the context window",
      statusCode: 503,
    }
    expect(classifyError(error, DefaultRetryConfig)).toBe("context_overflow")
  })

  test("rate-limit wording that mentions tokens is not context overflow", () => {
    const error = http(429, "Rate limit reached: too many tokens per minute")
    expect(isContextOverflow(error.message)).toBe(false)
    expect(classifyError(error, DefaultRetryConfig)).toBe("retryable")
    expect(isContextOverflow("Throttling error: too many tokens")).toBe(false)
  })
})

describe("retryDelayMs", () => {
  test("is 2000, 4000, 8000, 10000, 10000 for retries 1 to 5 when random returns 0", () => {
    const delays = [1, 2, 3, 4, 5].map((retry) => retryDelayMs(retry, DefaultRetryConfig, fixedRandom(0)))
    expect(delays).toEqual([2000, 4000, 8000, 10000, 10000])
  })

  test("adds an integer jitter in [0, 1000)", () => {
    const samples = [0, 0.001, 0.25, 0.5, 0.7501, 0.999, 0.9999999].map((value) =>
      retryDelayMs(1, DefaultRetryConfig, fixedRandom(value)),
    )
    expect(samples.every((delay) => Number.isInteger(delay) && delay >= 2000 && delay < 3000)).toBe(true)
    expect(samples[samples.length - 1]).toBe(2999)
    expect(new Set(samples).size).toBeGreaterThan(3)
  })

  test("jitter is added on top of the capped delay", () => {
    expect(retryDelayMs(5, DefaultRetryConfig, fixedRandom(0.5))).toBe(10500)
  })

  test("uses the configured base, cap and jitter", () => {
    const config = { ...DefaultRetryConfig, baseDelayMs: 100, maxDelayMs: 350, jitterMs: 10 }
    expect([1, 2, 3, 4].map((retry) => retryDelayMs(retry, config, fixedRandom(0.99)))).toEqual([109, 209, 359, 359])
  })
})

describe("RetryPolicy.run", () => {
  test("returns a first-attempt success without sleeping", async () => {
    const gateway = new ScriptedGateway(() => success())
    const { policy, sleep } = setup({ gateway })
    const outcome = await policy.run({ request: baseRequest })
    expect(outcome.kind).toBe("success")
    expect(sleep.waits).toEqual([])
    expect(outcome.attempts).toEqual([
      {
        attemptIndex: 1,
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        costUsd: 0.01,
        latencyMs: 40,
        retryDecision: "none",
        backoffMs: 0,
      },
    ])
  })

  test("sends the request with a 1-based attemptIndex and forwards the signal", async () => {
    const gateway = new ScriptedGateway((call) => (call < 3 ? failure(http(429)) : success()))
    const controller = new AbortController()
    const { policy } = setup({ gateway })
    await policy.run({ request: { ...baseRequest, toolsDisabled: true }, signal: controller.signal })
    expect(gateway.requests.map((request) => request.attemptIndex)).toEqual([1, 2, 3])
    expect(gateway.requests.every((request) => request.toolsDisabled === true && request.runId === "run-1")).toBe(true)
    expect(gateway.signals.every((signal) => signal === controller.signal)).toBe(true)
  })

  test("two 429 failures then success yields three attempt records with backoff on the first two", async () => {
    const gateway = new ScriptedGateway((call) => (call < 3 ? failure(http(429)) : success()))
    const { policy, sleep } = setup({ gateway })
    const outcome = await policy.run({ request: baseRequest })
    expect(outcome.kind).toBe("success")
    expect(outcome.attempts.map((attempt) => attempt.attemptIndex)).toEqual([1, 2, 3])
    expect(outcome.attempts.map((attempt) => attempt.backoffMs)).toEqual([2000, 4000, 0])
    expect(kinds(outcome)).toEqual(["retry", "retry", "none"])
    expect(outcome.attempts.map((attempt) => attempt.errorCategory)).toEqual(["rate_limit", "rate_limit", undefined])
    expect(sleep.waits).toEqual([2000, 4000])
  })

  test("failed attempts that returned usage keep it on their record", async () => {
    const billed: ModelAttemptResponse = {
      ...failure(http(503)),
      usage: { promptTokens: 7, completionTokens: 0, totalTokens: 7, costUsd: 0.002 },
    }
    const gateway = new ScriptedGateway((call) => (call === 1 ? billed : success()))
    const { policy } = setup({ gateway })
    const outcome = await policy.run({ request: baseRequest })
    expect(outcome.attempts[0]).toMatchObject({
      usage: { promptTokens: 7, completionTokens: 0, totalTokens: 7 },
      costUsd: 0.002,
      latencyMs: 15,
    })
  })

  test("a gateway that returns HTTP 503 every time stops after exactly 6 attempts", async () => {
    const gateway = new ScriptedGateway(() => failure(http(503)))
    const { policy, sleep } = setup({ gateway })
    const outcome = await policy.run({ request: baseRequest })
    expect(outcome).toMatchObject({ kind: "failed", reason: "provider_retries_exhausted" })
    expect(outcome.attempts).toHaveLength(6)
    expect(sleep.waits).toEqual([2000, 4000, 8000, 10000, 10000])
    expect(kinds(outcome)).toEqual(["retry", "retry", "retry", "retry", "retry", "exhausted"])
  })

  test("returns the last error as the terminal provider failure", async () => {
    const gateway = new ScriptedGateway((call) => failure(http(503, `boom ${call}`)))
    const { policy } = setup({ gateway })
    const outcome = await policy.run({ request: baseRequest })
    expect(outcome.kind === "failed" && outcome.error.message).toBe("boom 6")
  })

  test("a gateway that times out every time stops after exactly 4 attempts", async () => {
    const gateway = new ScriptedGateway(() => failure(timeout))
    const { policy, sleep } = setup({ gateway })
    const outcome = await policy.run({ request: baseRequest })
    expect(outcome).toMatchObject({ kind: "failed", reason: "provider_retries_exhausted" })
    expect(outcome.attempts).toHaveLength(4)
    expect(sleep.waits).toEqual([2000, 4000, 8000])
  })

  test("the timeout limit counts timeouts only while the general limit counts every retry", async () => {
    const gateway = new ScriptedGateway((call) => failure(call <= 2 ? http(503) : timeout))
    const { policy, sleep } = setup({ gateway })
    const outcome = await policy.run({ request: baseRequest })
    expect(outcome).toMatchObject({ kind: "failed", reason: "provider_retries_exhausted" })
    expect(outcome.attempts).toHaveLength(6)
    expect(sleep.waits).toEqual([2000, 4000, 8000, 10000, 10000])
  })

  test("the general limit also bounds timeouts when it is the smaller one", async () => {
    const gateway = new ScriptedGateway(() => failure(timeout))
    const config = { ...DefaultRetryConfig, maxRetries: 1 }
    const { policy } = setup({ gateway, config })
    const outcome = await policy.run({ request: baseRequest })
    expect(outcome.attempts).toHaveLength(2)
  })

  test("permanent errors are never retried", async () => {
    const gateway = new ScriptedGateway(() => failure(http(401)))
    const { policy, sleep } = setup({ gateway })
    const outcome = await policy.run({ request: baseRequest })
    expect(outcome).toMatchObject({ kind: "failed", reason: "provider_permanent" })
    expect(outcome.attempts).toHaveLength(1)
    expect(kinds(outcome)).toEqual(["permanent"])
    expect(sleep.waits).toEqual([])
  })

  test("context overflow is reported once and never retried", async () => {
    const overflow: ModelAttemptError = {
      isRetryable: true,
      category: "invalid_request",
      message: "prompt is too long",
      statusCode: 400,
    }
    const gateway = new ScriptedGateway(() => failure(overflow))
    const { policy, sleep } = setup({ gateway })
    const outcome = await policy.run({ request: baseRequest })
    expect(outcome.kind).toBe("context_overflow")
    expect(outcome.attempts).toHaveLength(1)
    expect(kinds(outcome)).toEqual(["context_overflow"])
    expect(sleep.waits).toEqual([])
  })

  test("jitter from the injected random source is added to every wait", async () => {
    const gateway = new ScriptedGateway((call) => (call < 3 ? failure(http(503)) : success()))
    const { policy, sleep } = setup({ gateway, random: 0.5 })
    await policy.run({ request: baseRequest })
    expect(sleep.waits).toEqual([2500, 4500])
  })

  test("Retry-After is recorded on the attempt but never extends the wait", async () => {
    const limited = { ...http(429), retryAfterMs: 60_000 }
    const gateway = new ScriptedGateway((call) => (call === 1 ? failure(limited) : success()))
    const { policy, sleep } = setup({ gateway })
    const outcome = await policy.run({ request: baseRequest })
    expect(sleep.waits).toEqual([2000])
    expect(outcome.attempts[0]).toMatchObject({ retryAfterMs: 60_000, backoffMs: 2000 })
    expect(outcome.attempts[1]?.retryAfterMs).toBeUndefined()
  })

  test("a Retry-After past the deadline ends the call after one attempt instead of retrying", async () => {
    const quota = { ...http(503, "[429]: The usage limit has been reached (reset after 29m 25s)"), category: "rate_limit" as const, retryAfterMs: 1_765_000 }
    const gateway = new ScriptedGateway(() => failure(quota))
    const { policy, sleep } = setup({ gateway })
    const outcome = await policy.run({ request: baseRequest, deadlineMs: 180_000 })
    expect(outcome).toMatchObject({ kind: "failed", reason: "provider_retries_exhausted" })
    expect(gateway.requests).toHaveLength(1)
    expect(kinds(outcome)).toEqual(["exhausted"])
    expect(sleep.waits).toEqual([])
  })

  describe("enableInfraRetry", () => {
    test("off: the first provider error is terminal with exactly one attempt", async () => {
      const gateway = new ScriptedGateway(() => failure(http(503)))
      const { policy, sleep } = setup({ gateway, enableInfraRetry: false })
      const outcome = await policy.run({ request: baseRequest })
      expect(outcome).toMatchObject({ kind: "failed", reason: "provider_transient_primary" })
      expect(gateway.requests).toHaveLength(1)
      expect(kinds(outcome)).toEqual(["disabled"])
      expect(outcome.attempts[0]?.backoffMs).toBe(0)
      expect(sleep.waits).toEqual([])
    })

    test("off: a permanent error is still reported as provider_permanent", async () => {
      const gateway = new ScriptedGateway(() => failure(http(401)))
      const { policy } = setup({ gateway, enableInfraRetry: false })
      const outcome = await policy.run({ request: baseRequest })
      expect(outcome).toMatchObject({ kind: "failed", reason: "provider_permanent" })
    })

    test("off: context overflow is still classified context_overflow", async () => {
      const overflow: ModelAttemptError = {
        isRetryable: false,
        category: "invalid_request",
        message: "context_length_exceeded",
      }
      const gateway = new ScriptedGateway(() => failure(overflow))
      const { policy } = setup({ gateway, enableInfraRetry: false })
      expect((await policy.run({ request: baseRequest })).kind).toBe("context_overflow")
    })

    test("off: success on the first attempt is unaffected", async () => {
      const gateway = new ScriptedGateway(() => success())
      const { policy } = setup({ gateway, enableInfraRetry: false })
      expect((await policy.run({ request: baseRequest })).kind).toBe("success")
    })

    test("on: the same single 503 is retried and the call succeeds", async () => {
      const gateway = new ScriptedGateway((call) => (call === 1 ? failure(http(503)) : success()))
      const { policy } = setup({ gateway, enableInfraRetry: true })
      const outcome = await policy.run({ request: baseRequest })
      expect(outcome.kind).toBe("success")
      expect(gateway.requests).toHaveLength(2)
    })
  })

  describe("wall-clock deadline", () => {
    test("stops with wall_clock_timeout instead of starting an attempt after the deadline", async () => {
      const gateway = new ScriptedGateway(() => failure(http(503)))
      const { policy, sleep } = setup({ gateway, nowMs: 1_000 })
      const outcome = await policy.run({ request: baseRequest, deadlineMs: 2_500 })
      expect(outcome).toMatchObject({ kind: "stopped", reason: "wall_clock_timeout" })
      expect(gateway.requests).toHaveLength(1)
      expect(sleep.waits).toEqual([])
      expect(kinds(outcome)).toEqual(["none"])
      expect(outcome.attempts[0]?.backoffMs).toBe(0)
    })

    test("waits when the next attempt starts before the deadline", async () => {
      const gateway = new ScriptedGateway((call) => (call === 1 ? failure(http(503)) : success()))
      const { policy, sleep } = setup({ gateway, nowMs: 1_000 })
      const outcome = await policy.run({ request: baseRequest, deadlineMs: 3_001 })
      expect(outcome.kind).toBe("success")
      expect(sleep.waits).toEqual([2000])
    })

    test("a retry that would start exactly at the deadline is not made", async () => {
      const gateway = new ScriptedGateway(() => failure(http(503)))
      const { policy } = setup({ gateway, nowMs: 1_000 })
      const outcome = await policy.run({ request: baseRequest, deadlineMs: 3_000 })
      expect(outcome.kind).toBe("stopped")
    })

    test("the jitter is part of the wait that is compared with the deadline", async () => {
      const gateway = new ScriptedGateway(() => failure(http(503)))
      const { policy } = setup({ gateway, nowMs: 0, random: 0.5 })
      const outcome = await policy.run({ request: baseRequest, deadlineMs: 2_500 })
      expect(outcome.kind).toBe("stopped")
    })
  })

  describe("cancellation", () => {
    test("a cancel requested during the wait prevents the next attempt", async () => {
      const cancellation = new FakeCancellation()
      const sleep = new FakeSleep(() => {
        cancellation.requested = true
      })
      const gateway = new ScriptedGateway(() => failure(http(429)))
      const { policy } = setup({ gateway, sleep, cancellation })
      const outcome = await policy.run({ request: baseRequest })
      expect(outcome.kind).toBe("cancelled")
      expect(gateway.requests).toHaveLength(1)
      expect(sleep.waits).toEqual([2000])
      expect(kinds(outcome)).toEqual(["retry"])
    })

    test("the cancellation port is observed once before each retry", async () => {
      const gateway = new ScriptedGateway((call) => (call < 4 ? failure(http(429)) : success()))
      const { policy, cancellation } = setup({ gateway })
      const outcome = await policy.run({ request: baseRequest })
      expect(outcome.kind).toBe("success")
      expect(cancellation.polls).toBe(3)
    })

    test("a successful first attempt does not poll cancellation", async () => {
      const gateway = new ScriptedGateway(() => success())
      const { policy, cancellation } = setup({ gateway })
      await policy.run({ request: baseRequest })
      expect(cancellation.polls).toBe(0)
    })

    test("a terminal failure does not poll cancellation", async () => {
      const gateway = new ScriptedGateway(() => failure(http(401)))
      const { policy, cancellation } = setup({ gateway })
      await policy.run({ request: baseRequest })
      expect(cancellation.polls).toBe(0)
    })
  })

  describe("sleep abort guard", () => {
    const rejectingSleep = (onSleep: () => void = () => {}) => ({
      waits: [] as number[],
      async sleep(ms: number) {
        this.waits.push(ms)
        onSleep()
        throw new Error("sleep aborted")
      },
    })

    test("a sleep that rejects ends the call as cancelled instead of rejecting", async () => {
      const gateway = new ScriptedGateway(() => failure(http(429)))
      const sleep = rejectingSleep()
      const policy = createRetryPolicy({
        gateway,
        cancellation: new FakeCancellation(),
        sleep,
        random: fixedRandom(0),
        clock: { nowMs: () => 0 },
        config: DefaultRetryConfig,
        flags: { enableInfraRetry: true },
      })
      const outcome = await policy.run({ request: baseRequest, deadlineMs: 100_000 })
      expect(outcome.kind).toBe("cancelled")
      expect(gateway.requests).toHaveLength(1)
      expect(kinds(outcome)).toEqual(["retry"])
    })

    test("a sleep that rejects after the deadline passed ends the call as stopped with wall_clock_timeout", async () => {
      let now = 0
      const gateway = new ScriptedGateway(() => failure(http(429)))
      const policy = createRetryPolicy({
        gateway,
        cancellation: new FakeCancellation(),
        sleep: rejectingSleep(() => {
          now = 10_000
        }),
        random: fixedRandom(0),
        clock: { nowMs: () => now },
        config: DefaultRetryConfig,
        flags: { enableInfraRetry: true },
      })
      const outcome = await policy.run({ request: baseRequest, deadlineMs: 5_000 })
      expect(outcome).toMatchObject({ kind: "stopped", reason: "wall_clock_timeout" })
      expect(gateway.requests).toHaveLength(1)
    })

    test("a signal aborted with wall_clock_timeout during the wait ends the call as stopped", async () => {
      const controller = new AbortController()
      const gateway = new ScriptedGateway(() => failure(http(429)))
      const sleep = new FakeSleep(() => controller.abort("wall_clock_timeout"))
      const { policy } = setup({ gateway, sleep })
      const outcome = await policy.run({ request: baseRequest, signal: controller.signal })
      expect(outcome).toMatchObject({ kind: "stopped", reason: "wall_clock_timeout" })
      expect(gateway.requests).toHaveLength(1)
    })

    test("a signal aborted for any other cause during the wait ends the call as cancelled", async () => {
      const controller = new AbortController()
      const gateway = new ScriptedGateway(() => failure(http(429)))
      const sleep = new FakeSleep(() => controller.abort("cancelled"))
      const { policy } = setup({ gateway, sleep })
      const outcome = await policy.run({ request: baseRequest, signal: controller.signal })
      expect(outcome.kind).toBe("cancelled")
      expect(gateway.requests).toHaveLength(1)
    })
  })

  describe("beforeRetry hook", () => {
    test("is called before every retry with the attempt records so far, after the wait", async () => {
      const gateway = new ScriptedGateway((call) => (call < 3 ? failure(http(503)) : success()))
      const { policy, sleep } = setup({ gateway })
      const seen: Array<{ attempts: number[]; waits: number }> = []
      const outcome = await policy.run({
        request: baseRequest,
        beforeRetry: (attempts) => {
          seen.push({ attempts: attempts.map((attempt) => attempt.attemptIndex), waits: sleep.waits.length })
          return undefined
        },
      })
      expect(outcome.kind).toBe("success")
      expect(seen).toEqual([
        { attempts: [1], waits: 1 },
        { attempts: [1, 2], waits: 2 },
      ])
    })

    test("a returned token stop reason ends the call as stopped without another attempt", async () => {
      const gateway = new ScriptedGateway(() => failure(http(503)))
      const { policy } = setup({ gateway })
      const outcome = await policy.run({ request: baseRequest, beforeRetry: () => "total_tokens_exhausted" })
      expect(outcome).toMatchObject({ kind: "stopped", reason: "total_tokens_exhausted" })
      expect(gateway.requests).toHaveLength(1)
      expect(outcome.attempts).toHaveLength(1)
    })

    test("may be async and is not called when the first attempt succeeds", async () => {
      const gateway = new ScriptedGateway(() => success())
      const { policy } = setup({ gateway })
      let calls = 0
      const outcome = await policy.run({
        request: baseRequest,
        beforeRetry: async (): Promise<StopReason> => {
          calls += 1
          return "total_tokens_exhausted"
        },
      })
      expect(outcome.kind).toBe("success")
      expect(calls).toBe(0)
    })

    test("a cancel observed after the wait wins over the hook", async () => {
      const cancellation = new FakeCancellation()
      const sleep = new FakeSleep(() => {
        cancellation.requested = true
      })
      const gateway = new ScriptedGateway(() => failure(http(429)))
      const { policy } = setup({ gateway, sleep, cancellation })
      let calls = 0
      const outcome = await policy.run({
        request: baseRequest,
        beforeRetry: () => {
          calls += 1
          return "total_tokens_exhausted"
        },
      })
      expect(outcome.kind).toBe("cancelled")
      expect(calls).toBe(0)
    })
  })
})
