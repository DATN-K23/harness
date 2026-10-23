// Adapted from OpenCode packages/llm/src/protocols/openai-chat.ts and packages/llm/src/protocols/shared.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ModelAttemptError, ModelToolCall, ModelUsage, TokenUsage } from "@harness/protocol"
import type OpenAI from "openai"
import { redactSecrets } from "../errors/provider-error"
import { priceUsage, type ModelPricingOverride } from "../pricing/model-pricing"

const SensitiveMarkerLine = /groundtruthlabel|adjudication_report|scoring/i
const RedactedPath = "<absolute path redacted>"

/** Full model-visible sanitization equivalent, kept local to avoid an @harness/core runtime dependency. */
export function sanitizeToolArguments(text: string, secrets: readonly string[] = []): string {
  const withoutSensitiveLines = text
    .split("\n")
    .filter((line) => !SensitiveMarkerLine.test(line))
    .join("\n")
  const withoutWindowsPaths = withoutSensitiveLines
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>|]+(?:[ \t]+[^\s"'<>|]*[\\/][^\s"'<>|]*)*/g, RedactedPath)
    .replace(/\\\\[^\\/\s]+(?:\\[^\\/\s]+)*(?:[ \t]+[^\\/\s]*\\[^\\/\s]*)*/g, RedactedPath)
  const withoutPosixPaths = withoutWindowsPaths.replace(
    /(^|[\s"'(])\/[^\s"'()<>{}\[\]]+(?:[ \t]+[^\s"'()<>{}\[\]]*\/[^\s"'()<>{}\[\]]*)*/gm,
    (_match, prefix: string) => prefix + RedactedPath,
  )
  return redactSecrets(withoutPosixPaths, secrets)
}

export interface MapChatCompletionOptions {
  model: string
  pricing?: ModelPricingOverride
  secrets?: readonly string[]
}

export interface MappedChatCompletion {
  content?: string
  toolCalls?: ModelToolCall[]
  finishReason: "stop" | "tool_calls" | "length" | "error"
  error?: ModelAttemptError
  usage: ModelUsage
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const parseToolArguments = (
  raw: string,
  secrets: readonly string[],
): Pick<ModelToolCall, "arguments" | "argumentsError" | "rawArguments"> => {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isObject(parsed)) {
      // Un-nest when a model passes { name: "...", arguments: { ... } } inside tool arguments
      if (typeof parsed.name === "string" && isObject(parsed.arguments)) {
        return { arguments: parsed.arguments as Record<string, unknown> }
      }
      return { arguments: parsed }
    }
    return {
      arguments: {},
      argumentsError: "Tool arguments must be a JSON object",
      rawArguments: sanitizeToolArguments(raw, secrets).slice(0, 2000),
    }
  } catch {
    return {
      arguments: {},
      argumentsError: "Tool arguments are not valid JSON",
      rawArguments: sanitizeToolArguments(raw, secrets).slice(0, 2000),
    }
  }
}

/**
 * A Gemini prompt block that an OpenAI-compatible router (e.g. 9router) passes through unchanged with HTTP 200: no
 * `choices`, only `response.promptFeedback.blockReason`. The prompt itself was refused before any output.
 */
const geminiPromptBlock = (completion: unknown) => {
  const response = (completion as { response?: { promptFeedback?: { blockReason?: unknown }; usageMetadata?: { promptTokenCount?: unknown } } }).response
  const reason = response?.promptFeedback?.blockReason
  if (typeof reason !== "string") return undefined
  const promptTokens = response?.usageMetadata?.promptTokenCount
  return { reason, promptTokens: typeof promptTokens === "number" && promptTokens >= 0 ? promptTokens : 0 }
}

export function mapChatCompletion(
  completion: OpenAI.Chat.ChatCompletion,
  options: MapChatCompletionOptions,
): MappedChatCompletion {
  const blocked = geminiPromptBlock(completion)
  if (blocked !== undefined) {
    const tokenUsage: TokenUsage = { promptTokens: blocked.promptTokens, completionTokens: 0, totalTokens: blocked.promptTokens }
    return {
      usage: { ...tokenUsage, ...priceUsage(options.model, tokenUsage, options.pricing) },
      finishReason: "error",
      error: {
        isRetryable: false,
        category: "invalid_request",
        classification: "content_filter",
        message: `The provider's safety filter blocked the prompt (blockReason ${blocked.reason.slice(0, 40)}).`,
      },
    }
  }
  const choice = completion.choices?.[0]
  const rawCalls = choice?.message?.tool_calls ?? []
  const rawReason = choice?.finish_reason
  const providerUsage = completion.usage
  const promptTokens = providerUsage?.prompt_tokens ?? 0
  const completionTokens = providerUsage?.completion_tokens ?? 0
  const tokenUsage: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens: providerUsage?.total_tokens ?? promptTokens + completionTokens,
  }
  const priced = priceUsage(options.model, providerUsage ? tokenUsage : undefined, options.pricing)
  const usage: ModelUsage = { ...tokenUsage, ...priced }
  const base = {
    usage,
    content: typeof choice?.message?.content === "string" ? choice.message.content : undefined,
  }

  if (rawReason === "length") return { ...base, finishReason: "length" }
  if (rawReason === "content_filter") {
    return {
      ...base,
      finishReason: "error",
      error: {
        isRetryable: false,
        category: "invalid_request",
        classification: "content_filter",
        message: "The provider filtered this response.",
      },
    }
  }
  const claimsToolCalls = rawReason === "tool_calls" || rawReason === "function_call"
  if (rawReason === "stop" || (claimsToolCalls && rawCalls.length > 0)) {
    const toolCalls =
      rawCalls.length === 0
        ? undefined
        : rawCalls.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.function.name,
            ...parseToolArguments(toolCall.function.arguments, options.secrets ?? []),
          }))
    return {
      ...base,
      finishReason: rawReason !== "stop" || toolCalls?.length ? "tool_calls" : "stop",
      ...(toolCalls ? { toolCalls } : {}),
    }
  }

  return {
    ...base,
    finishReason: "error",
    error: {
      isRetryable: false,
      category: "invalid_request",
      classification: "invalid_provider_output",
      message: "The provider returned a missing or unknown finish reason.",
    },
  }
}
