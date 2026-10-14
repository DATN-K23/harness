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
