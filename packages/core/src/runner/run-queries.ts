// Adapted from OpenCode packages/cli/src/commands/view.ts @ 3f393d78bf (MIT License, Copyright (c) 2025 opencode). See NOTICE.
import type { RunRecord, RunStorePort, TrajectoryEvent } from "@harness/protocol"

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

export interface MultiTurnExecutionSummary {
  runId: string
  state: string
  prompt?: string
  snapshotId?: string
  terminalReason?: string
  toolCalls: ReconstructedToolCall[]
  attempts: Record<string, unknown>[]
  events: TrajectoryEvent[]
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
  let currentStepIndex = 1

  for (const event of events) {
    if (event.type === "step.started") {
      const payload = event.payload as { stepIndex: number }
      currentStepIndex = payload.stepIndex
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

  return {
    runId: run.runId,
    state: run.state,
    prompt: run.prompt,
    snapshotId: run.snapshotId,
    terminalReason: run.terminalReason,
    toolCalls: Array.from(toolCallMap.values()).sort(
      (left, right) => left.stepIndex - right.stepIndex || left.callIndex - right.callIndex,
    ),
    attempts,
    events,
  }
}
