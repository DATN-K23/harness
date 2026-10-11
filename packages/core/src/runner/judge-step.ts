import {
  PrepareResultSchema,
  StopPrecedence,
  type BudgetLimits,
  type CancellationPort,
  type ClockPort,
  type ContextEnginePort,
  type ContextItem,
  type ContextPolicy,
  type ModelLimits,
  type ModelUsage,
  type ResolvedFlags,
  type RunBudget,
  type SecurityFilterPort,
  type SourceSnapshotPort,
  type StaleReason,
  type StepOutcome,
  type StopReason,
  type ToolRegistryPort,
} from "@harness/protocol"
import { synthesizeVerdict } from "../judge/verdict-synthesizer"
import { loadPrompt } from "../prompts/index"
import { digestOf } from "../util/digest"
import type { IdGenerator } from "../util/id"
import { checkBoundary, type CancellationBoundary } from "./cancellation"
import type { EventSink } from "./event-sink"
import {
  StaleWrite,
  StepFault,
  asFault,
  attemptPayload,
  bounded,
  describeError,
  persistTo,
  sumUsage,
} from "./judge-step-support"
import { runToolBranch, type ToolBranchContext } from "./judge-step-tools"
import type { AttemptRecord, RetryOutcome, RetryPolicy } from "./retry-policy"
import { evaluateStop, isForcedStep, type StopState } from "./stop-conditions"

/** Ports of one run. The sink carries the run's claim; the retry policy wraps the model gateway. */
export interface JudgeStepDeps {
  contextEngine: ContextEnginePort
  retryPolicy: RetryPolicy
  security: SecurityFilterPort
  snapshot: SourceSnapshotPort
  cancellation: CancellationPort
  sink: EventSink
  clock: ClockPort
  /** Ids of the context items the step creates. */
  ids: IdGenerator
  /** The step-limit instruction; defaults to the versioned `max-steps.v1` prompt. */
  maxStepsPrompt?: string
}

/** The run state the step reads. The step never changes it; the runner applies the returned result. */
export interface JudgeStepInput {
  findingId: string
  snapshotId: string
  profileId: string
  /** 1-based. */
  stepIndex: number
  items: ContextItem[]
  tools: ToolRegistryPort
  flags: ResolvedFlags
  policy: ContextPolicy
  modelLimits: ModelLimits
  budget: RunBudget
  limits: BudgetLimits
  /** The runner's stop state when the step starts; the step adds the spend of its own attempts before each retry. */
  stopState: StopState
  repairsUsed: number
  traceDigest?: string
  signal?: AbortSignal
}

export interface JudgeStepResult {
  outcome: StepOutcome
  /** Items the runner appends to the context (and persists) before the next step, in order. */
  newItems: ContextItem[]
  /** Sum over every provider attempt of the step, failed ones included. */
  usage: ModelUsage
  attempts: AttemptRecord[]
  repairsUsed: number
  toolsDisabled: boolean
  /** Every exhausted limit observed when a stop condition ended the step, in precedence order. */
  observedLimits: StopReason[]
  /** Set when the step stopped at a cancellation boundary; the outcome is then `failed` with `cancelled_by_user`. */
  cancelledAt?: CancellationBoundary
  /** Set when the store refused a write; the runner must stop without writing anything else. */
  stale?: StaleReason
}

interface Progress {
  attempts: AttemptRecord[]
  toolsDisabled: boolean
  observedLimits: StopReason[]
}

const engineStopReasons = {
  context_budget: "context_budget_exhausted",
  total_tokens: "total_tokens_exhausted",
} as const satisfies Record<string, StopReason>

const withObserved = (reason: StopReason, observed: readonly StopReason[]) =>
  StopPrecedence.filter((candidate) => candidate === reason || observed.includes(candidate))

/**
 * One atomic reasoning step through the seven gates of design 5.6: context preflight, step-limit forcing, one model
 * call through the retry policy, `record` with the real usage, the verdict branch, the tool branch, and security
 * filtering before context shaping. It appends events through the sink only and never throws: an unexpected fault
 * becomes a `failed` outcome tagged `persistence_failure` (store) or `worker_interrupted` (anything else).
 */
export class JudgeStep {
  private readonly maxStepsPrompt: string

  constructor(private readonly deps: JudgeStepDeps) {
    this.maxStepsPrompt = deps.maxStepsPrompt ?? loadPrompt("max-steps.v1").text
  }

  async execute(input: JudgeStepInput): Promise<JudgeStepResult> {
    const progress: Progress = { attempts: [], toolsDisabled: false, observedLimits: [] }
    try {
      return await this.run(input, progress)
    } catch (error) {
      const finish = this.finisher(input, progress)
      if (error instanceof StaleWrite) return finish({ type: "failed", error: error.message }, { stale: error.reason })
      if (error instanceof StepFault)
        return finish({ type: "failed", error: describeError(error.fault), reason: error.reason })
      return finish({ type: "failed", error: describeError(error), reason: "worker_interrupted" })
    }
  }

  private finisher(input: JudgeStepInput, progress: Progress) {
    return (outcome: StepOutcome, extra: Partial<JudgeStepResult> = {}): JudgeStepResult => ({
      outcome,
      newItems: [],
      usage: sumUsage(progress.attempts),
      attempts: progress.attempts,
      repairsUsed: input.repairsUsed,
      toolsDisabled: progress.toolsDisabled,
      observedLimits: progress.observedLimits,
      ...extra,
    })
  }

  private async run(input: JudgeStepInput, progress: Progress): Promise<JudgeStepResult> {
    const { deps } = this
    const runId = deps.sink.runId
    const finish = this.finisher(input, progress)
    const persist = persistTo(deps.sink)
    const newItem: ToolBranchContext["newItem"] = (type, content, toolMeta) => ({
      id: deps.ids.next("itm_"),
      turn: input.stepIndex,
      type,
      isPinned: false,
      content,
      ...(toolMeta === undefined ? {} : { toolMeta }),
    })

    // Gate 1: context preflight. The engine signals; the step decides and never calls the gateway on stop/compaction.
    const preparation = await deps.contextEngine
      .prepare({ items: input.items, policy: input.policy, modelLimits: input.modelLimits, budget: input.budget })
      .catch(asFault("worker_interrupted"))
    const checked = PrepareResultSchema.safeParse(preparation)
    if (!checked.success) {
      const paths = checked.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ")
      return finish({ type: "failed", error: `context engine result violates the protocol contract at ${paths}` })
    }
    if (preparation.status === "stop") {
      const reason = engineStopReasons[preparation.stopReason]
      progress.observedLimits = [reason]
      return finish({ type: "budget_exhausted", reason })
    }
    if (preparation.status === "needs_compaction")
      return finish({
        type: "needs_compaction",
        summaryPrompt: preparation.summaryPrompt,
        itemsToSummarize: preparation.itemsToSummarize,
      })
    // A cancel requested while the engine was preparing must not pay for this step's provider attempt.
    const afterPrepare = await checkBoundary(deps.cancellation, runId, "before_model", { signal: input.signal })
    if (afterPrepare.kind === "cancel")
      return finish(
        { type: "failed", error: "cancelled while the context was being prepared", reason: "cancelled_by_user" },
        { cancelledAt: afterPrepare.boundary },
      )
    const clean = checked.data
    for (const transformation of clean.transformations ?? []) await persist("context.transformed", transformation)
    await persist("context.allocated", {
      stepIndex: input.stepIndex,
      telemetry: { ...clean.telemetry, contentDigest: digestOf(preparation.preparedItems) },
    })

    // Gate 2: step-limit forcing works on a derived list; the engine's preparedItems are never modified.
    const forced = isForcedStep(input.stepIndex, input.limits.maxSteps, input.flags.enableMaxStepsForcing)
    progress.toolsDisabled = forced
    const sentItems = forced
      ? [...preparation.preparedItems, newItem("system_prompt", this.maxStepsPrompt)]
      : preparation.preparedItems

    // Gate 3: stop conditions before every provider attempt (retries included), then one model call with retry.
    const stopBefore = (attempts: readonly AttemptRecord[]) => {
      const spent = sumUsage(attempts)
      const evaluation = evaluateStop(
        {
          ...input.stopState,
          costUsd: input.stopState.costUsd + spent.costUsd,
          totalTokens: input.stopState.totalTokens + spent.totalTokens,
        },
        input.limits,
        deps.clock.nowMs(),
      )
      progress.observedLimits = evaluation.observed
      return evaluation.selected
    }
    const stopNow = stopBefore([])
    if (stopNow !== undefined) return finish({ type: "budget_exhausted", reason: stopNow })
    await persist("step.started", { stepIndex: input.stepIndex, toolsDisabled: forced })

    const retried: RetryOutcome = await deps.retryPolicy
      .run({
        request: {
          runId,
          stepIndex: input.stepIndex,
          profileId: input.profileId,
          items: sentItems,
          ...(forced ? { toolsDisabled: true } : {}),
        },
        deadlineMs: input.stopState.startedAtMs + input.limits.wallClockTimeoutMs,
        signal: input.signal,
        beforeRetry: stopBefore,
        // Each attempt is charged and persisted as it happens, so a later rejection cannot lose its spend.
        onAttempt: async (attempt) => {
          progress.attempts = [...progress.attempts, attempt]
          await persist("provider.attempted", attemptPayload(input.stepIndex, "reasoning", input.profileId, attempt))
        },
      })
      .catch(asFault("worker_interrupted"))
    progress.attempts = retried.attempts

    if (retried.kind === "failed")
      return finish({
        type: "failed",
        error: `provider attempt failed: ${bounded(retried.error.message, 500)}`,
        reason: retried.reason,
      })
    if (retried.kind === "context_overflow") {
      progress.observedLimits = withObserved("context_budget_exhausted", progress.observedLimits)
      return finish({ type: "budget_exhausted", reason: "context_budget_exhausted" })
    }
    if (retried.kind === "stopped") {
      progress.observedLimits = withObserved(retried.reason, progress.observedLimits)
      return finish({ type: "budget_exhausted", reason: retried.reason })
    }
    if (retried.kind === "cancelled")
      return finish(
        { type: "failed", error: "cancelled while waiting to retry the provider", reason: "cancelled_by_user" },
        { cancelledAt: "before_provider_call" },
      )
    const { response } = retried
    const responded = retried.attempts[retried.attempts.length - 1]
    await persist("model.responded", {
      stepIndex: input.stepIndex,
      attemptIndex: responded.attemptIndex,
      finishReason: response.finishReason,
      toolCallCount: response.toolCalls?.length ?? 0,
    })

    // Gate 4: the engine learns the real usage of the successful attempt; the budget it sees includes failed ones.
    const failedSpend = sumUsage(retried.attempts.slice(0, -1))
    await deps.contextEngine
      .record({
        actualUsage: {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
        },
        modelLimits: input.modelLimits,
        budget: {
          ...input.budget,
          totalTokensUsed: input.budget.totalTokensUsed + failedSpend.totalTokens,
          costUsd: input.budget.costUsd + failedSpend.costUsd,
        },
      })
      .catch(asFault("worker_interrupted"))

    const text = response.content ?? ""
    const reasoning = text.trim() === "" ? [] : [newItem("assistant_reasoning", text)]
    const calls = response.toolCalls ?? []

    // Gate 5: text without tool calls is the verdict.
    if (calls.length === 0) {
      const synthesis = await synthesizeVerdict(
        { snapshot: deps.snapshot, security: deps.security },
        {
          text,
          runId,
          findingId: input.findingId,
          snapshotId: input.snapshotId,
          traceDigest: input.traceDigest,
          enableSchemaRepair: input.flags.enableSchemaRepair,
          repairsUsed: input.repairsUsed,
          signal: input.signal,
        },
      ).catch(asFault("worker_interrupted"))
      if (synthesis.kind === "accepted") return finish({ type: "completed", verdict: synthesis.verdict })
      await persist("verdict.validation_failed", {
        attempt: synthesis.attempt,
        issues: synthesis.issues.map((issue) => ({ reason: issue.reason, path: issue.path })),
      })
      if (synthesis.kind === "rejected")
        return finish({
          type: "failed",
          error: input.flags.enableSchemaRepair
            ? `the verdict failed validation ${synthesis.attempt} times and no repair is left`
            : "the verdict failed validation and schema repair is disabled",
          reason: "schema_repair_exhausted",
        })
      return finish(
        { type: "continue_turn", toolOutcomes: [] },
        {
          newItems: [...reasoning, newItem("system_prompt", synthesis.feedback)],
          repairsUsed: input.repairsUsed + 1,
        },
      )
    }

    // Gates 6 and 7: tools, then security filter before shaping, per call in index order.
    const branch = await runToolBranch({ deps, input, persist, newItem, toolsDisabled: forced }, calls)
    if (branch.kind === "cancelled")
      return finish(
        { type: "failed", error: "cancelled before tool dispatch", reason: "cancelled_by_user" },
        { cancelledAt: branch.boundary },
      )
    return finish(
      { type: "continue_turn", toolOutcomes: branch.outcomes },
      { newItems: [...reasoning, ...branch.items] },
    )
  }
}
