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
  type ModelAttemptRequest,
  type ModelAttemptResponse,
  type ModelGatewayPort,
  type ModelToolCall,
  type ModelUsage,
  type RunClaim,
  type RunRecord,
  type RunState,
  type RunStorePort,
  type SourceSnapshotPort,
  type TerminalReason,
  type TerminalRunState,
  type ToolRegistryPort,
  type ToolLimits,
} from "@harness/protocol"
import { EventSink } from "./event-sink"
import { ParallelToolDispatcher } from "../tool/dispatcher"
import { assembleTurnRequest } from "./request-assembly"
import { evaluateStop, initialNoProgress, type StopState } from "./stop-conditions"
import { buildRunConfigSnapshot } from "./run-config"
import { hydrateHistory, interruptedToolItems } from "./history-hydrator"
import { sha256Hex } from "../util/digest"
import { createIdGenerator, systemIdSources, type IdGenerator } from "../util/id"
import { sanitizeSourceContent, sanitizeSystemText } from "../util/sanitize"
import { estimateTokens } from "../context/token-estimator"

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
  observedLimits: BudgetTerminalReason[]
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
  skippedFiles?: () => Promise<Array<{ path: string; reason: string }>>
  estimatePromptTokens?: (request: ModelAttemptRequest) => number
  estimateCostUsd?: (profileId: string, promptTokens: number, outputTokens: number) => number | undefined
}

const defaultBudgetLimits: BudgetLimits = {
  wallClockTimeoutMs: 60_000,
  costCeilingUsd: 5,
  totalTokenBudget: 200_000,
  maxSteps: 10,
  maxToolCalls: 20,
  noProgressMaxRepeats: 3,
}

interface ExecutionRecovery {
  idGen: IdGenerator
  clock: ClockPort
  startedAtMs: number
  workerId: string
  claim?: RunClaim
  usage: ModelUsage
  stepsExecuted: number
  toolCallsExecuted: number
  observedLimits: BudgetTerminalReason[]
}

const sanitizeModelValue = (value: unknown, secrets: readonly string[]): unknown => {
  if (typeof value === "string") return sanitizeSystemText(value, secrets)
  if (Array.isArray(value)) return value.map((item) => sanitizeModelValue(item, secrets))
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, sanitizeModelValue(inner, secrets)]),
    )
  }
  return value
}

export class MultiTurnRunner {
  private readonly approval: ToolApprovalPort

  constructor(private readonly deps: MultiTurnRunnerDeps) {
    this.approval = deps.approval ?? new HeadlessToolApproval()
  }

  async execute(input: MultiTurnRunInput): Promise<MultiTurnRunResult> {
    let runId = input.runId ?? "run_unknown"
    let recovery: ExecutionRecovery | undefined
    try {
      const clock = this.deps.clock ?? { nowMs: () => Date.now() }
      const idGen = this.deps.idGenerator ?? createIdGenerator(systemIdSources)
      recovery = {
        idGen,
        clock,
        startedAtMs: 0,
        workerId: input.workerId ?? "multi-turn-worker",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
        stepsExecuted: 0,
        toolCallsExecuted: 0,
        observedLimits: [],
      }
      if (input.runId === undefined) runId = idGen.next("run_")
      recovery.startedAtMs = clock.nowMs()
      return await this.executeRun({ ...input, runId }, recovery)
    } catch {
      if (recovery === undefined) {
        return {
          runId,
          state: "failed",
          terminalReason: "persistence_failure",
          error: "Run failed because an unexpected execution or persistence error occurred.",
          stepsExecuted: 0,
          toolCallsExecuted: 0,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
          latencyMs: 0,
          observedLimits: [],
        }
      }
      try {
        return await this.recoverUnexpected(runId, recovery)
      } catch {
        return {
          runId,
          state: "failed",
          terminalReason: "persistence_failure",
          error: "Run failed because an unexpected execution or persistence error occurred.",
          stepsExecuted: recovery.stepsExecuted,
          toolCallsExecuted: recovery.toolCallsExecuted,
          usage: recovery.usage,
          latencyMs: 0,
          observedLimits: [],
        }
      }
    }
  }

  private async executeRun(
    input: MultiTurnRunInput & { runId: string },
    recovery: ExecutionRecovery,
  ): Promise<MultiTurnRunResult> {
    const { clock, idGen, startedAtMs: initialStartTime, workerId } = recovery
    let startTime = initialStartTime
    const runId = input.runId
    const profileId = input.profileId ?? "default"
    const secrets = [...(this.deps.secrets ?? []), ...(input.secrets ?? [])]
    const safePrompt = sanitizeSystemText(input.prompt, secrets)

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

    const maxPromptLength = input.maxPromptLength ?? 100_000
    if (input.prompt.length > maxPromptLength) {
      return this.failEarly(runId, "Prompt length exceeds maximum allowed characters", "invalid_input")
    }

    const registryMetadata = this.deps.registry as ToolRegistryPort & {
      readonly snapshotId?: string
      limits?: () => ToolLimits
    }
    if (registryMetadata.snapshotId !== undefined && registryMetadata.snapshotId !== input.snapshotId) {
      return this.failEarly(runId, "Tool registry is bound to a different source snapshot", "invalid_input")
    }

    let existingRun: RunRecord | undefined
    let existingEvents: Awaited<ReturnType<RunStorePort["loadEvents"]>> = []
    if (input.runId !== undefined) {
      existingRun = await this.deps.store.loadRun(runId)
      existingEvents = await this.deps.store.loadEvents({ runId })
      if (existingRun !== undefined || existingEvents.length > 0) {
        if (
          existingRun === undefined ||
          existingRun.snapshotId !== input.snapshotId ||
          existingRun.prompt !== safePrompt
        ) {
          return this.failEarly(runId, "Run identity does not match the supplied prompt and snapshot", "invalid_input")
        }
      }
    }

    // 2. Validate snapshot access only after all input and resume identity checks.
    let availableFiles: string[] = []
    let skippedFiles: Array<{ path: string; reason: string }> = []
    try {
      availableFiles = await this.deps.snapshot.listFiles({ snapshotId: input.snapshotId })
      skippedFiles = (await this.deps.skippedFiles?.()) ?? []
    } catch (err) {
      const message = sanitizeSystemText(err instanceof Error ? err.message : String(err), secrets)
      return this.failEarly(runId, `Cannot access snapshot "${input.snapshotId}": ${message}`, "snapshot_integrity")
    }

    // 3. Register and claim run in store.
    if (existingRun === undefined && "seedRun" in this.deps.store && typeof this.deps.store.seedRun === "function") {
      try {
        await Promise.resolve(this.deps.store.seedRun(runId, "queued", safePrompt, input.snapshotId))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/already exists/i.test(message)) throw error
        existingRun = await this.deps.store.loadRun(runId)
        existingEvents = await this.deps.store.loadEvents({ runId })
        if (
          existingRun === undefined ||
          existingRun.snapshotId !== input.snapshotId ||
          existingRun.prompt !== safePrompt
        ) {
          return this.failEarly(runId, "Run identity does not match the supplied prompt and snapshot", "invalid_input")
        }
      }
    }

    const claimResult = await this.deps.store.claim({ runId, workerId })
    if (claimResult.kind !== "claimed") {
      return this.failEarly(runId, `Failed to claim run: ${claimResult.kind}`, "work_handoff_failure")
    }

    const claim: RunClaim = claimResult.claim
    let stateVersion = claimResult.stateVersion
    recovery.claim = claim

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
      ...(typeof registryMetadata.limits === "function" ? { toolLimits: registryMetadata.limits() } : {}),
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

    existingEvents = await this.deps.store.loadEvents({ runId })
    const isResumed = existingEvents.length > 0
    if (isResumed) {
      const startedEvent = existingEvents.find((event) => event.type === "run.started")
      if (startedEvent !== undefined) {
        const restoredStartTime = Date.parse(startedEvent.occurredAt)
        if (Number.isFinite(restoredStartTime)) startTime = restoredStartTime
      }
      recovery.startedAtMs = startTime
    }

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
        prompt: safePrompt,
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
      if (hydration.kind !== "hydrated") {
        return this.finishRun({
          claim,
          expectedStateVersion: stateVersion,
          nextState: "failed",
          runId,
          observedLimits: recovery.observedLimits,
          terminalReason: "persistence_failure",
          eventSink,
          error: "Stored run history could not be hydrated",
          stepsExecuted: 0,
          toolCallsExecuted: 0,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
          latencyMs: clock.nowMs() - startTime,
        })
      }
      if (hydration.kind === "hydrated") {
        completedToolCalls = hydration.history.items.filter((item) => item.type === "tool_result").length
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
                observedLimits: recovery.observedLimits,
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
        prompt: safePrompt,
        snapshotId: input.snapshotId,
        availableFiles,
        skippedFiles,
        registry: this.deps.registry,
        historyItems: [],
        maxToolCalls: limits.maxToolCalls,
        maxOutputTokens: input.maxOutputTokens,
        maxSourceEntries: input.maxSourceEntries,
        temperature: input.temperature,
        seed: input.seed,
        secrets,
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
            observedLimits: recovery.observedLimits,
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
    let terminalObservedLimits: BudgetTerminalReason[] = []
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
        terminalObservedLimits = stopEvaluation.observed.map((reason) => StopReasonToTerminalReason[reason])
        recovery.observedLimits = terminalObservedLimits
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
          observedLimits: recovery.observedLimits,
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
        prompt: safePrompt,
        snapshotId: input.snapshotId,
        availableFiles,
        skippedFiles,
        registry: this.deps.registry,
        historyItems,
        maxToolCalls: limits.maxToolCalls,
        maxOutputTokens: input.maxOutputTokens,
        maxSourceEntries: input.maxSourceEntries,
        temperature: input.temperature,
        seed: input.seed,
        secrets,
      })

      const estimatedPromptTokens = this.deps.estimatePromptTokens?.(request) ??
        estimateTokens(JSON.stringify({ items: request.items, tools: request.tools }) ?? "")
      const outputTokens = input.maxOutputTokens ?? 0
      const preCallLimits: BudgetTerminalReason[] = []
      if (limits.totalTokenBudget - totalTokens < estimatedPromptTokens + outputTokens) {
        preCallLimits.push("total_tokens")
      }
      const estimatedCostUsd = this.deps.estimateCostUsd?.(profileId, estimatedPromptTokens, outputTokens)
      if (estimatedCostUsd !== undefined && estimatedCostUsd > limits.costCeilingUsd - costUsd) {
        preCallLimits.push("cost_budget")
      }
      if (preCallLimits.length > 0) {
        terminalState = "budget_exhausted"
        terminalReason = preCallLimits[0]
        terminalObservedLimits = preCallLimits
        recovery.observedLimits = preCallLimits
        isTerminated = true
        break
      }

      const attemptStartTime = clock.nowMs()
      const elapsedMs = Math.max(0, attemptStartTime - startTime)
      const remainingTime = Math.max(1, limits.wallClockTimeoutMs - elapsedMs)
      const attemptSignal = AbortSignal.timeout(remainingTime)

      // Execute attempt via Gateway
      const rawResponse = await this.deps.gateway.executeAttempt(request, attemptSignal)
      const response: ModelAttemptResponse = {
        ...rawResponse,
        ...(rawResponse.content !== undefined ? { content: sanitizeSystemText(rawResponse.content, secrets) } : {}),
        ...(rawResponse.toolCalls !== undefined
          ? {
              toolCalls: rawResponse.toolCalls.map((call) => ({
                ...call,
                arguments: sanitizeModelValue(call.arguments, secrets) as Record<string, unknown>,
              })),
            }
          : {}),
        ...(rawResponse.error !== undefined
          ? { error: { ...rawResponse.error, message: sanitizeSystemText(rawResponse.error.message, secrets) } }
          : {}),
      }
      const attemptLatencyMs = Math.max(0, clock.nowMs() - attemptStartTime)

      promptTokens += response.usage.promptTokens
      completionTokens += response.usage.completionTokens
      totalTokens += response.usage.totalTokens
      costUsd += response.usage.costUsd
      recovery.usage = { promptTokens, completionTokens, totalTokens, costUsd }
      recovery.stepsExecuted = stepIndex
      recovery.toolCallsExecuted = completedToolCalls
      stopState.startedAtMs = startTime
      stopState.completedSteps = stepIndex
      stopState.completedToolCalls = completedToolCalls
      stopState.costUsd = costUsd
      stopState.totalTokens = totalTokens
      recovery.observedLimits = evaluateStop(stopState, limits, clock.nowMs()).observed.map(
        (reason) => StopReasonToTerminalReason[reason],
      )

      // Persist the attempt row before the matching provider.attempted event.
      if (
        "recordModelAttempt" in this.deps.store &&
        typeof (this.deps.store as Record<string, unknown>).recordModelAttempt === "function"
      ) {
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
                prompt: safePrompt,
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
            observedLimits: recovery.observedLimits,
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
          observedLimits: recovery.observedLimits,
          terminalReason: "work_handoff_failure",
          eventSink,
          error: `Failed to persist provider.attempted: ${appendAttempt.reason}`,
          stepsExecuted: stepIndex,
          toolCallsExecuted: completedToolCalls,
          usage: { promptTokens, completionTokens, totalTokens, costUsd },
          latencyMs: clock.nowMs() - startTime,
        })
      }
      if (response.error || response.finishReason === "error") {
        const errorCategory = response.error?.category ?? "transport"
        const providerTerminalReason =
          errorCategory === "rate_limit" || errorCategory === "transport"
            ? "provider_transient_primary"
            : "provider_permanent"
        await safeAppend("provider.failed", {
          profileId,
          errorCategory,
          errorMessage: response.error?.message ?? "Provider execution failed",
          latencyMs: attemptLatencyMs,
        })
        return this.finishRun({
          claim,
          expectedStateVersion: stateVersion,
          nextState: "failed",
          runId,
          observedLimits: recovery.observedLimits,
          terminalReason: providerTerminalReason,
          eventSink,
          error: response.error?.message ?? "Provider execution failed",
          errorCategory,
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
          observedLimits: recovery.observedLimits,
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
      stopState.startedAtMs = startTime
      stopState.completedSteps = stepIndex
      stopState.completedToolCalls = completedToolCalls
      stopState.costUsd = costUsd
      stopState.totalTokens = totalTokens
      const responseStopEvaluation = evaluateStop(stopState, limits, clock.nowMs())
      terminalObservedLimits = responseStopEvaluation.observed.map(
        (reason) => StopReasonToTerminalReason[reason],
      )
      recovery.observedLimits = terminalObservedLimits

      const hasToolCalls = response.toolCalls !== undefined && response.toolCalls.length > 0
      if (!hasToolCalls) {
        finalOutput = response.content
        isTerminated = true
        break
      }
      if (responseStopEvaluation.selected !== undefined) {
        terminalState = "budget_exhausted"
        terminalReason = StopReasonToTerminalReason[responseStopEvaluation.selected]
        finalOutput = response.content
        isTerminated = true
        break
      }

      // Process tool calls
      const toolCalls = response.toolCalls ?? []
      if (limits.maxToolCalls !== undefined && completedToolCalls + toolCalls.length > limits.maxToolCalls) {
        terminalState = "budget_exhausted"
        terminalReason = "max_tool_calls"
        terminalObservedLimits = [...new Set<BudgetTerminalReason>([...terminalObservedLimits, "max_tool_calls"])]
        recovery.observedLimits = terminalObservedLimits
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

      // Dispatch tool calls and persist each request/result before its completion event.
      const dispatchOutcome = await dispatcher.dispatch({
        calls: toolCalls,
        signal: attemptSignal,
        onResult: async (dispatchedCall) => {
          const isError = dispatchedCall.failureKind !== undefined || dispatchedCall.result.isError
          const sanitizedContent = isError
            ? sanitizeSystemText(dispatchedCall.result.content, secrets)
            : sanitizeSourceContent(dispatchedCall.result.content, secrets)
          dispatchedCall.result = { ...dispatchedCall.result, content: sanitizedContent }

          const requestItem: ContextItem = {
            id: idGen.next("ctx_req_"),
            turn: stepIndex,
            type: "tool_request",
            isPinned: false,
            content: sanitizeSystemText(JSON.stringify(dispatchedCall.arguments), secrets),
            toolMeta: { callId: dispatchedCall.callId, toolName: dispatchedCall.toolName },
          }
          const resultItem: ContextItem = {
            id: idGen.next("ctx_res_"),
            turn: stepIndex,
            type: "tool_result",
            isPinned: false,
            content: sanitizedContent,
            toolMeta: {
              callId: dispatchedCall.callId,
              toolName: dispatchedCall.toolName,
              isError: dispatchedCall.result.isError,
            },
          }

          const appendRequest = await eventSink.append("context.item_added", { item: requestItem })
          if (appendRequest.kind === "stale") return { kind: "stale", reason: appendRequest.reason }
          const appendResult = await eventSink.append("context.item_added", { item: resultItem })
          if (appendResult.kind === "stale") return { kind: "stale", reason: appendResult.reason }
          historyItems.push(requestItem, resultItem)

          if (dispatchedCall.failureKind !== undefined) {
            const failed = await eventSink.append("tool.failed", {
              callIndex: dispatchedCall.callIndex,
              callId: dispatchedCall.callId,
              toolName: dispatchedCall.toolName,
              durationMs: dispatchedCall.durationMs,
              message: sanitizeSystemText(sanitizedContent, secrets),
              itemId: resultItem.id,
            })
            if (failed.kind === "stale") return { kind: "stale", reason: failed.reason }
          } else {
            const completed = await eventSink.append("tool.completed", {
              callIndex: dispatchedCall.callIndex,
              callId: dispatchedCall.callId,
              toolName: dispatchedCall.toolName,
              durationMs: dispatchedCall.durationMs,
              isTruncated: dispatchedCall.result.isTruncated === true,
              itemId: resultItem.id,
            })
            if (completed.kind === "stale") return { kind: "stale", reason: completed.reason }
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
          observedLimits: recovery.observedLimits,
          terminalReason: "work_handoff_failure",
          eventSink,
          error: `Claim lost during tool dispatch: ${dispatchOutcome.reason}`,
          stepsExecuted: stepIndex,
          toolCallsExecuted: completedToolCalls,
          usage: { promptTokens, completionTokens, totalTokens, costUsd },
          latencyMs: clock.nowMs() - startTime,
        })
      }
      completedToolCalls += dispatchOutcome.calls.length
      recovery.toolCallsExecuted = completedToolCalls
      stepIndex += 1
      recovery.stepsExecuted = stepIndex - 1
    }

    if (!isTerminated && stepIndex > limits.maxSteps) {
      terminalState = "budget_exhausted"
      terminalReason = "max_steps"
    }

    // 6. Complete terminal transition
    const totalLatencyMs = Math.max(0, clock.nowMs() - startTime)

    const isBudgetExhausted =
      terminalReason !== undefined && (BudgetTerminalReasons as readonly string[]).includes(terminalReason)
    if (isBudgetExhausted) {
      terminalState = "budget_exhausted"
      await safeAppend("run.budget_exhausted", {
        reason: terminalReason as BudgetTerminalReason,
        observedLimits:
          terminalObservedLimits.length > 0 ? terminalObservedLimits : [terminalReason as BudgetTerminalReason],
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
        error: sanitizeSystemText(`Final state transition failed: ${finalTransition.reason}`),
        stepsExecuted: Math.min(stepIndex, limits.maxSteps),
        toolCallsExecuted: completedToolCalls,
        usage: { promptTokens, completionTokens, totalTokens, costUsd },
        latencyMs: totalLatencyMs,
        observedLimits: terminalObservedLimits,
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
      observedLimits: terminalObservedLimits,
    }
  }

  private async recoverUnexpected(runId: string, recovery: ExecutionRecovery): Promise<MultiTurnRunResult> {
    try {
      let record = await this.deps.store.loadRun(runId)
      let claim = recovery.claim
      if (claim === undefined && record !== undefined) {
        const claimResult = await this.deps.store.claim({
          runId,
          workerId: `${recovery.workerId}-recovery`,
        })
        if (claimResult.kind === "claimed") claim = claimResult.claim
        record = await this.deps.store.loadRun(runId)
      }
      if (
        claim !== undefined &&
        record !== undefined &&
        record.state !== "completed" &&
        record.state !== "failed" &&
        record.state !== "cancelled" &&
        record.state !== "budget_exhausted"
      ) {
        await this.deps.store.transition({
          claim,
          expectedState: record.state,
          expectedStateVersion: record.stateVersion,
          nextState: "failed",
          terminalReason: "persistence_failure",
          errorMessage: "Run failed because an unexpected execution or persistence error occurred.",
          totalTokens: recovery.usage.totalTokens,
          costUsd: recovery.usage.costUsd,
          latencyMs: Math.max(0, recovery.clock.nowMs() - recovery.startedAtMs),
        })
      }
    } catch {
      // The result still resolves when the store is the source of the unexpected error.
    }

    return {
      runId,
      state: "failed",
      terminalReason: "persistence_failure",
      error: "Run failed because an unexpected execution or persistence error occurred.",
      stepsExecuted: recovery.stepsExecuted,
      toolCallsExecuted: recovery.toolCallsExecuted,
      usage: recovery.usage,
      latencyMs: Math.max(0, recovery.clock.nowMs() - recovery.startedAtMs),
      observedLimits: recovery.observedLimits,
    }
  }
  private failEarly(runId: string, error: string, terminalReason: TerminalReason): MultiTurnRunResult {
    return {
      runId,
      state: "failed",
      terminalReason,
      error: sanitizeSystemText(error),
      stepsExecuted: 0,
      toolCallsExecuted: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
      latencyMs: 0,
      observedLimits: [],
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
    observedLimits?: BudgetTerminalReason[]
  }): Promise<MultiTurnRunResult> {
    const safeError = opts.error === undefined ? undefined : sanitizeSystemText(opts.error)
    if (opts.nextState === "failed" && opts.eventSink) {
      try {
        await opts.eventSink.append("run.failed", {
          reason: opts.terminalReason ?? "provider_permanent",
          message: safeError ?? "Run failed",
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
      errorMessage: safeError,
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
        error: sanitizeSystemText(`Transition to ${opts.nextState} failed: ${transRes.reason}`),
        stepsExecuted: opts.stepsExecuted,
        toolCallsExecuted: opts.toolCallsExecuted,
        usage: opts.usage,
        latencyMs: opts.latencyMs,
        observedLimits: opts.observedLimits ?? [],
      }
    }

    return {
      runId: opts.runId,
      state: opts.nextState,
      terminalReason: opts.terminalReason,
      error: safeError,
      errorCategory: opts.errorCategory,
      stepsExecuted: opts.stepsExecuted,
      toolCallsExecuted: opts.toolCallsExecuted,
      usage: opts.usage,
      latencyMs: opts.latencyMs,
      observedLimits: opts.observedLimits ?? [],
    }
  }
}
