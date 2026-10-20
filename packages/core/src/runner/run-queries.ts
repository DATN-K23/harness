// Adapted from OpenCode packages/cli/src/commands/view.ts @ 3f393d78bf (MIT License, Copyright (c) 2025 opencode). See NOTICE.
import type {
  BudgetLimits,
  BudgetTerminalReason,
  ModelPricingStatus,
  RunRecord,
  RunStorePort,
  ToolLimits,
  TrajectoryEvent,
} from "@harness/protocol"

/** Retrieves a run record by runId from persistent store. */
export async function getRun(runId: string, store: RunStorePort): Promise<RunRecord | null> {
  const run = await store.loadRun(runId)
  return run ?? null
}

/** Retrieves trajectory events for a run ordered strictly ascending by sequence number. */
export async function getRunHistory(runId: string, store: RunStorePort): Promise<TrajectoryEvent[]> {
  const events = await store.loadEvents({ runId })
  return [...events].sort((a, b) => a.sequence - b.sequence)
}

export interface ReconstructedToolCall {
  stepIndex: number
  callIndex: number
  callId: string
  toolName: string
  arguments: Record<string, unknown>
  status: "completed" | "failed" | "requested"
  durationMs?: number
  isTruncated?: boolean
  message?: string
  resultContent?: string
}

export interface MultiTurnStepSummary {
  stepIndex: number
  attemptNumber: number
  model: string
  finishReason: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number | null
  pricing: ModelPricingStatus
  latencyMs: number
  errorCategory?: string
}

export interface MultiTurnExecutionSummary {
  runId: string
  state: string
  prompt?: string
  snapshotId?: string
  terminalReason?: string
  limits?: BudgetLimits
  toolLimits?: ToolLimits
  observedLimits?: BudgetTerminalReason[]
  outputTruncated?: boolean
  toolCalls: ReconstructedToolCall[]
  steps: MultiTurnStepSummary[]
  attempts: Record<string, unknown>[]
  events: TrajectoryEvent[]
  contextTelemetry: ContextTelemetrySummary[]
}

export interface ContextTelemetrySummary {
  stepIndex: number
  policyVersion: string
  tokenizer: "o200k_base"
  estimatedInputTokens: number
  estimatedOutputTokens?: number
  outputReserveTokens: number
  estimatedSafetyTokens: number
  actualUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
  usageDelta: number | null
  requestDigest?: string
  transformations: Array<{ action: string; targetItemId: string; tokensBefore: number; tokensAfter: number; savings: number }>
}

/** Reconstructs a structured multi-turn summary, identifying each tool call by its step and call ID. */
export async function getMultiTurnExecutionSummary(
  runId: string,
  store: RunStorePort,
): Promise<MultiTurnExecutionSummary | null> {
  const run = await getRun(runId, store)
  if (!run) return null

  const events = await getRunHistory(runId, store)
  const toolCallMap = new Map<string, ReconstructedToolCall>()
  const contextTelemetry: ContextTelemetrySummary[] = []
  let pendingTransformations: ContextTelemetrySummary["transformations"] = []
  let currentStepIndex = 1

  for (const event of events) {
    if (event.type === "step.started") {
      const payload = event.payload as { stepIndex: number }
      currentStepIndex = payload.stepIndex
    } else if (event.type === "context.transformed") {
      const payload = event.payload as { action: string; targetItemId: string; tokensBefore: number; tokensAfter: number }
      pendingTransformations.push({ ...payload, savings: Math.max(0, payload.tokensBefore - payload.tokensAfter) })
    } else if (event.type === "context.allocated") {
      const payload = event.payload as { stepIndex: number; telemetry: Record<string, any> }
      const t = payload.telemetry
      contextTelemetry.push({
        stepIndex: payload.stepIndex,
        policyVersion: t.policyVersion,
        tokenizer: "o200k_base",
        estimatedInputTokens: t.estimatedInputTokens,
        ...(typeof t.estimatedOutputTokens === "number" ? { estimatedOutputTokens: t.estimatedOutputTokens } : {}),
        outputReserveTokens: t.outputReserveTokens,
        estimatedSafetyTokens: t.estimatedSafetyTokens,
        actualUsage: t.actualUsage ?? null,
        usageDelta: t.usageDelta ?? null,
        ...(typeof t.requestDigest === "string" ? { requestDigest: t.requestDigest } : {}),
        transformations: pendingTransformations,
      })
      pendingTransformations = []
    } else if (event.type === "tool.requested") {
      const payload = event.payload as {
        callIndex: number
        callId: string
        toolName: string
        arguments: Record<string, unknown>
      }
      const key = `${currentStepIndex}:${payload.callId}`
      toolCallMap.set(key, {
        stepIndex: currentStepIndex,
        callIndex: payload.callIndex,
        callId: payload.callId,
        toolName: payload.toolName,
        arguments: payload.arguments,
        status: "requested",
      })
    } else if (event.type === "tool.completed") {
      const payload = event.payload as { callId: string; durationMs: number; isTruncated: boolean }
      const existing = toolCallMap.get(`${currentStepIndex}:${payload.callId}`)
      if (existing) {
        existing.status = "completed"
        existing.durationMs = payload.durationMs
        existing.isTruncated = payload.isTruncated
      }
    } else if (event.type === "tool.failed") {
      const payload = event.payload as { callId: string; durationMs: number; message: string }
      const existing = toolCallMap.get(`${currentStepIndex}:${payload.callId}`)
      if (existing) {
        existing.status = "failed"
        existing.durationMs = payload.durationMs
        existing.message = payload.message
      }
    } else if (event.type === "context.item_added") {
      const payload = event.payload as {
        item?: { turn?: number; type?: string; content?: string; toolMeta?: { callId?: string } }
      }
      if (payload.item?.type === "tool_result" && payload.item.toolMeta?.callId) {
        const step = payload.item.turn ?? currentStepIndex
        const existing = toolCallMap.get(`${step}:${payload.item.toolMeta.callId}`)
        if (existing) existing.resultContent = payload.item.content
      }
    }
  }

  let attempts: Record<string, unknown>[] = []
  if ("loadModelAttempts" in store && typeof (store as Record<string, unknown>).loadModelAttempts === "function") {
    attempts = await Promise.resolve(
      (store as { loadModelAttempts: (id: string) => Promise<Record<string, unknown>[]> }).loadModelAttempts(runId),
    )
  }

  const steps = attempts
    .map((attempt): MultiTurnStepSummary | undefined => {
      const row = attempt as {
        stepIndex?: unknown
        attemptNumber?: unknown
        model?: unknown
        finishReason?: unknown
        promptTokens?: unknown
        completionTokens?: unknown
        totalTokens?: unknown
        costUsd?: unknown
        pricing?: unknown
        latencyMs?: unknown
        errorCategory?: unknown
      }
      if (
        typeof row.stepIndex !== "number" ||
        typeof row.attemptNumber !== "number" ||
        typeof row.model !== "string"
      ) return undefined
      const cost = row.costUsd === null || row.costUsd === undefined ? null : Number(row.costUsd)
      return {
        stepIndex: row.stepIndex,
        attemptNumber: row.attemptNumber,
        model: row.model,
        finishReason: typeof row.finishReason === "string" ? row.finishReason : null,
        promptTokens: typeof row.promptTokens === "number" ? row.promptTokens : 0,
        completionTokens: typeof row.completionTokens === "number" ? row.completionTokens : 0,
        totalTokens: typeof row.totalTokens === "number" ? row.totalTokens : 0,
        costUsd: cost !== null && Number.isFinite(cost) ? cost : null,
        pricing: row.pricing === "unpriced" ? "unpriced" : "priced",
        latencyMs: typeof row.latencyMs === "number" ? row.latencyMs : 0,
        ...(typeof row.errorCategory === "string" ? { errorCategory: row.errorCategory } : {}),
      }
    })
    .filter((step): step is MultiTurnStepSummary => step !== undefined)
    .sort((left, right) => left.stepIndex - right.stepIndex || left.attemptNumber - right.attemptNumber)

  const started = events.find((event) => event.type === "run.started")
  const startedPayload = started?.payload as
    | { snapshot?: { budget?: BudgetLimits; toolLimits?: ToolLimits } }
    | undefined
  const terminalEvent = [...events].reverse().find((event) =>
    event.type === "run.completed" || event.type === "run.failed" || event.type === "run.budget_exhausted",
  )
  const terminalPayload = terminalEvent?.payload as
    | { observedLimits?: BudgetTerminalReason[]; outputTruncated?: boolean }
    | undefined

  return {
    runId: run.runId,
    state: run.state,
    prompt: run.prompt,
    snapshotId: run.snapshotId,
    terminalReason: run.terminalReason,
    ...(startedPayload?.snapshot?.budget !== undefined ? { limits: startedPayload.snapshot.budget } : {}),
    ...(startedPayload?.snapshot?.toolLimits !== undefined ? { toolLimits: startedPayload.snapshot.toolLimits } : {}),
    ...(terminalPayload?.observedLimits !== undefined ? { observedLimits: terminalPayload.observedLimits } : {}),
    ...(terminalPayload?.outputTruncated !== undefined ? { outputTruncated: terminalPayload.outputTruncated } : {}),
    toolCalls: Array.from(toolCallMap.values()).sort(
      (left, right) => left.stepIndex - right.stepIndex || left.callIndex - right.callIndex,
    ),
    steps,
    attempts,
    events,
    contextTelemetry,
  }
}
