// Adapted from OpenCode packages/opencode/src/session/retry.ts and packages/llm/src/provider-error.ts @ 3f393d78bf
// (MIT License, Copyright (c) 2025 opencode). See NOTICE.
// Differences: plain async TypeScript instead of Effect, no SessionV1 types, the delay follows the TV1 formula with
// injected random and sleep (Retry-After is recorded, never used), the numeric status pattern is dropped because the
// status list is structural and configurable, and the context-overflow patterns return a classification, not a failure.
import type {
  CancellationPort,
  ClockPort,
  ModelAttemptError,
  ModelAttemptRequest,
  ModelAttemptResponse,
  ModelGatewayPort,
  ProviderErrorCategory,
  RandomPort,
  ResolvedFlags,
  RetryConfig,
  RetryDecisions,
  SleepPort,
  StopReason,
  TokenUsage,
} from "@harness/protocol"

const RETRYABLE_MESSAGE_PATTERNS = [
  /rate increased too quickly|rate limit|rate-limit|rate_limit|too many requests/i,
  /overloaded|service unavailable|service_unavailable|service-unavailable|internal error|internal_error|internal server error|server error|server_error|server-error|provider returned error|provider_returned_error|provider-returned-error/i,
  /terminated|fetch failed|failed to fetch|network[-_\s]error|upstream connect|connection error|connection refused|connection lost|socket connection was closed|socket hang up|reset before headers|getaddrinfo|enotfound|eai_again|econnrefused|econnreset|etimedout/i,
  /^timeout$|\b(?:request|response|connection|network|stream|read) (?:timeout|timed out|time out)\b/i,
  /try your request again|retry your request|resource exhausted|resource_exhausted/i,
  /\btry again (?:later|in\b)|\b(?:currently|temporarily) at capacity\b/i,
]

const CONTEXT_OVERFLOW_PATTERNS = [
  /prompt is too long/i,
  /request_too_large/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
  /input token count.*exceeds the maximum/i,
  /tokens in request more than max tokens allowed/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /request entity too large/i,
  /context length is only \d+ tokens/i,
  /input length.*exceeds.*context length/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /too large for model with \d+ maximum context length/i,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
  /model_context_window_exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
]

const CONTEXT_OVERFLOW_EXCLUSIONS = [/^(throttling error|service unavailable):/i, /rate limit/i, /too many requests/i]

export const isContextOverflow = (message: string) =>
  !CONTEXT_OVERFLOW_EXCLUSIONS.some((pattern) => pattern.test(message)) &&
  (CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message)) ||
    /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message))

export type ErrorClassification = "retryable" | "permanent" | "context_overflow"

export type RetryDecision = (typeof RetryDecisions)[number]

export const classifyError = (error: ModelAttemptError, config: RetryConfig): ErrorClassification => {
  if (isContextOverflow(error.message)) return "context_overflow"
  // Gemini's safety filter blocks the same request only some of the time, so a block is worth sending again.
  if (error.classification === "content_filter") return "retryable"
  if (error.category === "authentication" || error.category === "invalid_request") return "permanent"
  if (error.isTimeout) return "retryable"
  if (error.statusCode === undefined && error.category === "rate_limit") return "retryable"
  if (error.statusCode !== undefined)
    return config.retryableStatuses.includes(error.statusCode) ? "retryable" : "permanent"
  return error.isRetryable || RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(error.message))
    ? "retryable"
    : "permanent"
}

/** Delay before retry `n >= 1`: `min(max, base * 2^(n-1))` plus an integer jitter in `[0, jitterMs)`. */
export const retryDelayMs = (retryNumber: number, config: RetryConfig, random: RandomPort) =>
  Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** (retryNumber - 1)) + Math.floor(random.next() * config.jitterMs)

export interface AttemptRecord {
  /** 1-based within one logical model call. */
  attemptIndex: number
  usage: TokenUsage
  costUsd: number
  latencyMs: number
  errorCategory?: ProviderErrorCategory
  retryDecision: RetryDecision
  backoffMs: number
  retryAfterMs?: number
}

export type RetryFailureReason = "provider_retries_exhausted" | "provider_permanent" | "provider_transient_primary"

export type RetryOutcome =
  | { kind: "success"; response: ModelAttemptResponse; attempts: AttemptRecord[] }
  | { kind: "failed"; reason: RetryFailureReason; error: ModelAttemptError; attempts: AttemptRecord[] }
  /** The step reports `budget_exhausted` with reason `context_budget`. */
  | { kind: "context_overflow"; error: ModelAttemptError; attempts: AttemptRecord[] }
  /** A stop condition held before a retry: the deadline, or a reason returned by `beforeRetry`. */
  | { kind: "stopped"; reason: StopReason; error: ModelAttemptError; attempts: AttemptRecord[] }
  | { kind: "cancelled"; error: ModelAttemptError; attempts: AttemptRecord[] }

export interface RetryPolicyDeps {
  gateway: ModelGatewayPort
  cancellation: CancellationPort
  sleep: SleepPort
  random: RandomPort
  clock: ClockPort
  config: RetryConfig
  flags: Pick<ResolvedFlags, "enableInfraRetry">
}

export interface RetryRunInput {
  request: Omit<ModelAttemptRequest, "attemptIndex">
  /** Absolute wall-clock deadline of the run in clock milliseconds. */
  deadlineMs?: number
  signal?: AbortSignal
  /**
   * Called before every retry, after the backoff wait and the cancellation poll, with the attempt records so far.
   * Returning a stop reason ends the call as `stopped` without another attempt.
   */
  beforeRetry?: (attempts: readonly AttemptRecord[]) => StopReason | undefined | Promise<StopReason | undefined>
  /**
   * Awaited right after each attempt is recorded, before any backoff wait, so the caller can persist and charge it
   * even if a later attempt rejects or the worker stops while waiting.
   */
  onAttempt?: (attempt: AttemptRecord) => void | Promise<void>
}

export interface RetryPolicy {
  run(input: RetryRunInput): Promise<RetryOutcome>
}

export const createRetryPolicy = (deps: RetryPolicyDeps): RetryPolicy => {
  const { config } = deps

  const run = async (input: RetryRunInput): Promise<RetryOutcome> => {
    const attempts: AttemptRecord[] = []
    let retries = 0
    let timeoutRetries = 0
    const settle = async (attempt: AttemptRecord) => {
      attempts.push(attempt)
      await input.onAttempt?.(attempt)
    }

    while (true) {
      const attemptIndex = attempts.length + 1
      const response = await deps.gateway.executeAttempt({ ...input.request, attemptIndex }, input.signal)
      const record = (decision: RetryDecision, backoffMs: number, error?: ModelAttemptError): AttemptRecord => ({
        attemptIndex,
        usage: {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
        },
        costUsd: response.usage.costUsd,
        latencyMs: response.latencyMs,
        ...(error ? { errorCategory: error.category } : {}),
        retryDecision: decision,
        backoffMs,
        ...(error?.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
      })

      const error = response.error
      if (!error) {
        await settle(record("none", 0))
        return { kind: "success", response, attempts }
      }

      const classification = classifyError(error, config)
      if (classification === "context_overflow") {
        await settle(record("context_overflow", 0, error))
        return { kind: "context_overflow", error, attempts }
      }
      if (classification === "permanent") {
        await settle(record("permanent", 0, error))
        return { kind: "failed", reason: "provider_permanent", error, attempts }
      }
      if (!deps.flags.enableInfraRetry) {
        await settle(record("disabled", 0, error))
        return { kind: "failed", reason: "provider_transient_primary", error, attempts }
      }

      // Retry-After never extends the wait, but one that outlasts the run means no retry can succeed in time.
      const resetsAfterDeadline =
        error.retryAfterMs !== undefined && input.deadlineMs !== undefined && deps.clock.nowMs() + error.retryAfterMs >= input.deadlineMs
      const exhausted =
        resetsAfterDeadline ||
        retries >= config.maxRetries ||
        (error.isTimeout === true && timeoutRetries >= config.maxTimeoutRetries)
      if (exhausted) {
        await settle(record("exhausted", 0, error))
        return { kind: "failed", reason: "provider_retries_exhausted", error, attempts }
      }

      const backoffMs = retryDelayMs(retries + 1, config, deps.random)
      if (input.deadlineMs !== undefined && deps.clock.nowMs() + backoffMs >= input.deadlineMs) {
        await settle(record("none", 0, error))
        return { kind: "stopped", reason: "wall_clock_timeout", error, attempts }
      }

      await settle(record("retry", backoffMs, error))
      // An aborted or failed wait must not reject the call: the run decides from the cause what to commit.
      const slept = await deps.sleep.sleep(backoffMs, input.signal).then(
        () => true,
        () => false,
      )
      if (!slept || input.signal?.aborted) {
        const pastDeadline = input.deadlineMs !== undefined && deps.clock.nowMs() >= input.deadlineMs
        if (pastDeadline || input.signal?.reason === "wall_clock_timeout")
          return { kind: "stopped", reason: "wall_clock_timeout", error, attempts }
        return { kind: "cancelled", error, attempts }
      }
      if (await deps.cancellation.isRequested(input.request.runId, input.signal)) {
        return { kind: "cancelled", error, attempts }
      }
      const stop = await input.beforeRetry?.([...attempts])
      if (stop !== undefined) return { kind: "stopped", reason: stop, error, attempts }
      retries += 1
      if (error.isTimeout) timeoutRetries += 1
    }
  }

  return { run }
}
