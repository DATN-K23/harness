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
import { RunStateProbeToolName, claimFromItems } from "../judge/adjudication-step"
import {
  ConsensusVerdictInstruction,
  consensusNote,
  decideConsensus,
  directionLimitPrompt,
  directionPrompt,
  parseBackwardResult,
  parseForwardResult,
  readVerificationState,
  resultNote,
  type BackwardResult,
  type ForwardResult,
  type VerificationDirection,
  type VerificationState,
} from "../judge/bidirectional-verifier"
import { DefaultVerificationStepBudget, stepsStillNeeded } from "../judge/step-budget"
import { offersSubmission, submitVerificationTool, submittedText } from "../judge/structured-output"
import { unverifiedVerdict, withheldVerdict } from "../judge/unverified-verdict"
import { MaxSchemaRepairs, synthesizeVerdict } from "../judge/verdict-synthesizer"
import { loadPrompt } from "../prompts/index"
import { digestOf } from "../util/digest"
import { parseJsonObject } from "../util/json-object"
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
  probeEvidence?: Map<string, { before: string; after: string }>
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
  /** Steps one verification direction may take, its answer included; defaults to `DefaultVerificationStepBudget`. */
  verificationStepBudget?: number
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

const ProbeDeltaMarker = "State delta, post minus pre:"

const NoDirectionAnswer = "No result was given within this direction's step budget; the evidence read so far is recorded."

const unanswered = (direction: VerificationDirection): (ForwardResult | BackwardResult) & { explanation: string } =>
  direction === "forward"
    ? { reachability: "incomplete", explanation: NoDirectionAnswer }
    : { reconstruction: "incomplete", explanation: NoDirectionAnswer }

const WitnessInstruction =
  `For disputed consensus, call ${RunStateProbeToolName} at most once for exactly one state variable explicitly named in the claim. In your final JSON verdict include targetedCondition equal to the requested expression, observedBefore and observedAfter exactly as reported by that probe, and deltaExplanation (at least 20 characters) explaining why that measured change does or does not establish the claimed condition. Snapshot citations support source behavior, not the dynamic delta; process exit alone is not proof. Do not create or modify tests.`

/** The bounded witness of a disputed or inconclusive consensus, as far as the context shows it. */
const witnessOf = (input: JudgeStepInput) => ({
  offered: input.tools.definitions().some((tool) => tool.name === RunStateProbeToolName),
  request: input.items.findLast((item) => item.type === "tool_request" && item.toolMeta?.toolName === RunStateProbeToolName),
  result: input.items.findLast((item) => item.type === "tool_result" && item.toolMeta?.toolName === RunStateProbeToolName),
})

/** The single state expression the witness was asked to measure, or `undefined` when the request is unusable. */
const probedTarget = (request: ContextItem | undefined) => {
  const requested = request === undefined ? undefined : parseJsonObject(request.content)
  const targets = (requested?.arguments as { stateVariables?: unknown } | undefined)?.stateVariables
  return Array.isArray(targets) && targets.length === 1 ? String(targets[0]) : undefined
}

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

  /**
   * Outcomes the context already settles, decided before any provider attempt so no tokens are spent on them: a
   * blocking consensus without complete source evidence, and a disputed one whose bounded witness failed or cannot run.
   */
  private decideWithoutModel(
    verification: VerificationState,
    witness: ReturnType<typeof witnessOf>,
  ): { summary: string; reasoning: string } | undefined {
    const { consensus } = verification
    if (consensus === "agreed-invalid" && (verification.bceIncomplete || !verification.hasBceSlices))
      return {
        summary: "The blocking consensus has no source evidence.",
        reasoning:
          "No BCE source citation is available to verify the blocker against the immutable snapshot, so the result remains unresolved.",
      }
    if (consensus !== "disputed" && consensus !== "inconclusive") return undefined
    const failed = witness.result !== undefined && (witness.result.toolMeta?.isError === true || !witness.result.content.includes(ProbeDeltaMarker))
    if (failed || (witness.result === undefined && !witness.offered))
      return {
        summary: "The disputed claim remains unresolved by bounded evidence.",
        reasoning: failed
          ? "The targeted witness did not measure a state delta; execution status alone is not proof."
          : "No bounded witness is available for this run, and the two verification directions do not agree.",
      }
    return undefined
  }

  private async run(input: JudgeStepInput, progress: Progress): Promise<JudgeStepResult> {
    const { deps } = this
    const runId = deps.sink.runId
    const finish = this.finisher(input, progress)
    const persist = persistTo(deps.sink)
    const newItem: ToolBranchContext["newItem"] = (type, content, toolMeta) => ({
      id: deps.ids.next("itm_"), turn: input.stepIndex, type, isPinned: false, content,
      ...(toolMeta === undefined ? {} : { toolMeta }),
    })
    // Verification state is harness-authored and pinned, so neither the model nor compaction can change it.
    const marker = (content: string): ContextItem => ({ ...newItem("system_prompt", content), isPinned: true })
    const identity = { runId, findingId: input.findingId, ...(input.traceDigest === undefined ? {} : { traceDigest: input.traceDigest }) }
    const unresolved = (summary: string, reasoning: string) =>
      finish({ type: "completed", verdict: unverifiedVerdict(identity, "UNRESOLVED", { summary, reasoning }) })
    const verification = readVerificationState(input.items)
    const witness = witnessOf(input)
    const decided = this.decideWithoutModel(verification, witness)
    if (decided !== undefined) return unresolved(decided.summary, decided.reasoning)

    // Gate 1: context preflight. The engine signals; the step decides and never calls the gateway on stop/compaction.
    const request: import("@harness/protocol").ModelAttemptRequest = {
      attemptIndex: 1,
      runId,
      stepIndex: input.stepIndex,
      profileId: input.profileId,
      items: input.items,
      tools: input.tools.definitions(),
      maxOutputTokens: input.modelLimits.maxOutputTokens,
    }
    const preparation = await deps.contextEngine
      .prepare({ items: input.items, request, policy: input.policy, modelLimits: input.modelLimits, budget: input.budget })
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
    if (clean.status === "ready" && clean.preparedRequest !== undefined) {
      request.items = clean.preparedRequest.items
      request.tools = clean.preparedRequest.tools ?? request.tools
    }
    for (const transformation of clean.transformations ?? []) await persist("context.transformed", transformation)
    await persist("context.allocated", {
      stepIndex: input.stepIndex,
      telemetry: { ...clean.telemetry, contentDigest: digestOf(preparation.preparedItems) },
    })

    // Gate 2: step-limit forcing works on a derived list; the engine's preparedItems are never modified. A pending
    // verification direction is forced to answer when its own budget ends, or when the run keeps only the steps the
    // later phases need; it is then asked for its own result, never for a verdict.
    const pending = verification.direction !== undefined && verification[verification.direction] === undefined
      ? verification.direction
      : undefined
    const directionForced =
      pending !== undefined &&
      // This step is step `stepIndex - directionSince` of the direction.
      (input.stepIndex - (verification.directionSince ?? 0) >= (input.verificationStepBudget ?? DefaultVerificationStepBudget) ||
        input.limits.maxSteps - input.stepIndex < stepsStillNeeded(pending))
    const forced = directionForced || isForcedStep(input.stepIndex, input.limits.maxSteps, input.flags.enableMaxStepsForcing)
    progress.toolsDisabled = forced
    const sentItems = forced
      ? [...preparation.preparedItems, newItem("system_prompt", pending !== undefined ? directionLimitPrompt(pending) : this.maxStepsPrompt)]
      : preparation.preparedItems

    // Gate 3: stop conditions before every provider attempt (retries included), then one model call with retry.
    const stopBefore = (attempts: readonly AttemptRecord[]) => {
      const spent = sumUsage(attempts)
      const evaluation = evaluateStop(
        {
          ...input.stopState,
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
          ...request,
          items: sentItems,
          // A structured-output run answers through a submission tool, as OpenCode's json_schema format requires.
          // A forced direction keeps one tool, the result submission, and must call it or answer in text: models that
          // keep calling tools after they were removed (Gemini, measured 2026-10-23) then still give their answer.
          ...(directionForced
            ? { tools: [submitVerificationTool()], toolChoice: "required" as const }
            : forced
              ? { toolsDisabled: true }
              : offersSubmission(request.tools ?? [])
                ? { toolChoice: "required" as const }
                : {}),
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

    // A submission stands for the JSON reply and ends the turn: it is validated like text and never dispatched.
    const submitted = submittedText(response.toolCalls ?? [])
    const text = submitted ?? response.content ?? ""
    const reasoning = text.trim() === "" ? [] : [newItem("assistant_reasoning", text)]
    // Tool calls in a step whose tools were disabled are not dispatched: a forced direction must answer from its evidence.
    const calls = submitted === undefined && !directionForced ? (response.toolCalls ?? []) : []
    const consensus = verification.consensus

    if (consensus === "disputed" || consensus === "inconclusive") {
      const noWitness = () =>
        unresolved(
          "The disputed claim remains unresolved by bounded evidence.",
          "No semantic resolution was established by the targeted witness; execution status alone is not proof.",
        )
      if (witness.result !== undefined) {
        // A measured witness: the verdict must name the probed expression and repeat the measured values exactly.
        const target = probedTarget(witness.request)
        const claim = claimFromItems(input.items)
        if (target === undefined || (!claim?.claimedState.includes(target) && !claim?.claimedImpact.includes(target)))
          return noWitness()
        const verdictInput = parseJsonObject(text)
        const measured = input.probeEvidence?.get(target)
        if (
          measured === undefined ||
          verdictInput?.targetedCondition !== target ||
          verdictInput.observedBefore !== measured.before ||
          verdictInput.observedAfter !== measured.after ||
          typeof verdictInput.deltaExplanation !== "string" ||
          verdictInput.deltaExplanation.trim().length < 20
        )
          return noWitness()
        const witnessed = await synthesizeVerdict(
          { snapshot: deps.snapshot, security: deps.security },
          { text, runId, findingId: input.findingId, snapshotId: input.snapshotId, traceDigest: input.traceDigest,
            enableSchemaRepair: input.flags.enableSchemaRepair, repairsUsed: input.repairsUsed, signal: input.signal },
        ).catch(asFault("worker_interrupted"))
        if (witnessed.kind === "accepted") return finish({ type: "completed", verdict: witnessed.verdict })
        if (witnessed.kind === "repair")
          return finish({ type: "continue_turn", toolOutcomes: [] }, {
            newItems: [...reasoning, newItem("system_prompt", witnessed.feedback)], repairsUsed: input.repairsUsed + 1,
          })
        return noWitness()
      }
      const probeCall = calls.find((call) => call.name === RunStateProbeToolName)
      if (witness.request === undefined && probeCall !== undefined && !forced) {
        const branch = await runToolBranch({ deps, input, persist, newItem, toolsDisabled: false }, [probeCall])
        if (branch.kind === "cancelled")
          return finish({ type: "failed", error: "cancelled before witness dispatch", reason: "cancelled_by_user" }, { cancelledAt: branch.boundary })
        return finish({ type: "continue_turn", toolOutcomes: branch.outcomes }, { newItems: [...reasoning, ...branch.items] })
      }
      if (witness.request === undefined && !forced)
        return finish({ type: "continue_turn", toolOutcomes: [] }, { newItems: [newItem("system_prompt", WitnessInstruction)] })
      return noWitness()
    }

    // Bidirectional verification: the pending direction's reply must be its JSON result, never a verdict yet.
    const direction = verification.direction
    if (calls.length === 0 && direction !== undefined && verification[direction] === undefined) {
      const forward = direction === "forward" ? parseForwardResult(text) : undefined
      const backward = direction === "backward" ? parseBackwardResult(text) : undefined
      const answered = forward?.kind === "ok" ? forward.result : backward?.kind === "ok" ? backward.result : undefined
      // A direction forced to answer that still does not is incomplete: missing evidence never becomes a negative.
      const parsed = answered ?? (directionForced ? unanswered(direction) : undefined)
      if (parsed === undefined) {
        const attempt = input.repairsUsed + 1
        const maxRepairs = input.flags.enableSchemaRepair ? MaxSchemaRepairs : 0
        await persist("verdict.validation_failed", { attempt, issues: [{ reason: "SCHEMA_VIOLATION", path: [] }] })
        if (input.repairsUsed >= maxRepairs)
          return finish({ type: "failed", error: "bidirectional output validation failed", reason: "schema_repair_exhausted" })
        const field = direction === "forward" ? "reachability" : "reconstruction"
        return finish({ type: "continue_turn", toolOutcomes: [] }, {
          newItems: [
            ...reasoning,
            newItem("system_prompt", `Return only JSON with the required ${field} and explanation fields for the ${direction} direction. Validation attempt ${attempt}.`),
          ],
          repairsUsed: input.repairsUsed + 1,
        })
      }
      const resultItem = marker(resultNote(direction, parsed))
      const forwardResult = direction === "forward" ? (parsed as ForwardResult) : verification.forward
      const backwardResult = direction === "backward" ? (parsed as BackwardResult) : verification.backward
      if (forwardResult === undefined)
        return finish({ type: "continue_turn", toolOutcomes: [] }, { newItems: [resultItem, marker(directionPrompt("forward"))] })
      if (backwardResult === undefined)
        return finish({ type: "continue_turn", toolOutcomes: [] }, { newItems: [resultItem, marker(directionPrompt("backward"))] })
      const decision = decideConsensus(forwardResult, backwardResult)
      const agreed = decision === "agreed-valid" || decision === "agreed-invalid"
      return finish({ type: "continue_turn", toolOutcomes: [] }, {
        newItems: [resultItem, marker(consensusNote(decision)), ...(agreed ? [newItem("system_prompt", ConsensusVerdictInstruction)] : [])],
      })
    }

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
      if (synthesis.kind === "accepted") {
        if (verification.bceIncomplete && synthesis.verdict.validity !== "unverified")
          return finish({ type: "completed", verdict: withheldVerdict(synthesis.verdict, {
            summary: "The claim remains unresolved because BCE is incomplete.",
            reasoning: "The model's citations resolve to the immutable snapshot, but incomplete BCE cannot establish the claimed path or a blocking guard.",
          }) })
        return finish({ type: "completed", verdict: synthesis.verdict })
      }
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
