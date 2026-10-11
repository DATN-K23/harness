import type {
  ModelAttemptError,
  ModelAttemptRequest,
  ModelAttemptResponse,
  ModelGatewayPort,
  ModelToolCall,
  ModelUsage,
  SleepPort,
} from "@harness/protocol"

/** A response without an id: the gateway stamps `runId:stepIndex:attemptIndex` unless the entry names one. */
export type ScriptedModelEntry = Omit<ModelAttemptResponse, "attemptId"> & { attemptId?: string }

interface ResponseOptions {
  usage?: ModelUsage
  latencyMs?: number
  attemptId?: string
}

export const usageOf = (promptTokens: number, completionTokens: number, costUsd = 0): ModelUsage => ({
  promptTokens,
  completionTokens,
  totalTokens: promptTokens + completionTokens,
  costUsd,
})

export const textResponse = (content: string, options: ResponseOptions = {}): ScriptedModelEntry => ({
  finishReason: "stop",
  content,
  usage: options.usage ?? usageOf(0, 0),
  latencyMs: options.latencyMs ?? 0,
  attemptId: options.attemptId,
})

export const toolCallResponse = (toolCalls: ModelToolCall[], options: ResponseOptions = {}): ScriptedModelEntry => ({
  finishReason: "tool_calls",
  toolCalls,
  usage: options.usage ?? usageOf(0, 0),
  latencyMs: options.latencyMs ?? 0,
  attemptId: options.attemptId,
})

export const errorResponse = (error: ModelAttemptError, options: ResponseOptions = {}): ScriptedModelEntry => ({
  finishReason: "error",
  error,
  usage: options.usage ?? usageOf(0, 0),
  latencyMs: options.latencyMs ?? 0,
  attemptId: options.attemptId,
})

export interface ScriptedModelGatewayOptions {
  /** When given, each response first sleeps for its `latencyMs`, so a FakeSleep with a clock simulates provider time. */
  sleep?: SleepPort
}

/**
 * Plays a script of responses, one per `executeAttempt` call. Provider errors are scripted as responses with `error`
 * set; the gateway never throws for them, for an exhausted script or for an aborted signal.
 */
export class ScriptedModelGateway implements ModelGatewayPort {
  readonly calls: ModelAttemptRequest[] = []
  private readonly script: ScriptedModelEntry[]
  private cursor = 0

  constructor(
    script: readonly ScriptedModelEntry[],
    private readonly options: ScriptedModelGatewayOptions = {},
  ) {
    this.script = [...script]
  }

  get callCount() {
    return this.calls.length
  }

  get remaining() {
    return this.script.length - this.cursor
  }

  push(...entries: ScriptedModelEntry[]) {
    this.script.push(...entries)
  }

  async executeAttempt(request: ModelAttemptRequest, signal?: AbortSignal): Promise<ModelAttemptResponse> {
    this.calls.push(structuredClone(request))
    const attemptId = `${request.runId}:${request.stepIndex}:${request.attemptIndex}`
    if (signal?.aborted) return this.failure(attemptId, "transport", "attempt aborted before it started")

    const entry = this.script[this.cursor]
    if (entry === undefined)
      return this.failure(
        attemptId,
        "invalid_request",
        `ScriptedModelGateway script exhausted at call ${this.callCount}`,
      )
    this.cursor += 1

    if (this.options.sleep !== undefined) await this.options.sleep.sleep(entry.latencyMs, signal)
    if (signal?.aborted) return this.failure(attemptId, "transport", "attempt aborted in flight")
    return structuredClone({ ...entry, attemptId: entry.attemptId ?? attemptId })
  }

  private failure(attemptId: string, category: ModelAttemptError["category"], message: string): ModelAttemptResponse {
    return {
      attemptId,
      finishReason: "error",
      error: { isRetryable: false, category, message },
      usage: usageOf(0, 0),
      latencyMs: 0,
    }
  }
}
