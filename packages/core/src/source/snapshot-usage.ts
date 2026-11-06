import type { RunStorePort } from "@harness/protocol"

/** Creates the fail-closed snapshot usage callback used before deleting stored snapshots. */
export function snapshotInUse(store: RunStorePort): (snapshotId: string) => Promise<boolean> {
  return async (snapshotId) => {
    if (!store.findActiveRunsBySnapshot) {
      throw new Error("Run store cannot verify active snapshot usage")
    }
    const activeRuns = await store.findActiveRunsBySnapshot(snapshotId)
    return activeRuns.length > 0
  }
}
