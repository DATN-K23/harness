// Adapted from OpenCode packages/core/src/session/runner/llm.ts & prompt.ts @ 3f393d78bf (MIT License). See NOTICE.
import {
  BudgetLimitsSchema,
  BudgetTerminalReasons,
  DefaultRetryConfig,
  StopReasonToTerminalReason,
  type BudgetLimits,
  type BudgetTerminalReason,
  type ClockPort,
  type ContextItem,
  type EventPayload,
  type EventType,
  type ModelAttemptResponse,
  type ModelGatewayPort,
  type ModelToolCall,
  type ModelUsage,
  type RunClaim,
  type RunRecord,
  type RunState,
  type RunStorePort,
  type SourceSnapshotPort,
  type StopReason,
  type TerminalReason,
  type TerminalRunState,
  type ToolRegistryPort,
} from "@harness/protocol"
import { EventSink } from "./event-sink"
import { ParallelToolDispatcher } from "../tool/dispatcher"
import { assembleTurnRequest } from "./request-assembly"
import { evaluateStop, initialNoProgress, type StopState } from "./stop-conditions"
import { buildRunConfigSnapshot } from "./run-config"
import { hydrateHistory, interruptedToolItems } from "./history-hydrator"
import { digestOf, sha256Hex } from "../util/digest"
import { createIdGenerator, systemIdSources, type IdGenerator } from "../util/id"
import { redactSecrets } from "./single-turn-runner"

export interface ToolApprovalPort {
  decide(call: ModelToolCall, ctx: Record<string, unknown>): Promise<"allow" | "deny">
}

export class HeadlessToolApproval implements ToolApprovalPort {
  async decide(): Promise<"allow" | "deny"> {
    return "allow"
  }
}

export interface MultiTurnRunInput {
  prompt: string
  snapshotId: string
  runId?: string
  workerId?: string
  profileId?: string
  limits?: Partial<BudgetLimits>
  maxOutputTokens?: number
  maxSourceEntries?: number
  maxPromptLength?: number
  secrets?: readonly string[]
  temperature?: number
  seed?: number
}

export interface MultiTurnRunResult {
  runId: string
  state: TerminalRunState
  terminalReason?: TerminalReason
  output?: string
  error?: string
  errorCategory?: string
  stepsExecuted: number
  toolCallsExecuted: number
  usage: ModelUsage
  latencyMs: number
}

export interface MultiTurnRunnerDeps {
  store: RunStorePort
  gateway: ModelGatewayPort
  registry: ToolRegistryPort
  snapshot: SourceSnapshotPort
  clock?: ClockPort
  approval?: ToolApprovalPort
  secrets?: readonly string[]
  idGenerator?: IdGenerator
}

const defaultBudgetLimits: BudgetLimits = {
  wallClockTimeoutMs: 60_000,
  costCeilingUsd: 5,
  totalTokenBudget: 200_000,
  maxSteps: 10,
  maxToolCalls: 20,
  noProgressMaxRepeats: 3,
}

export class MultiTurnRunner {
  private readonly approval: ToolApprovalPort

  constructor(private readonly deps: MultiTurnRunnerDeps) {
    this.approval = deps.approval ?? new HeadlessToolApproval()
  }

  async execute(input: MultiTurnRunInput): Promise<MultiTurnRunResult> {
    const clock = this.deps.clock ?? { nowMs: () => Date.now() }
    const idGen = this.deps.idGenerator ?? createIdGenerator(systemIdSources)
    const startTime = clock.nowMs()
    const runId = input.runId ?? idGen.next("run_")
    const workerId = input.workerId ?? "multi-turn-worker"
    const profileId = input.profileId ?? "default"
    const secrets = [...(this.deps.secrets ?? []), ...(input.secrets ?? [])]

    // 1. Validate inputs
    if (!input.prompt || input.prompt.trim().length === 0) {
      return this.failEarly(runId, "Prompt must not be empty", "invalid_input")
    }
    if (!input.snapshotId || input.snapshotId.trim().length === 0) {
      return this.failEarly(runId, "snapshotId must not be empty", "invalid_input")
    }

    const limits: BudgetLimits = BudgetLimitsSchema.parse({
      ...defaultBudgetLimits,
      ...(input.limits ?? {}),
    })

    // 2. Validate snapshot access before initiating run
    let availableFiles: string[] = []
    try {
      availableFiles = await this.deps.snapshot.listFiles({ snapshotId: input.snapshotId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return this.failEarly(runId, `Cannot access snapshot "${input.snapshotId}": ${message}`, "snapshot_integrity")
    }

    // 3. Register and claim run in store
    if ("seedRun" in this.deps.store && typeof this.deps.store.seedRun === "function") {
      try {
        await Promise.resolve(this.deps.store.seedRun(runId, "queued", input.prompt, input.snapshotId))
      } catch {
        // Run may already be seeded in resume scenarios
      }
    }

    const claimResult = await this.deps.store.claim({ runId, workerId })
    if (claimResult.kind !== "claimed") {
      return this.failEarly(runId, `Failed to claim run: ${claimResult.kind}`, "work_handoff_failure")
    }

    const claim: RunClaim = claimResult.claim
    let stateVersion = claimResult.stateVersion

    const eventSink = new EventSink({
      store: this.deps.store,
      claim,
      expectedStateVersion: stateVersion,
      ids: idGen,
      clock,
    })

    const dispatcher = new ParallelToolDispatcher({
      registry: this.deps.registry,
      sink: eventSink,
      clock,
      enableParallelToolDispatch: true,
    })

    // 4. Emit run.started event with config snapshot
    const builtConfig = buildRunConfigSnapshot({
      flags: {
        enableToolTruncation: true,
        enableObsMasking: false,
        enableSupersedeReads: true,
        enableDropEmpty: true,
        enableLlmCompaction: false,
        enableSessionNote: false,
        enableSchemaRepair: false,
        enableMaxStepsForcing: false,
        enableNoProgressDetection: true,
        enableInfraRetry: false,
        enableParallelToolDispatch: true,
      },
      policy: {
        policyVersion: "v1",
        windowLimitTokens: 128_000,
        outputReserveTokens: input.maxOutputTokens ?? 2048,
        compactionThreshold: 0.8,
        recentWindowTokens: 20_000,
        toolOutputMaxTokens: 4_000,
        toolOutputMaxLines: input.maxSourceEntries ?? 100,
        maxCompactions: 0,
        flags: {
          enableToolTruncation: true,
          enableObsMasking: false,
          enableSupersedeReads: true,
          enableDropEmpty: true,
          enableLlmCompaction: false,
          enableSessionNote: false,
        },
      },
      retry: DefaultRetryConfig,
      limits,
      systemPromptDigest: `sha256:${sha256Hex("multi-turn-audit-v1")}`,
      verdictSchemaDigest: `sha256:${sha256Hex("multi-turn-verdict-v1")}`,
    })

    const safeAppend = async <T extends EventType>(type: T, payload: EventPayload<T>) => {
      try {
        const res = await eventSink.append(type, payload)
        if (res.kind === "stale") {
          return { ok: false as const, reason: res.reason }
        }
        return { ok: true as const }
      } catch (err) {
        return { ok: false as const, reason: "persistence_failure" as const, error: err }
      }
    }

    const existingEvents = await this.deps.store.loadEvents({ runId })
    const isResumed = existingEvents.length > 0

    if (!isResumed) {
      const appendStarted = await safeAppend("run.started", {
        snapshot: builtConfig.snapshot,
        snapshotDigest: builtConfig.digest,
      })
      if (!appendStarted.ok) {
        return this.failEarly(runId, `Failed to persist run.started: ${appendStarted.reason}`, "persistence_failure")
      }

      // Transition state from queued to running
      const transRunning = await this.deps.store.transition({
        claim,
        expectedState: "queued",
        expectedStateVersion: stateVersion,
        nextState: "running",
        prompt: input.prompt,
      })
      if (transRunning.kind !== "transitioned") {
        return this.failEarly(runId, "Failed CAS transition to running", "work_handoff_failure")
      }
      stateVersion = transRunning.stateVersion
      eventSink.setExpectedStateVersion(stateVersion)
    }

    const historyItems: ContextItem[] = []
    let stepIndex = 1
    let completedToolCalls = 0
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0
    let costUsd = 0

    if (isResumed) {
      const hydration = hydrateHistory(existingEvents)
      if (hydration.kind === "hydrated") {
        for (const itm of hydration.history.items) {
          if (itm.type === "tool_request" || itm.type === "tool_result") {
            historyItems.push(itm)
          }
        }
        if (hydration.history.pendingToolCalls.length > 0) {
          const recovered = interruptedToolItems(hydration.history.pendingToolCalls, idGen)
          for (const rec of recovered) {
            historyItems.push(rec)
            const app = await safeAppend("context.item_added", { item: rec })
            if (!app.ok) {
              return this.finishRun({
                claim,
                expectedStateVersion: stateVersion,
                nextState: "failed",
                runId,
                terminalReason: "work_handoff_failure",
                eventSink,
                error: `Failed to persist recovered tool item: ${app.reason}`,
                stepsExecuted: 0,
                toolCallsExecuted: 0,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
                latencyMs: clock.nowMs() - startTime,
              })
            }
          }
        }
        stepIndex = Math.max(1, hydration.history.stepIndex + 1)
        promptTokens = hydration.history.totalsFromAttempts.promptTokens
        completionTokens = hydration.history.totalsFromAttempts.completionTokens
        totalTokens = hydration.history.totalsFromAttempts.totalTokens
        costUsd = hydration.history.totalsFromAttempts.costUsd
      }
    } else {
      const initialRequest = assembleTurnRequest({
        runId,
        stepIndex: 1,
        attemptIndex: 1,
        profileId,
        prompt: input.prompt,
        snapshotId: input.snapshotId,
        availableFiles,
        registry: this.deps.registry,
        historyItems: [],
        maxToolCalls: limits.maxToolCalls,
        maxOutputTokens: input.maxOutputTokens,
        maxSourceEntries: input.maxSourceEntries,
        temperature: input.temperature,
        seed: input.seed,
      })

      const initialItems = initialRequest.items.slice(0, 2)
      for (const item of initialItems) {
        const appInit = await safeAppend("context.item_added", { item })
        if (!appInit.ok) {
          return this.finishRun({
            claim,
            expectedStateVersion: stateVersion,
            nextState: "failed",
            runId,
            terminalReason: "work_handoff_failure",
            eventSink,
            error: `Failed to persist initial context item: ${appInit.reason}`,
            stepsExecuted: 0,
            toolCallsExecuted: 0,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
            latencyMs: clock.nowMs() - startTime,
          })
        }
      }
    }

    // 5. Multi-turn loop
    let finalOutput: string | undefined
    let terminalReason: TerminalReason | undefined = undefined
    let terminalState: RunState = "completed"
    let isTerminated = false

    const stopState: StopState = {
      startedAtMs: startTime,
      costUsd: 0,
      totalTokens: 0,
      completedSteps: 0,
      completedToolCalls: 0,
      contextBudgetExhausted: false,
      noProgress: initialNoProgress,
    }

    while (!isTerminated && stepIndex <= limits.maxSteps) {
      stopState.completedSteps = stepIndex - 1
      stopState.completedToolCalls = completedToolCalls
      stopState.costUsd = costUsd
      stopState.totalTokens = totalTokens

      const stopEvaluation = evaluateStop(stopState, limits, clock.nowMs())
      if (stopEvaluation.selected !== undefined) {
        terminalReason = StopReasonToTerminalReason[stopEvaluation.selected]
        isTerminated = true
        break
      }

      // Record step.started event
      const appendStepStarted = await safeAppend("step.started", {
        stepIndex,
        toolsDisabled: false,
      })
      if (!appendStepStarted.ok) {
        return this.finishRun({
          claim,
          expectedStateVersion: stateVersion,
          nextState: "failed",
          runId,
          terminalReason: "work_handoff_failure",
          eventSink,
          error: `Failed to persist step.started: ${appendStepStarted.reason}`,
          stepsExecuted: stepIndex - 1,
          toolCallsExecuted: completedToolCalls,
          usage: { promptTokens, completionTokens, totalTokens, costUsd },
          latencyMs: clock.nowMs() - startTime,
        })
      }

      // Assemble request
      const request = assembleTurnRequest({
        runId,
        stepIndex,
        attemptIndex: 1,
        profileId,
        prompt: input.prompt,
        snapshotId: input.snapshotId,
        availableFiles,
        registry: this.deps.registry,
        historyItems,
        maxToolCalls: limits.maxToolCalls,
        maxOutputTokens: input.maxOutputTokens,
        maxSourceEntries: input.maxSourceEntries,
        temperature: input.temperature,
        seed: input.seed,
      })

      const attemptStartTime = clock.nowMs()
      const remainingTime = Math.max(1, limits.wallClockTimeoutMs - (attemptStartTime - startTime))
      const attemptSignal = AbortSignal.timeout(remainingTime)

      // Execute attempt via Gateway
      const response = await this.deps.gateway.executeAttempt(request, attemptSignal)
      const attemptLatencyMs = Math.max(0, clock.nowMs() - attemptStartTime)

      promptTokens += response.usage.promptTokens
      completionTokens += response.usage.completionTokens
      totalTokens += response.usage.totalTokens
      costUsd += response.usage.costUsd

      // Record provider attempt
      const appendAttempt = await safeAppend("provider.attempted", {
        stepIndex,
        attemptIndex: 1,
        profileId,
        purpose: "reasoning",
        usage: response.usage,
        costUsd: response.usage.costUsd,
        latencyMs: attemptLatencyMs,
        retryDecision: "none",
        backoffMs: 0,
      })
      if (!appendAttempt.ok) {
        return this.finishRun({
          claim,
          expectedStateVersion: stateVersion,
          nextState: "failed",
          runId,
          terminalReason: "work_handoff_failure",
          eventSink,
          error: `Failed to persist provider.attempted: ${appendAttempt.reason}`,
          stepsExecuted: stepIndex,
          toolCallsExecuted: completedToolCalls,
          usage: { promptTokens, completionTokens, totalTokens, costUsd },
          latencyMs: clock.nowMs() - startTime,
        })
      }

      // Duck-typed attempt persistence to model_attempts table
      if ("recordModelAttempt" in this.deps.store && typeof (this.deps.store as Record<string, unknown>).recordModelAttempt === "function") {
        try {
          await Promise.resolve(
            (this.deps.store as { recordModelAttempt: (arg: unknown) => Promise<void> }).recordModelAttempt({
              id: idGen.next("att_"),
              runId,
              stepIndex,
              attemptPurpose: "reasoning",
              attemptNumber: 1,
              provider: profileId.split("/")[0] || "provider",
              model: profileId,
              promptTokens: response.usage.promptTokens,
              completionTokens: response.usage.completionTokens,
              totalTokens: response.usage.totalTokens,
              costUsd: response.usage.costUsd,
              latencyMs: attemptLatencyMs,
              finishReason: response.finishReason,
              requestJson: {
                prompt: input.prompt,
                stepIndex,
                itemsCount: request.items.length,
              },
              responseJson: {
                content: response.content,
                toolCalls: response.toolCalls,
              },
              errorMessage: response.error?.message ?? null,
              errorCategory: response.error?.category ?? null,
            }),
          )
        } catch (attemptErr) {
          return this.finishRun({
            claim,
            expectedStateVersion: stateVersion,
            nextState: "failed",
            runId,
            terminalReason: "persistence_failure",
            eventSink,
            error: `Failed to persist model attempt: ${attemptErr instanceof Error ? attemptErr.message : String(attemptErr)}`,
            stepsExecuted: stepIndex,
            toolCallsExecuted: completedToolCalls,
            usage: { promptTokens, completionTokens, totalTokens, costUsd },
            latencyMs: clock.nowMs() - startTime,
          })
        }
      }

      if (response.error || response.finishReason === "error") {
        await safeAppend("provider.failed", {
          profileId,
          errorCategory: response.error?.category ?? "transport",
          errorMessage: response.error?.message ?? "Provider execution failed",
          latencyMs: attemptLatencyMs,
        })
        return this.finishRun({
          claim,
          expectedStateVersion: stateVersion,
          nextState: "failed",
          runId,
          terminalReason: "provider_permanent",
          eventSink,
          error: response.error?.message ?? "Provider execution failed",
          errorCategory: response.error?.category ?? "transport",
          stepsExecuted: stepIndex,
          toolCallsExecuted: completedToolCalls,
          usage: { promptTokens, completionTokens, totalTokens, costUsd },
          latencyMs: clock.nowMs() - startTime,
        })
      }

      // Record model.responded
      const appendResponded = await safeAppend("model.responded", {
        stepIndex,
        attemptIndex: 1,
        finishReason: response.finishReason,
        toolCallCount: response.toolCalls?.length ?? 0,
      })
      if (!appendResponded.ok) {
        return this.finishRun({
          claim,
          expectedStateVersion: stateVersion,
          nextState: "failed",
          runId,
          terminalReason: "work_handoff_failure",
          eventSink,
          error: `Failed to persist model.responded: ${appendResponded.reason}`,
          stepsExecuted: stepIndex,
          toolCallsExecuted: completedToolCalls,
          usage: { promptTokens, completionTokens, totalTokens, costUsd },
          latencyMs: clock.nowMs() - startTime,
        })
      }

      // Adapted from OpenCode packages/opencode/src/session/prompt.ts lines 1103-1134:
      // Some providers return "stop" even when the assistant message contains tool calls.
      // Keep the loop running so tool results can be sent back to the model.
      const hasToolCalls = (response.toolCalls !== undefined && response.toolCalls.length > 0)
      if (!hasToolCalls) {
        finalOutput = response.content
        isTerminated = true
        break
      }

      // Process tool calls
      const toolCalls = response.toolCalls ?? []
      if (limits.maxToolCalls !== undefined && completedToolCalls + toolCalls.length > limits.maxToolCalls) {
        terminalState = "budget_exhausted"
        terminalReason = "max_tool_calls"
        finalOutput = response.content
        isTerminated = true
        break
      }

      // Tool approval check
      for (const call of toolCalls) {
        const approved = await this.approval.decide(call, { runId, stepIndex })
        if (approved === "deny") {
          terminalState = "cancelled"
          terminalReason = "cancelled_by_user"
          isTerminated = true
          break
        }
      }
      if (isTerminated) break

      // Dispatch tool calls
      const itemIdsByCallId = new Map<string, string>()

      const dispatchOutcome = await dispatcher.dispatch({
        calls: toolCalls,
        signal: attemptSignal,
        onResult: async (dispatchedCall) => {
          const resItemId = idGen.next("ctx_res_")
          itemIdsByCallId.set(dispatchedCall.callId, resItemId)
          const isTruncated = Boolean(
            dispatchedCall.result.isTruncated ??
              (typeof dispatchedCall.result.content === "string" && dispatchedCall.result.content.includes("truncated")),
          )

          if (dispatchedCall.failureKind !== undefined) {
            const app = await eventSink.append("tool.failed", {
              callIndex: dispatchedCall.callIndex,
              callId: dispatchedCall.callId,
              toolName: dispatchedCall.toolName,
              durationMs: dispatchedCall.durationMs,
              message: redactSecrets(dispatchedCall.result.content, secrets),
            })
            if (app.kind === "stale") return { kind: "stale", reason: app.reason }
          } else {
            const app = await eventSink.append("tool.completed", {
              callIndex: dispatchedCall.callIndex,
              callId: dispatchedCall.callId,
              toolName: dispatchedCall.toolName,
              durationMs: dispatchedCall.durationMs,
              isTruncated,
              itemId: resItemId,
            })
            if (app.kind === "stale") return { kind: "stale", reason: app.reason }
          }
          return { kind: "continue" }
        },
      })

      if (dispatchOutcome.kind === "stale") {
        return this.finishRun({
          claim,
          expectedStateVersion: stateVersion,
          nextState: "failed",
          runId,
          terminalReason: "work_handoff_failure",
          eventSink,
          error: `Claim lost during tool dispatch: ${dispatchOutcome.reason}`,
          stepsExecuted: stepIndex,
          toolCallsExecuted: completedToolCalls,
          usage: { promptTokens, completionTokens, totalTokens, costUsd },
          latencyMs: clock.nowMs() - startTime,
        })
      }

      // Append tool requests and tool results to historyItems and persist as context.item_added events
      for (const call of dispatchOutcome.calls) {
        const reqItem: ContextItem = {
          id: idGen.next("ctx_req_"),
          turn: stepIndex,
          type: "tool_request",
          isPinned: false,
          content: redactSecrets(JSON.stringify(call.arguments), secrets),
          toolMeta: {
            callId: call.callId,
            toolName: call.toolName,
          },
        }
        const resItemId = itemIdsByCallId.get(call.callId) ?? idGen.next("ctx_res_")
        const resItem: ContextItem = {
          id: resItemId,
          turn: stepIndex,
          type: "tool_result",
          isPinned: false,
          content: redactSecrets(call.result.content, secrets),
          toolMeta: {
            callId: call.callId,
            toolName: call.toolName,
            isError: call.result.isError,
          },
        }

        // Persist items so history and results can be fully reconstructed on readback / restart
        const appendReq = await safeAppend("context.item_added", { item: reqItem })
        if (!appendReq.ok) {
          return this.finishRun({
            claim,
            expectedStateVersion: stateVersion,
            nextState: "failed",
            runId,
            terminalReason: "work_handoff_failure",
            eventSink,
            error: `Failed to persist context.item_added: ${appendReq.reason}`,
            stepsExecuted: stepIndex,
            toolCallsExecuted: completedToolCalls,
            usage: { promptTokens, completionTokens, totalTokens, costUsd },
            latencyMs: clock.nowMs() - startTime,
          })
        }
        const appendRes = await safeAppend("context.item_added", { item: resItem })
        if (!appendRes.ok) {
          return this.finishRun({
            claim,
            expectedStateVersion: stateVersion,
            nextState: "failed",
            runId,
            terminalReason: "work_handoff_failure",
            eventSink,
            error: `Failed to persist context.item_added: ${appendRes.reason}`,
            stepsExecuted: stepIndex,
            toolCallsExecuted: completedToolCalls,
            usage: { promptTokens, completionTokens, totalTokens, costUsd },
            latencyMs: clock.nowMs() - startTime,
          })
        }

        historyItems.push(reqItem, resItem)
      }

      completedToolCalls += dispatchOutcome.calls.length
      stepIndex += 1
    }

    if (!isTerminated && stepIndex > limits.maxSteps) {
      terminalState = "budget_exhausted"
      terminalReason = "max_steps"
    }

    // 6. Complete terminal transition
    const totalLatencyMs = clock.nowMs() - startTime

    const isBudgetExhausted =
      terminalReason !== undefined && (BudgetTerminalReasons as readonly string[]).includes(terminalReason)
    if (isBudgetExhausted) {
      terminalState = "budget_exhausted"
      await safeAppend("run.budget_exhausted", {
        reason: terminalReason as BudgetTerminalReason,
        observedLimits: [terminalReason as BudgetTerminalReason],
      })
    } else if (terminalState === "cancelled") {
      await safeAppend("run.cancelled", {
        reason: terminalReason ?? "cancelled_by_user",
        boundary: "before_tool_dispatch",
      })
    }

    const finalTransition = await this.deps.store.transition({
      claim,
      expectedState: "running",
      expectedStateVersion: stateVersion,
      nextState: terminalState,
      ...(terminalReason !== undefined ? { terminalReason } : {}),
      resultContent: finalOutput ?? "",
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      latencyMs: totalLatencyMs,
    })

    if (finalTransition.kind !== "transitioned") {
      return {
        runId,
        state: "failed",
        terminalReason: "persistence_failure",
        error: `Final state transition failed: ${finalTransition.reason}`,
        stepsExecuted: Math.min(stepIndex, limits.maxSteps),
        toolCallsExecuted: completedToolCalls,
        usage: { promptTokens, completionTokens, totalTokens, costUsd },
        latencyMs: totalLatencyMs,
      }
    }

    return {
      runId,
      state: terminalState as TerminalRunState,
      terminalReason,
      output: finalOutput,
      stepsExecuted: Math.min(stepIndex, limits.maxSteps),
      toolCallsExecuted: completedToolCalls,
      usage: { promptTokens, completionTokens, totalTokens, costUsd },
      latencyMs: totalLatencyMs,
    }
  }

  private failEarly(runId: string, error: string, terminalReason: TerminalReason): MultiTurnRunResult {
    return {
      runId,
      state: "failed",
      terminalReason,
      error,
      stepsExecuted: 0,
      toolCallsExecuted: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
      latencyMs: 0,
    }
  }

  private async finishRun(opts: {
    claim: RunClaim
    expectedStateVersion: number
    nextState: "completed" | "failed"
    runId: string
    error?: string
    errorCategory?: string
    terminalReason?: TerminalReason
    eventSink?: EventSink
    stepsExecuted: number
    toolCallsExecuted: number
    usage: ModelUsage
    latencyMs: number
  }): Promise<MultiTurnRunResult> {
    if (opts.nextState === "failed" && opts.eventSink) {
      try {
        await opts.eventSink.append("run.failed", {
          reason: opts.terminalReason ?? "provider_permanent",
          message: opts.error ?? "Run failed",
        })
      } catch {
        // Ignore sink errors on failure finalization
      }
    }

    const transRes = await this.deps.store.transition({
      claim: opts.claim,
      expectedState: "running",
      expectedStateVersion: opts.expectedStateVersion,
      nextState: opts.nextState,
      ...(opts.terminalReason !== undefined ? { terminalReason: opts.terminalReason } : {}),
      errorMessage: opts.error,
      errorCategory: opts.errorCategory,
      totalTokens: opts.usage.totalTokens,
      costUsd: opts.usage.costUsd,
      latencyMs: opts.latencyMs,
    })

    if (transRes.kind !== "transitioned") {
      return {
        runId: opts.runId,
        state: "failed",
        terminalReason: "persistence_failure",
        error: `Transition to ${opts.nextState} failed: ${transRes.reason}`,
        stepsExecuted: opts.stepsExecuted,
        toolCallsExecuted: opts.toolCallsExecuted,
        usage: opts.usage,
        latencyMs: opts.latencyMs,
      }
    }

    return {
      runId: opts.runId,
      state: opts.nextState,
      terminalReason: opts.terminalReason,
      error: opts.error,
      errorCategory: opts.errorCategory,
      stepsExecuted: opts.stepsExecuted,
      toolCallsExecuted: opts.toolCallsExecuted,
      usage: opts.usage,
      latencyMs: opts.latencyMs,
    }
  }
}
