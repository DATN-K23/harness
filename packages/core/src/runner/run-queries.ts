// Adapted from OpenCode packages/cli/src/commands/view.ts @ 3f393d78bf (MIT License, Copyright (c) 2025 opencode). See NOTICE.
import type { RunRecord, RunStorePort, TrajectoryEvent } from "@harness/protocol"

/**
 * Retrieves a run record by runId from persistent store.
 */
export async function getRun(runId: string, store: RunStorePort): Promise<RunRecord | null> {
  const run = await store.loadRun(runId)
  return run ?? null
}

/**
 * Retrieves trajectory events for a run ordered strictly ascending by sequence number.
 */
export async function getRunHistory(runId: string, store: RunStorePort): Promise<TrajectoryEvent[]> {
  const events = await store.loadEvents({ runId })
  return [...events].sort((a, b) => a.sequence - b.sequence)
}

export interface ReconstructedToolCall {
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

/**
 * Reconstructs a structured execution summary for a multi-turn run,
 * linking snapshot, ordered tool calls with matching results, and provider attempts.
 */
export async function getMultiTurnExecutionSummary(
  runId: string,
  store: RunStorePort,
): Promise<MultiTurnExecutionSummary | null> {
  const run = await getRun(runId, store)
  if (!run) return null

  const events = await getRunHistory(runId, store)
  const toolCallMap = new Map<string, ReconstructedToolCall>()

  for (const event of events) {
    if (event.type === "tool.requested") {
      const p = event.payload as { callIndex: number; callId: string; toolName: string; arguments: Record<string, unknown> }
      toolCallMap.set(p.callId, {
        callIndex: p.callIndex,
        callId: p.callId,
        toolName: p.toolName,
        arguments: p.arguments,
        status: "requested",
      })
    } else if (event.type === "tool.completed") {
      const p = event.payload as { callId: string; durationMs: number; isTruncated: boolean }
      const existing = toolCallMap.get(p.callId)
      if (existing) {
        existing.status = "completed"
        existing.durationMs = p.durationMs
        existing.isTruncated = p.isTruncated
      }
    } else if (event.type === "tool.failed") {
      const p = event.payload as { callId: string; durationMs: number; message: string }
      const existing = toolCallMap.get(p.callId)
      if (existing) {
        existing.status = "failed"
        existing.durationMs = p.durationMs
        existing.message = p.message
      }
    } else if (event.type === "context.item_added") {
      const p = event.payload as { item?: { type?: string; content?: string; toolMeta?: { callId?: string } } }
      if (p.item?.type === "tool_result" && p.item.toolMeta?.callId) {
        const existing = toolCallMap.get(p.item.toolMeta.callId)
        if (existing) {
          existing.resultContent = p.item.content
        }
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
    toolCalls: Array.from(toolCallMap.values()).sort((a, b) => a.callIndex - b.callIndex),
    attempts,
    events,
  }
}
