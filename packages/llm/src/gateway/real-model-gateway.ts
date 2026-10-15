// Adapted from OpenCode packages/core/src/session/runner/llm.ts @ 3f393d78bf (MIT License). See NOTICE.
import type {
  FinishReason,
  ModelAttemptRequest,
  ModelAttemptResponse,
  ModelGatewayPort,
  ModelToolCall,
} from "@harness/protocol"
import OpenAI from "openai"
import { normalizeProviderError, redactSecrets } from "../errors/provider-error"
import { calculateModelCost } from "../pricing/model-pricing"
import { convertToChatMessages } from "./message-converter"

export interface RealModelGatewayOptions {
  apiKey?: string
  model?: string
  baseURL?: string
  timeoutMs?: number
  secrets?: string[]
  client?: OpenAI
}

/**
 * Adapter implementing ModelGatewayPort that executes single-attempt calls
 * via OpenAI SDK with zero internal retries and strictly controlled timeouts.
 */
export class RealModelGateway implements ModelGatewayPort {
  private readonly client: OpenAI
  private readonly timeoutMs: number
  private readonly secrets: string[]
  private readonly defaultModel: string

  constructor(private readonly options: RealModelGatewayOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.defaultModel = options.model ?? "gpt-4o-mini"
    this.secrets = [
      ...(options.secrets ?? []),
      ...(options.apiKey ? [options.apiKey] : []),
    ]

    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        maxRetries: 0,
      })
  }

  /**
   * Executes a single model attempt.
   * NEVER rejects or throws; failures are captured and returned in ModelAttemptResponse with finishReason: "error".
   */
  async executeAttempt(
    request: ModelAttemptRequest,
    signal?: AbortSignal,
  ): Promise<ModelAttemptResponse> {
    const startTime = performance.now()
    const attemptId = `${request.runId}:${request.stepIndex}:${request.attemptIndex}`

    // Fail-fast if signal already cancelled
    if (signal?.aborted) {
      const latencyMs = Math.round(performance.now() - startTime)
      return {
        attemptId,
        finishReason: "error",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
        latencyMs,
        error: normalizeProviderError(
          signal.reason ?? new Error("Attempt aborted before execution"),
          this.secrets,
        ),
      }
    }

    try {
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs)
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

      const messages = convertToChatMessages(request.items)
      const model =
        request.profileId && request.profileId !== "mock-model"
          ? request.profileId
          : this.defaultModel

      const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
      }

      const completion = await this.client.chat.completions.create(params, {
        signal: combinedSignal,
      })

      const latencyMs = Math.round(performance.now() - startTime)
      const choice = completion.choices[0]

      const promptTokens = completion.usage?.prompt_tokens ?? 0
      const completionTokens = completion.usage?.completion_tokens ?? 0
      const totalTokens = completion.usage?.total_tokens ?? promptTokens + completionTokens
      const costUsd = calculateModelCost(model, { promptTokens, completionTokens })

      const toolCalls: ModelToolCall[] | undefined = choice?.message?.tool_calls?.map((tc) => {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(tc.function.arguments || "{}")
        } catch {
          args = { raw: tc.function.arguments }
        }
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        }
      })

      let finishReason: FinishReason = "stop"
      if (choice?.finish_reason === "tool_calls" || (toolCalls && toolCalls.length > 0)) {
        finishReason = "tool_calls"
      } else if (choice?.finish_reason === "length") {
        finishReason = "length"
      } else {
        finishReason = "stop"
      }

      const rawContent = choice?.message?.content
      const content =
        rawContent !== null && rawContent !== undefined
          ? redactSecrets(rawContent, this.secrets)
          : undefined

      return {
        attemptId,
        finishReason,
        content,
        toolCalls,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          costUsd,
        },
        latencyMs,
      }
    } catch (error: unknown) {
      const latencyMs = Math.round(performance.now() - startTime)
      const normalizedError = normalizeProviderError(error, this.secrets)

      return {
        attemptId,
        finishReason: "error",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
        latencyMs,
        error: normalizedError,
      }
    }
  }
}
