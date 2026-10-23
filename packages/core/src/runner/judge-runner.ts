import {
  EventPayloadSchemas,
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
  type TrajectoryEvent,
} from "@harness/protocol"
import { verificationPromptDigest } from "../judge/bidirectional-verifier"
import { claimExtractionPrompt } from "../judge/claim-extraction"
import { DefaultEvidenceSaturationReads, DefaultVerificationStepBudget } from "../judge/step-budget"
import { structuredOutputPrompt } from "../judge/structured-output"
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

type AttemptRecorder = { recordModelAttempt(attempt: Record<string, unknown>): Promise<void> }

/** Mirrors each `provider.attempted` event into the store's per-attempt table, when the store has one. */
const recordAttempt = async (store: RunStorePort, ids: IdGenerator, event: TrajectoryEvent) => {
  if (event.type !== "provider.attempted" || !("recordModelAttempt" in store)) return
  const attempt = EventPayloadSchemas["provider.attempted"].parse(event.payload)
  await (store as RunStorePort & AttemptRecorder).recordModelAttempt({
    id: ids.next("att_"),
    runId: event.runId,
    stepIndex: attempt.stepIndex,
    attemptPurpose: attempt.purpose,
    attemptNumber: attempt.attemptIndex,
    provider: attempt.profileId.split("/")[0] || "provider",
    model: attempt.profileId,
    promptTokens: attempt.usage?.promptTokens ?? 0,
    completionTokens: attempt.usage?.completionTokens ?? 0,
    totalTokens: attempt.usage?.totalTokens ?? 0,
    costUsd: attempt.usage?.pricing === "unpriced" ? null : attempt.costUsd,
    pricing: attempt.usage?.pricing ?? (attempt.costUsd === null ? "unpriced" : "priced"),
    latencyMs: attempt.latencyMs,
    requestJson: { eventSequence: event.sequence, retryDecision: attempt.retryDecision, backoffMs: attempt.backoffMs },
    errorCategory: attempt.errorCategory ?? null,
  })
}

/** The run configuration a run starts with; recorded (with the prompt digests) in `run.started`. */
export interface JudgeRunConfig {
  flags: ResolvedFlags
  policy: ContextPolicy
  retry: RetryConfig
  limits: BudgetLimits
  maxProbeRuns?: number
  /** Runtime PoC execution remains disabled until the selected sandbox is validated. */
  enablePocExecution?: boolean
  /** Forward then backward verification of a deconstructed claim before the verdict; on unless set to `false`. */
  enableBidirectionalVerification?: boolean
  /** Verdicts and direction results submitted through schema-typed tools (OpenCode structured output); off by default. */
  enableStructuredOutput?: boolean
  /** One provider call to locate claim fields a report's layout did not yield, before the run is unresolved. */
  enableClaimExtraction?: boolean
  /** Steps one verification direction may take, its answer included; defaults to `DefaultVerificationStepBudget`. */
  verificationStepBudget?: number
  /** Tool results without new evidence after which a direction must answer; defaults to `DefaultEvidenceSaturationReads`. */
  evidenceSaturationReads?: number
  /**
   * Conclude valid/invalid without execution evidence under the TV4 conclusion rules (both directions agree; a valid
   * verdict cites resolved source, an invalid one a confirmed guard). Off by default: every conclusion is then withheld
   * while BCE is incomplete, as the Sprint 9 design decided.
   */
  enableStaticVerdicts?: boolean
  modelLimits: ModelLimits
  profileId: string
  runtime?: NonNullable<import("@harness/protocol").RunConfigSnapshot["runtime"]>
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
  /**
   * Defaults to the versioned `judge-system.v2` prompt, which also states the verdict format. v2 follows the TV4
   * proposal: a claim the evidence does not settle is unverified (v1: "doubt resolves to invalid"), a missing PoC is not
   * a reason to reject a source-only finding, a failed execution does not show the claim false, and source reasoning is
   * kept apart from execution evidence.
   */
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
  private readonly probeEvidence = new Map<string, { before: string; after: string }>()
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
    this.systemPrompt = deps.systemPrompt ?? loadPrompt("judge-system.v2").text
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
      onAppended: (event) => recordAttempt(store, this.deps.ids, event),
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
    // A port that rejected because the deadline aborted the run signal ran out of wall clock; it did not break.
    const terminal: TerminalCommit =
      this.runSignal?.cause() === "wall_clock_timeout"
        ? this.exhausted("wall_clock_timeout")
        : { state: "failed", reason, message }
    return writer.commit(terminal).then(
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
    // Attempts already made (claim extraction included) stay charged when the stages run again.
    this.usage = history.totalsFromAttempts
    // Without a persisted initial context nothing past the stages happened, so they run again; only claim extraction
    // can call the model there, and its earlier attempts are already in the totals above.
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
      ...(history.lastAllocated === undefined ? {} : {
        request: {
          attemptIndex: 1,
          runId: this.runId,
          stepIndex: history.lastAllocated.stepIndex,
          profileId: config.profileId,
          items: history.lastAllocated.items,
          tools: history.lastAllocated.items.filter((item) => item.type === "tool_description").map((item) => {
            const schemaMarker = "\nParameters (JSON Schema): "
            const schemaIndex = item.content.indexOf(schemaMarker)
            const nameEnd = item.content.indexOf(": ")
            if (schemaIndex < 0 || nameEnd < 0) throw new Error("persisted tool description is malformed")
            return {
              name: item.content.slice(0, nameEnd),
              description: item.content.slice(nameEnd + 2, schemaIndex),
              parameters: JSON.parse(item.content.slice(schemaIndex + schemaMarker.length)),
            }
          }),
          maxOutputTokens: config.modelLimits.maxOutputTokens,
        },
      }),
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
          enablePocExecution: config.enablePocExecution,
          enableBidirectionalVerification: config.enableBidirectionalVerification,
          enableStructuredOutput: config.enableStructuredOutput,
          enableClaimExtraction: config.enableClaimExtraction,
          enableStaticVerdicts: config.enableStaticVerdicts,
          ...(config.enableBidirectionalVerification === false
            ? {}
            : {
                verificationStepBudget: config.verificationStepBudget ?? DefaultVerificationStepBudget,
                evidenceSaturationReads: config.evidenceSaturationReads ?? DefaultEvidenceSaturationReads,
              }),
          runtime: config.runtime,
          systemPromptDigest: textDigest(this.systemPrompt),
          verdictSchemaDigest: textDigest(verdictText),
          ...(config.enableBidirectionalVerification === false ? {} : { verificationPromptDigest: verificationPromptDigest() }),
          ...(config.enableStructuredOutput === true ? { structuredOutputPromptDigest: structuredOutputPrompt().digest } : {}),
          ...(config.enableClaimExtraction === true ? { claimExtractionPromptDigest: claimExtractionPrompt().digest } : {}),
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
      probeEvidence: this.probeEvidence,
      retryPolicy: this.retryPolicy,
      charge: (attempt) => {
        this.usage = addUsage(this.usage, sumUsage([attempt]))
      },
      beforeRetry: () => this.stopReason(),
      deadlineMs: this.startedAtMs + this.input.config.limits.wallClockTimeoutMs,
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
        probeEvidence: this.probeEvidence,
        flags: config.flags,
        policy: config.policy,
        modelLimits: config.modelLimits,
        budget: this.budget(),
        limits: config.limits,
        stopState: {
          startedAtMs: this.startedAtMs,
          totalTokens: this.usage.totalTokens,
          completedSteps: this.stepIndex,
          contextBudgetExhausted: false,
          noProgress: this.noProgress,
        },
        repairsUsed: this.repairsUsed,
        ...(traceDigest === undefined ? {} : { traceDigest }),
        signal: this.signal,
        ...(config.verificationStepBudget === undefined ? {} : { verificationStepBudget: config.verificationStepBudget }),
        ...(config.evidenceSaturationReads === undefined ? {} : { evidenceSaturationReads: config.evidenceSaturationReads }),
        ...(config.enableStaticVerdicts === true ? { enableStaticVerdicts: true } : {}),
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
        // Attempts are charged as they happen, so `spent` is already in the run usage.
        beforeRetry: () => this.stopReason(),
        charge: (attempt: AttemptRecord) => {
          this.usage = addUsage(this.usage, sumUsage([attempt]))
        },
      },
    )
    if (compaction.kind === "terminal") {
      const { terminal } = compaction
      return terminal.state === "budget_exhausted" ? this.exhausted(terminal.reason) : terminal
    }
    this.items = compaction.items
    this.compactionsCount += 1
    return undefined
  }
}
