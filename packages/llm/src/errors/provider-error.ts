// Adapted from OpenCode packages/llm/src/provider-error.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ModelAttemptError, ProviderErrorCategory } from "@harness/protocol"

export const RedactedPlaceholder = "***"
export const RedactedSecretPlaceholder = "[REDACTED]"

const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Z0-9_]*PRIVATE_KEY[A-Z0-9_]*\s*[=:]\s*["']?[^\s"']+["']?/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{36}\b/g,
]

const CONNECTION_URL_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@\s]+):([^@\s]+)@/g

const contextOverflowPatterns = [
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

const contextOverflowExclusions = [/^(throttling error|service unavailable):/i, /rate limit/i, /too many requests/i]

export const isContextOverflow = (message: string) =>
  !contextOverflowExclusions.some((pattern) => pattern.test(message)) &&
  (contextOverflowPatterns.some((pattern) => pattern.test(message)) ||
    /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message))

/**
 * Redacts secrets, tokens, URL credentials, and explicit secret values from text.
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  if (!text) return text

  let result = text

  // 1. Scrub user credentials in database / protocol URLs
  result = result.replace(CONNECTION_URL_CREDENTIALS, (_match, protocol: string) => {
    return `${protocol}${RedactedPlaceholder}:${RedactedPlaceholder}@`
  })

  // 2. Scrub Bearer tokens
  result = result.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${RedactedSecretPlaceholder}`)

  // 3. Scrub explicit secrets
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      result = result.replaceAll(secret, RedactedSecretPlaceholder)
    }
  }

  // 4. Scrub known regex secret patterns
  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    result = result.replace(pattern, RedactedSecretPlaceholder)
  }

  return result
}

/**
 * Normalizes any provider or network error into a structured ModelAttemptError.
 * Guarantees zero secret leakage in error messages.
 */
export function normalizeProviderError(
  error: unknown,
  secrets: readonly string[] = [],
): ModelAttemptError {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error)

  const sanitizedMessage = redactSecrets(rawMessage, secrets)
  const errObj = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : undefined

  // Extract HTTP status code if present
  const responseObj =
    errObj?.response && typeof errObj.response === "object"
      ? (errObj.response as Record<string, unknown>)
      : undefined

  const statusCode: number | undefined =
    typeof errObj?.status === "number"
      ? errObj.status
      : typeof errObj?.statusCode === "number"
        ? errObj.statusCode
        : typeof responseObj?.status === "number"
          ? responseObj.status
          : undefined

  // Check timeout / abort conditions
  const isTimeout =
    errObj?.name === "TimeoutError" ||
    (errObj?.name === "AbortError" && /timeout|timed out/i.test(rawMessage)) ||
    errObj?.code === "ETIMEDOUT" ||
    errObj?.code === "ECONNTIMEDOUT" ||
    errObj?.isTimeout === true ||
    /timeout|timed out/i.test(rawMessage)

  // Extract retry-after header if present
  let retryAfterMs: number | undefined
  const rawHeaders = (errObj?.headers ?? responseObj?.headers) as
    | { get?: (name: string) => string | null; [key: string]: unknown }
    | undefined
  if (rawHeaders) {
    const rawHeader =
      typeof rawHeaders.get === "function"
        ? rawHeaders.get("retry-after")
        : (rawHeaders["retry-after"] as string | number | undefined)
    if (rawHeader !== undefined && rawHeader !== null) {
      const parsed = Number(rawHeader)
      if (!Number.isNaN(parsed) && parsed > 0) {
        retryAfterMs = Math.round(parsed * 1000)
      }
    }
  }

  let category: ProviderErrorCategory = "transport"
  let isRetryable = false

  if (statusCode !== undefined) {
    if (statusCode === 401 || statusCode === 403) {
      category = "authentication"
      isRetryable = false
    } else if (statusCode === 429) {
      category = "rate_limit"
      isRetryable = true
    } else if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
      category = "invalid_request"
      isRetryable = false
    } else if (statusCode >= 500 && statusCode < 600) {
      category = "transport"
      isRetryable = true
    } else if (statusCode >= 400 && statusCode < 500) {
      category = "invalid_request"
      isRetryable = false
    } else {
      category = "transport"
      isRetryable = true
    }
  } else if (isTimeout) {
    category = "transport"
    isRetryable = true
  } else if (
    errObj?.code === "ECONNRESET" ||
    errObj?.code === "ECONNREFUSED" ||
    errObj?.code === "ENOTFOUND" ||
    errObj?.name === "APIConnectionError" ||
    /econnreset|connection reset|fetch failed|network error/i.test(rawMessage)
  ) {
    category = "transport"
    isRetryable = true
  } else if (/rate limit|too many requests|quota/i.test(rawMessage)) {
    category = "rate_limit"
    isRetryable = true
  } else if (/unauthorized|forbidden|invalid api key|api_key/i.test(rawMessage)) {
    category = "authentication"
    isRetryable = false
  } else if (/invalid request|malformed|bad request/i.test(rawMessage)) {
    category = "invalid_request"
    isRetryable = false
  } else {
    category = "transport"
    isRetryable = false
  }

  return {
    isRetryable,
    category,
    message: sanitizedMessage,
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(isTimeout ? { isTimeout: true } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(statusCode !== undefined &&
    (statusCode === 400 || statusCode === 413) &&
    isContextOverflow(rawMessage)
      ? { classification: "context_overflow" as const }
      : {}),
  }
}
