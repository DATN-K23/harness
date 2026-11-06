import type { JudgeRunConfig, JudgeRunInput, JudgeRunnerDeps } from "@harness/core"
import type { RunClaim, RunStorePort, SourceSnapshotPort } from "@harness/protocol"
import type { IdGenerator } from "@harness/core"
import { createJudgeApi } from "./judge-api"
import { createJudgeSubmissionService, loadAdmittedJudgeInput } from "./judge-submission-service"
import { createOutboxWorker } from "./outbox-worker"

type SeedableStore = RunStorePort & {
  loadPendingOutbox(limit?: number): Promise<string[]>
  claimOutbox(runId: string): Promise<boolean>
  markOutboxPublished(runId: string): Promise<boolean>
}

export interface JudgeRuntimeOptions {
  store: SeedableStore
  snapshots: SourceSnapshotPort
  ids: IdGenerator
  workerId: string
  config: JudgeRunConfig
  cursorSecret: string
  credential: string
  runnerDeps(claim: RunClaim, runId: string): Omit<JudgeRunnerDeps, "store"> | Promise<Omit<JudgeRunnerDeps, "store">>
}

export const createJudgeRuntime = (options: JudgeRuntimeOptions) => {
  const submission = createJudgeSubmissionService({
    store: options.store,
    snapshots: options.snapshots,
    ids: options.ids,
    config: options.config as unknown as Record<string, unknown>,
  })
  const api = createJudgeApi({
    submit: (input) => submission.submit(input),
    store: options.store,
    cursorSecret: options.cursorSecret,
    credential: options.credential,
  })
  const worker = createOutboxWorker({
    store: options.store,
    workerId: options.workerId,
    execute: async (runId, claim) => {
      const input = await loadAdmittedJudgeInput(options.store, runId)
      if (!input) throw new Error("admitted Judge input is missing")
      const { JudgeRunner } = await import("@harness/core")
      const runner = new JudgeRunner({ ...await options.runnerDeps(claim, runId), store: options.store })
      await runner.run(claim, { ...input, config: options.config } satisfies JudgeRunInput)
    },
  })
  return { api, worker }
}
