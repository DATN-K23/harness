// Adapted from OpenCode packages/core/src/session/runner/llm.ts @ 3f393d78bf (MIT License). See NOTICE.
import {
  validateAttemptRequestTools,
  type ModelAttemptError,
  type ModelAttemptRequest,
  type ModelAttemptResponse,
  type ModelGatewayPort,
} from "@harness/protocol"
import OpenAI from "openai"
import { normalizeProviderError, redactSecrets } from "../errors/provider-error"
import { priceUsage, type ModelPricingOverride } from "../pricing/model-pricing"
import { convertToChatMessages, HistoryLoweringError } from "./message-converter"
import { mapChatCompletion } from "./response-mapping"
import { lowerToolOptions } from "./tool-lowering"

export interface RealModelGatewayOptions {
  apiKey?: string
  model?: string
  baseURL?: string
  timeoutMs?: number
  secrets?: string[]
  client?: OpenAI
  outputTokensField?: "max_tokens" | "max_completion_tokens"
  inputCostPerMTok?: number
  outputCostPerMTok?: number
}

/** Adapter for one non-streaming OpenAI Chat Completions attempt. */
export class RealModelGateway implements ModelGatewayPort {
  private readonly client: OpenAI
  private readonly timeoutMs: number
  private readonly secrets: string[]
  private readonly defaultModel: string
  private readonly outputTokensField: "max_tokens" | "max_completion_tokens"
  private readonly pricingOverride?: ModelPricingOverride

  constructor(options: RealModelGatewayOptions = {}) {
    const hasInputPrice = options.inputCostPerMTok !== undefined
    const hasOutputPrice = options.outputCostPerMTok !== undefined
    if (hasInputPrice !== hasOutputPrice) {
      throw new Error("inputCostPerMTok and outputCostPerMTok must be configured together.")
    }
    if (
      (hasInputPrice && (!Number.isFinite(options.inputCostPerMTok) || (options.inputCostPerMTok ?? -1) < 0)) ||
      (hasOutputPrice && (!Number.isFinite(options.outputCostPerMTok) || (options.outputCostPerMTok ?? -1) < 0))
    ) {
      throw new Error("Configured model prices must be finite, non-negative values.")
    }

    this.timeoutMs = options.timeoutMs ?? 30_000
    this.defaultModel = options.model ?? "gpt-4o-mini"
    this.outputTokensField = options.outputTokensField ?? "max_tokens"
    this.pricingOverride =
      hasInputPrice && hasOutputPrice
        ? {
            inputCostPerMTok: options.inputCostPerMTok!,
            outputCostPerMTok: options.outputCostPerMTok!,
          }
        : undefined
    this.secrets = [...(options.secrets ?? []), ...(options.apiKey ? [options.apiKey] : [])]
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        maxRetries: 0,
      })
  }

  /** Provider errors and invalid history resolve as typed data; this method never throws. */
  async executeAttempt(request: ModelAttemptRequest, signal?: AbortSignal): Promise<ModelAttemptResponse> {
    const startTime = performance.now()
    const attemptId = `${request.runId}:${request.stepIndex}:${request.attemptIndex}`
    // A failed attempt bills no tokens: it costs 0 and keeps the profile's pricing status, so one error
    // never turns a priced run into an unpriced one.
    const errorModel = request.profileId && request.profileId !== "mock-model" ? request.profileId : this.defaultModel
    const errorUsage = () => ({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      ...priceUsage(errorModel, { promptTokens: 0, completionTokens: 0 }, this.pricingOverride),
    })

    if (signal?.aborted) {
      return {
        attemptId,
        finishReason: "error",
        usage: errorUsage(),
        latencyMs: Math.round(performance.now() - startTime),
        error: normalizeProviderError(signal.reason ?? new Error("Attempt aborted before execution"), this.secrets),
      }
    }

    let messages: OpenAI.Chat.ChatCompletionMessageParam[]
    let toolOptions: ReturnType<typeof lowerToolOptions>
    try {
      validateAttemptRequestTools(request.tools)
      messages = convertToChatMessages(request.items)
      toolOptions = lowerToolOptions(request)
    } catch (error: unknown) {
      const message =
        error instanceof HistoryLoweringError
          ? error.message
          : error instanceof Error
            ? redactSecrets(error.message, this.secrets)
            : "Invalid attempt request."
      const invalidRequest: ModelAttemptError = {
        isRetryable: false,
        category: "invalid_request",
        message,
      }
      return {
        attemptId,
        finishReason: "error",
        usage: errorUsage(),
        latencyMs: Math.round(performance.now() - startTime),
        error: invalidRequest,
      }
    }

    const model =
      request.profileId && request.profileId !== "mock-model" ? request.profileId : this.defaultModel
    const outputLimit =
      request.maxOutputTokens === undefined
        ? {}
        : this.outputTokensField === "max_tokens"
          ? { max_tokens: request.maxOutputTokens }
          : { max_completion_tokens: request.maxOutputTokens }
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      ...toolOptions,
      ...outputLimit,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    }

    try {
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs)
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
      const completion = await this.client.chat.completions.create(params, { signal: combinedSignal })
      const mapped = mapChatCompletion(completion, {
        model,
        pricing: this.pricingOverride,
        secrets: this.secrets,
      })
      return {
        attemptId,
        finishReason: mapped.finishReason,
        ...(mapped.content !== undefined ? { content: redactSecrets(mapped.content, this.secrets) } : {}),
        ...(mapped.toolCalls !== undefined ? { toolCalls: mapped.toolCalls } : {}),
        usage: mapped.usage,
        latencyMs: Math.round(performance.now() - startTime),
        ...(mapped.error ? { error: mapped.error } : {}),
      }
    } catch (error: unknown) {
      return {
        attemptId,
        finishReason: "error",
        usage: errorUsage(),
        latencyMs: Math.round(performance.now() - startTime),
        error: normalizeProviderError(error, this.secrets),
      }
    }
  }
}
