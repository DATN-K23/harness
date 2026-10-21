import type { RunClaim, RunStorePort } from "@harness/protocol"

type OutboxStore = RunStorePort & {
  loadPendingOutbox(limit?: number): Promise<string[]>
  claimOutbox(runId: string): Promise<boolean>
  markOutboxPublished(runId: string): Promise<boolean>
}

export interface OutboxWorkerDeps {
  store: OutboxStore
  workerId: string
  execute(runId: string, claim: RunClaim): Promise<void>
}

export const createOutboxWorker = (deps: OutboxWorkerDeps) => ({
  async runOnce(): Promise<number> {
    const pending = await deps.store.loadPendingOutbox()
    let dispatched = 0
    for (const runId of pending) {
      if (!(await deps.store.claimOutbox(runId))) continue
      const claimed = await deps.store.claim({ runId, workerId: deps.workerId })
      if (claimed.kind !== "claimed") {
        await deps.store.markOutboxPublished(runId)
        continue
      }
      await deps.execute(runId, claimed.claim)
      await deps.store.markOutboxPublished(runId)
      dispatched++
    }
    return dispatched
  },
})
