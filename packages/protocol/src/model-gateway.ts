import { z } from "zod"
import type { ContextItem } from "./context"

export const ProviderErrorCategories = ["transport", "rate_limit", "authentication", "invalid_request"] as const

export type ProviderErrorCategory = (typeof ProviderErrorCategories)[number]

export const ProviderErrorCategorySchema = z.enum(ProviderErrorCategories)

export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
})

export type TokenUsage = z.infer<typeof TokenUsageSchema>

export const ModelUsageSchema = TokenUsageSchema.extend({ costUsd: z.number().nonnegative() })

export type ModelUsage = z.infer<typeof ModelUsageSchema>

export const FinishReasons = ["stop", "tool_calls", "length", "error"] as const

export type FinishReason = (typeof FinishReasons)[number]

export interface ModelAttemptRequest {
  runId: string
  stepIndex: number
  attemptIndex: number
  profileId: string
  items: ContextItem[]
  toolsDisabled?: boolean
  temperature?: number
  seed?: number
}

export interface ModelToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ModelAttemptError {
  isRetryable: boolean
  category: ProviderErrorCategory
  message: string
  statusCode?: number
  isTimeout?: boolean
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
