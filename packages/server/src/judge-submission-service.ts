import { digestOf, type IdGenerator } from "@harness/core"
import type { RunStorePort, SourceSnapshotPort } from "@harness/protocol"
import type { JudgeSubmissionService } from "./judge-api"

export interface JudgeSubmissionServiceDeps {
  store: RunStorePort & Required<Pick<RunStorePort, "admit">>
  snapshots: SourceSnapshotPort
  ids: IdGenerator
  config: Record<string, unknown>
}

export const createJudgeSubmissionService = (deps: JudgeSubmissionServiceDeps): JudgeSubmissionService => ({
  async submit(input) {
    const files = await deps.snapshots.listFiles({ snapshotId: input.snapshotId })
    if (files.length === 0) return { kind: "not_found", resource: "snapshot" }

    const requestDigest = digestOf({ finding: input.finding, snapshotId: input.snapshotId, config: deps.config })
    const result = await deps.store.admit({
      runId: deps.ids.next("run_"),
      findingId: input.finding.findingId,
      reportMarkdown: input.finding.reportMarkdown,
      snapshotId: input.snapshotId,
      config: deps.config,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
    })
    return result
  },
})

export const loadAdmittedJudgeInput = async (
  store: RunStorePort,
  runId: string,
): Promise<{ finding: { findingId: string; reportMarkdown: string }; snapshotId: string; config: Record<string, unknown> } | undefined> => {
  const run = await store.loadRun(runId)
  if (!run?.findingId || !run.snapshotId || !run.prompt || !run.configSnapshot) return undefined
  return {
    finding: { findingId: run.findingId, reportMarkdown: run.prompt },
    snapshotId: run.snapshotId,
    config: run.configSnapshot,
  }
}
