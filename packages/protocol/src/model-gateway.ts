import { z } from "zod"
import type { ContextItem } from "./context"
import type { ToolDefinition } from "./ports"

export const DisallowedToolPatterns = [
  /write/i,
  /delete/i,
  /remove/i,
  /shell/i,
  /exec/i,
  /bash/i,
  /terminal/i,
  /cmd/i,
  /network/i,
  /fetch/i,
  /http/i,
  /download/i,
  /upload/i,
  /spawn/i,
  /process/i,
] as const

/** Validates that an attempt's tool definitions contain only permitted read-only tools. */
export function validateAttemptRequestTools(tools?: readonly ToolDefinition[]): boolean {
  if (tools === undefined || tools.length === 0) return true
  for (const tool of tools) {
    if (DisallowedToolPatterns.some((pattern) => pattern.test(tool.name))) {
      throw new Error(
        `Tool "${tool.name}" violates read-only tool policy: non-read-only tools (write, shell, network, execution) are prohibited.`,
      )
    }
  }
  return true
}

export const ProviderErrorCategories = ["transport", "rate_limit", "authentication", "invalid_request"] as const

export type ProviderErrorCategory = (typeof ProviderErrorCategories)[number]

export const ProviderErrorCategorySchema = z.enum(ProviderErrorCategories)

export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
})

export type TokenUsage = z.infer<typeof TokenUsageSchema>

export const ModelPricingStatuses = ["priced", "unpriced"] as const

export type ModelPricingStatus = (typeof ModelPricingStatuses)[number]

export const ModelUsageSchema = TokenUsageSchema.extend({
  costUsd: z.number().nonnegative(),
  /** Absent means "priced": rows and events written before pricing existed were always priced. */
  pricing: z.enum(ModelPricingStatuses).optional(),
})

/** `pricing` is optional so older gateways and stored data stay valid; absent means "priced". */
export type ModelUsage = TokenUsage & { costUsd: number; pricing?: ModelPricingStatus }

export const FinishReasons = ["stop", "tool_calls", "length", "error"] as const

export type FinishReason = (typeof FinishReasons)[number]

export interface ModelAttemptRequest {
  runId: string
  stepIndex: number
  attemptIndex: number
  profileId: string
  items: ContextItem[]
  toolsDisabled?: boolean
  tools?: readonly ToolDefinition[]
  maxToolCalls?: number
  maxOutputTokens?: number
  temperature?: number
  seed?: number
}

export interface ModelToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  argumentsError?: string
  rawArguments?: string
}

export const ModelAttemptErrorClassifications = [
  "context_overflow",
  "content_filter",
  "invalid_provider_output",
] as const

export type ModelAttemptErrorClassification = (typeof ModelAttemptErrorClassifications)[number]

export interface ModelAttemptError {
  isRetryable: boolean
  category: ProviderErrorCategory
  message: string
  statusCode?: number
  isTimeout?: boolean
  /** The provider's Retry-After delay when it sent one; recorded on the attempt, never used to extend the wait. */
  retryAfterMs?: number
  classification?: ModelAttemptErrorClassification
}

export interface ModelAttemptResponse {
  attemptId: string
  finishReason: FinishReason
  content?: string
  toolCalls?: ModelToolCall[]
  usage: ModelUsage
  latencyMs: number
  error?: ModelAttemptError
}

export interface ModelGatewayPort {
  /** One call is exactly one provider attempt. Provider failures resolve with `error` set and never throw. */
  executeAttempt(request: ModelAttemptRequest, signal?: AbortSignal): Promise<ModelAttemptResponse>
}
