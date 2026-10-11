import {
  StopPrecedence,
  TerminalRunStates,
  type BudgetLimits,
  type CancellationPort,
  type CandidateFinding,
  type ClockPort,
  type ContextEnginePort,
  type ContextItem,
  type ContextPolicy,
  type IngestionPort,
  type ModelGatewayPort,
  type ModelLimits,
  type ModelUsage,
  type RandomPort,
  type ResolvedFlags,
  type RetryConfig,
  type RunClaim,
  type RunStorePort,
  type SandboxPort,
  type SanitizerPort,
  type SecurityFilterPort,
  type SleepPort,
  type SourceSnapshotPort,
  type StaleReason,
  type StepOutcome,
  type StopReason,
  type ToolRegistryPort,
} from "@harness/protocol"
import { loadPrompt } from "../prompts/index"
import { textDigest } from "../util/digest"
import type { IdGenerator } from "../util/id"
import {
  checkBoundary,
  createRunSignal,
  type CancellationBoundary,
  type RunSignal,
  type SetTimer,
} from "./cancellation"
import { compactContext } from "./compaction"
import type { EventBus } from "./event-bus"
import { EventSink } from "./event-sink"
import { hydrateHistory, interruptedToolItems, verifyHydration } from "./history-hydrator"
import { JudgeStep } from "./judge-step"
import { StaleWrite, StepFault, asFault, describeError, sumUsage } from "./judge-step-support"
import { createRetryPolicy, type AttemptRecord, type RetryPolicy } from "./retry-policy"
import { buildRunConfigSnapshot } from "./run-config"
import { enterStageFour, recoverTools, runStages, type StageContext } from "./run-stages"
import { RunWriter, type CommittedRun, type TerminalCommit } from "./run-writer"
import { evaluateStop, initialNoProgress, observeToolCalls, type NoProgressState } from "./stop-conditions"

/** The run configuration a run starts with; recorded (with the prompt digests) in `run.started`. */
export interface JudgeRunConfig {
  flags: ResolvedFlags
  policy: ContextPolicy
  retry: RetryConfig
  limits: BudgetLimits
  maxProbeRuns?: number
  modelLimits: ModelLimits
  profileId: string
}

/** Everything a run is given: the candidate finding, the snapshot it is judged against and the configuration. */
export interface JudgeRunInput {
  finding: CandidateFinding
  snapshotId: string
  config: JudgeRunConfig
}

export interface JudgeRunnerDeps {
  store: RunStorePort
  contextEngine: ContextEnginePort
  gateway: ModelGatewayPort
  tools: ToolRegistryPort
  security: SecurityFilterPort
  snapshot: SourceSnapshotPort
  ingestion: IngestionPort
  sanitizer: SanitizerPort
  sandbox: SandboxPort
  cancellation: CancellationPort
  clock: ClockPort
  random: RandomPort
  sleep: SleepPort
  ids: IdGenerator
  bus?: EventBus
  /** Timer behind the best-effort wall-clock abort signal; tests inject a fake. */
  setTimer?: SetTimer
  /** Defaults to the versioned `judge-system.v1` prompt, which also states the verdict format. */
  systemPrompt?: string
  /** A separate verdict schema text placed after the tool descriptions, when the system prompt does not state it. */
  verdictSchema?: string
  maxStepsPrompt?: string
}

interface RunTotals {
  /** Every provider attempt of the run, failed and compaction attempts included (restored totals after a takeover). */
  usage: ModelUsage
  /** The last reasoning step the run reached, 1-based; 0 when it ended before stage 4. */
  lastStepIndex: number
}

export type JudgeRunResult = { runId: string } & RunTotals &
  (
    | ({ kind: "committed" } & CommittedRun)
    /** The store refused a write (claim lost or state changed): this worker stopped writing. */
    | { kind: "stale"; reason: StaleReason }
    /** The run could not be committed (store unavailable); its state is whatever the store last accepted. */
    | { kind: "error"; message: string }
  )

/**
 * Drives one Judge run end to end (design 5.7, D5): stages 1-3 with zero-token fast-reject, stage 4 initialization or
 * hydration, the reasoning loop over `JudgeStep`, compaction, cancellation boundaries and the terminal commit.
 * `run` never rejects.
 */
export class JudgeRunner {
  constructor(private readonly deps: JudgeRunnerDeps) {}

  async run(claim: RunClaim, input: JudgeRunInput): Promise<JudgeRunResult> {
    // Construction loads the prompt and reads the claim and config; a failure there is returned, never thrown.
    const started = await Promise.resolve()
      .then(() => new RunExecution(this.deps, claim, input))
      .then(
        (execution) => ({ kind: "ready" as const, execution }),
        (error: unknown) => ({ kind: "failed" as const, error }),
      )
    if (started.kind === "failed")
      return {
        kind: "error",
        runId: runIdOf(claim),
        message: `the run could not start: ${describeError(started.error)}`,
        usage: zeroUsage,
        lastStepIndex: 0,
      }
    return started.execution.run()
  }
}

const runIdOf = (claim: unknown) =>
  typeof claim === "object" && claim !== null && "runId" in claim && typeof claim.runId === "string"
    ? claim.runId
    : "unknown"

const zeroUsage: ModelUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }

const addUsage = (left: ModelUsage, right: ModelUsage): ModelUsage => ({
  promptTokens: left.promptTokens + right.promptTokens,
  completionTokens: left.completionTokens + right.completionTokens,
  totalTokens: left.totalTokens + right.totalTokens,
  costUsd: left.costUsd + right.costUsd,
})

/** One run of one worker: the loop state lives here, so the never-throw wrapper can report what was spent. */
class RunExecution {
  private readonly runId: string
  private readonly systemPrompt: string
  private readonly retryPolicy: RetryPolicy
  private writer: RunWriter | undefined
  private runSignal: RunSignal | undefined
  private startedAtMs = 0
  private items: ContextItem[] = []
  /** Steps whose results are in the context; the next step is `stepIndex + 1`. */
  private stepIndex = 0
  private lastStepIndex = 0
  private usage = zeroUsage
  private compactionsCount = 0
  private repairsUsed = 0
  private noProgress: NoProgressState = initialNoProgress
  private observed: StopReason[] = []

  constructor(
    private readonly deps: JudgeRunnerDeps,
    private readonly claim: RunClaim,
    private readonly input: JudgeRunInput,
  ) {
    this.runId = claim.runId
    this.systemPrompt = deps.systemPrompt ?? loadPrompt("judge-system.v1").text
    this.retryPolicy = createRetryPolicy({
      gateway: deps.gateway,
      cancellation: deps.cancellation,
      sleep: deps.sleep,
      random: deps.random,
      clock: deps.clock,
      config: input.config.retry,
      flags: input.config.flags,
    })
  }

  async run(): Promise<JudgeRunResult> {
    try {
      return await this.execute()
    } catch (error) {
      return await this.recover(error)
    } finally {
      this.runSignal?.dispose()
    }
  }

  private totals(): { runId: string } & RunTotals {
    return { runId: this.runId, usage: this.usage, lastStepIndex: this.lastStepIndex }
  }

  private get write() {
    if (this.writer === undefined) throw new Error("the run writer is used before the run was loaded")
    return this.writer
  }

  private get signal() {
    return this.runSignal?.signal
  }

  private async execute(): Promise<JudgeRunResult> {
    const { store } = this.deps
    const record = await store.loadRun(this.runId).catch(asFault("persistence_failure"))
    if (record === undefined) return { kind: "error", message: `run ${this.runId} does not exist`, ...this.totals() }
    if (TerminalRunStates.some((state) => state === record.state))
      return { kind: "stale", reason: "state_changed", ...this.totals() }
    const sink = new EventSink({
      store,
      claim: this.claim,
      expectedStateVersion: record.stateVersion,
      ids: this.deps.ids,
      clock: this.deps.clock,
      bus: this.deps.bus,
    })
    this.writer = new RunWriter(store, sink, this.claim, record)
    const committed = record.state === "running" ? await this.takeover() : await this.fresh()
    return { kind: "committed", ...committed, ...this.totals() }
  }

  /** Never throws: an unexpected fault becomes `failed` with an event; if even that is refused, a stale or error result. */
  private async recover(error: unknown): Promise<JudgeRunResult> {
    if (error instanceof StaleWrite) return { kind: "stale", reason: error.reason, ...this.totals() }
    const reason = error instanceof StepFault ? error.reason : "worker_interrupted"
    const message = describeError(error instanceof StepFault ? error.fault : error)
    const writer = this.writer
    if (writer === undefined || writer.state !== "running" || writer.terminalWritten)
      return { kind: "error", message, ...this.totals() }
    return writer.commit({ state: "failed", reason, message }).then(
      (committed): JudgeRunResult => ({ kind: "committed", ...committed, ...this.totals() }),
      (second: unknown): JudgeRunResult => {
        if (second instanceof StaleWrite) return { kind: "stale", reason: second.reason, ...this.totals() }
        const cause = describeError(second instanceof StepFault ? second.fault : second)
        return { kind: "error", message: `${message}; recording the failure also failed: ${cause}`, ...this.totals() }
      },
    )
  }

  private async fresh(): Promise<CommittedRun> {
    if (this.write.state === "accepted") await this.write.transition("queued")
    await this.write.transition("running")
    const built = await this.snapshot()
    await this.write.persist("run.started", { snapshot: built.snapshot, snapshotDigest: built.digest })
    this.begin(this.deps.clock.nowMs())
    return this.write.commit(await this.fromStages())
  }

  private async takeover(): Promise<CommittedRun> {
    const events = await this.deps.store.loadEvents({ runId: this.runId }).catch(asFault("persistence_failure"))
    const hydration = hydrateHistory(events)
    if (hydration.kind === "corrupt")
      return this.write.commit({ state: "failed", reason: hydration.reason, message: hydration.message })
    const { history } = hydration
    if (history.terminalPending !== undefined) return this.write.finishPending(history.terminalPending)

    const built = await this.snapshot()
    const started = events.find((event) => event.type === "run.started")
    if (started === undefined)
      await this.write.persist("run.started", { snapshot: built.snapshot, snapshotDigest: built.digest })
    if (started !== undefined && started.payload.snapshotDigest !== built.digest)
      return this.write.commit({
        state: "failed",
        reason: "incompatible_version",
        message: "the run configuration differs from the one recorded in run.started",
      })
    this.begin(started === undefined ? this.deps.clock.nowMs() : Date.parse(started.occurredAt))
    // Without a persisted initial context nothing past the stages happened; they make no model call and run again.
    if (history.items.length === 0) return this.write.commit(await this.fromStages())
    // Before the first allocation the initial context is complete only once its last item, the trace, is persisted.
    // Re-running the stages would duplicate the items already there, so a partial one fails closed.
    const initialComplete =
      history.lastAllocated !== undefined || history.items.some((item) => item.type === "execution_trace")
    if (!initialComplete)
      return this.write.commit({
        state: "failed",
        reason: "persistence_failure",
        message: "the initial context was only partly persisted before the previous worker stopped",
      })

    const { config } = this.input
    const check = await verifyHydration({
      engine: this.deps.contextEngine,
      history,
      policy: config.policy,
      modelLimits: config.modelLimits,
      limits: config.limits,
    })
    if (check.kind === "mismatch")
      return this.write.commit({ state: "failed", reason: check.reason, message: check.message })

    const interrupted = interruptedToolItems(history.pendingToolCalls, this.deps.ids)
    for (const item of interrupted) await this.write.persist("context.item_added", { item })
    this.items = [...history.items, ...interrupted]
    this.stepIndex = history.stepIndex
    this.lastStepIndex = history.stepIndex
    this.usage = history.totalsFromAttempts
    this.compactionsCount = history.compactionsCount
    this.repairsUsed = history.repairsUsed
    // The no-progress streak is not persisted; it restarts from zero after a takeover.
    const tooling = await recoverTools(this.stageContext(), history)
    if (tooling.kind === "ended") return this.write.commit(tooling.terminal)
    return this.write.commit(await this.loop(tooling.tools, tooling.traceDigest))
  }

  private async snapshot() {
    const { config } = this.input
    const verdictText = this.deps.verdictSchema ?? this.systemPrompt
    return Promise.resolve()
      .then(() =>
        buildRunConfigSnapshot({
          flags: config.flags,
          policy: config.policy,
          retry: config.retry,
          limits: config.limits,
          maxProbeRuns: config.maxProbeRuns,
          systemPromptDigest: textDigest(this.systemPrompt),
          verdictSchemaDigest: textDigest(verdictText),
        }),
      )
      .catch(asFault("invalid_input"))
  }

  private begin(startedAtMs: number) {
    this.startedAtMs = startedAtMs
    this.runSignal = createRunSignal({
      deadlineMs: startedAtMs + this.input.config.limits.wallClockTimeoutMs,
      clock: this.deps.clock,
      setTimer: this.deps.setTimer,
    })
  }

  private stageContext(): StageContext {
    return {
      deps: this.deps,
      runId: this.runId,
      input: this.input,
      persist: this.write.persist,
      systemPrompt: this.systemPrompt,
      signal: this.signal,
    }
  }

  private async fromStages(): Promise<TerminalCommit> {
    const context = this.stageContext()
    const staged = await runStages(context)
    if (staged.kind === "ended") return staged.terminal
    const entered = await enterStageFour(context, staged)
    this.items = entered.items
    return this.loop(entered.tools, entered.traceDigest)
  }

  private observe(reasons: readonly StopReason[]) {
    this.observed = StopPrecedence.filter((reason) => this.observed.includes(reason) || reasons.includes(reason))
  }

  private exhausted(reason: StopReason): TerminalCommit {
    this.observe([reason])
    return { state: "budget_exhausted", reason, observed: this.observed }
  }

  /** Stop conditions at a safe boundary; `spent` is what the current call has used so far (retries). */
  private stopReason(spent: ModelUsage = zeroUsage, contextBudgetExhausted = false) {
    const evaluation = evaluateStop(
      {
        startedAtMs: this.startedAtMs,
        costUsd: this.usage.costUsd + spent.costUsd,
        totalTokens: this.usage.totalTokens + spent.totalTokens,
        completedSteps: this.stepIndex,
        contextBudgetExhausted,
        noProgress: this.noProgress,
      },
      this.input.config.limits,
      this.deps.clock.nowMs(),
    )
    this.observe(evaluation.observed)
    return evaluation.selected
  }

  /** The budget handed to `prepare`, built like `verifyHydration` builds it so a takeover reproduces the digest. */
  private budget() {
    const { limits } = this.input.config
    return {
      totalTokensUsed: this.usage.totalTokens,
      totalTokenLimit: limits.totalTokenBudget,
      compactionsCount: this.compactionsCount,
      costUsd: this.usage.costUsd,
      costCeilingUsd: limits.costCeilingUsd,
    }
  }

  /** The reasoning loop (design 5.7 step 5): one `JudgeStep` per iteration, dispatched on its outcome. */
  private async loop(tools: ToolRegistryPort, traceDigest: string | undefined): Promise<TerminalCommit> {
    const { deps, input } = this
    const { config } = input
    const step = new JudgeStep({
      contextEngine: deps.contextEngine,
      retryPolicy: this.retryPolicy,
      security: deps.security,
      snapshot: deps.snapshot,
      cancellation: deps.cancellation,
      sink: this.write.sink,
      clock: deps.clock,
      ids: deps.ids,
      ...(deps.maxStepsPrompt === undefined ? {} : { maxStepsPrompt: deps.maxStepsPrompt }),
    })

    while (true) {
      // Checked before every step, so also right after each tool boundary: max_steps, no_progress, budgets, clock.
      const stop = this.stopReason()
      if (stop !== undefined) return this.exhausted(stop)
      const boundary = await checkBoundary(deps.cancellation, this.runId, "before_model", { signal: this.signal })
      if (boundary.kind === "cancel") return { state: "cancelled", boundary: boundary.boundary }

      const stepIndex = this.stepIndex + 1
      this.lastStepIndex = stepIndex
      const result = await step.execute({
        findingId: input.finding.findingId,
        snapshotId: input.snapshotId,
        profileId: config.profileId,
        stepIndex,
        items: this.items,
        tools,
        flags: config.flags,
        policy: config.policy,
        modelLimits: config.modelLimits,
        budget: this.budget(),
        limits: config.limits,
        stopState: {
          startedAtMs: this.startedAtMs,
          costUsd: this.usage.costUsd,
          totalTokens: this.usage.totalTokens,
          completedSteps: this.stepIndex,
          contextBudgetExhausted: false,
          noProgress: this.noProgress,
        },
        repairsUsed: this.repairsUsed,
        ...(traceDigest === undefined ? {} : { traceDigest }),
        signal: this.signal,
      })
      this.usage = addUsage(this.usage, result.usage)
      this.observe(result.observedLimits)
      if (result.stale !== undefined) throw new StaleWrite(result.stale)

      const { outcome } = result
      if (outcome.type === "completed") return { state: "completed", verdict: outcome.verdict }
      if (outcome.type === "budget_exhausted") return this.exhausted(outcome.reason)
      if (outcome.type === "failed") return this.failed(outcome, result.cancelledAt)
      if (outcome.type === "needs_compaction") {
        const ended = await this.compact(outcome, stepIndex)
        if (ended !== undefined) return ended
        continue
      }

      for (const item of result.newItems) await this.write.persist("context.item_added", { item })
      this.items = [...this.items, ...result.newItems]
      this.stepIndex = stepIndex
      this.repairsUsed = result.repairsUsed
      this.noProgress = observeToolCalls(this.noProgress, outcome.toolOutcomes, config.flags.enableNoProgressDetection)
    }
  }

  private failed(
    outcome: Extract<StepOutcome, { type: "failed" }>,
    cancelledAt?: CancellationBoundary,
  ): TerminalCommit {
    if (outcome.reason === "cancelled_by_user" && cancelledAt !== undefined)
      return { state: "cancelled", boundary: cancelledAt }
    // A step fails without a reason only when the context engine broke its contract.
    return { state: "failed", reason: outcome.reason ?? "worker_interrupted", message: outcome.error }
  }

  /** `needs_compaction` (design 3.5, D8). Returns the terminal when the run ends, `undefined` to prepare again. */
  private async compact(
    outcome: Extract<StepOutcome, { type: "needs_compaction" }>,
    stepIndex: number,
  ): Promise<TerminalCommit | undefined> {
    const { deps, input } = this
    const { config } = input
    if (!config.policy.flags.enableLlmCompaction || this.compactionsCount >= config.policy.maxCompactions)
      return this.exhausted(this.stopReason(zeroUsage, true) ?? "context_budget_exhausted")
    const stop = this.stopReason()
    if (stop !== undefined) return this.exhausted(stop)
    const boundary = await checkBoundary(deps.cancellation, this.runId, "before_model", { signal: this.signal })
    if (boundary.kind === "cancel") return { state: "cancelled", boundary: boundary.boundary }

    const compaction = await compactContext(
      { retryPolicy: this.retryPolicy, contextEngine: deps.contextEngine, persist: this.write.persist, ids: deps.ids },
      {
        runId: this.runId,
        stepIndex,
        profileId: config.profileId,
        items: this.items,
        summaryPrompt: outcome.summaryPrompt,
        itemsToSummarize: outcome.itemsToSummarize,
        modelLimits: config.modelLimits,
        budget: this.budget(),
        deadlineMs: this.startedAtMs + config.limits.wallClockTimeoutMs,
        signal: this.signal,
        beforeRetry: (attempts: readonly AttemptRecord[]) => this.stopReason(sumUsage(attempts)),
      },
    )
    this.usage = addUsage(this.usage, compaction.usage)
    if (compaction.kind === "terminal") {
      const { terminal } = compaction
      return terminal.state === "budget_exhausted" ? this.exhausted(terminal.reason) : terminal
    }
    this.items = compaction.items
    this.compactionsCount += 1
    return undefined
  }
}
