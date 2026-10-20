import {
  EventPayloadSchemas,
  TrajectoryEventSchema,
  type BudgetLimits,
  type ContextEnginePort,
  type ContextItem,
  type ContextPolicy,
  type EventPayload,
  type ModelLimits,
  type ModelUsage,
  type ModelAttemptRequest,
  type TrajectoryEvent,
} from "@harness/protocol"
import { RunStateProbeToolName } from "../judge/adjudication-step"
import { NextStepMarker, describeArguments } from "../step/parallel-tool-dispatcher"
import { digestOf } from "../util/digest"
import type { IdGenerator } from "../util/id"
import { describeError } from "./judge-step-support"

export const InterruptedToolMessage = "Tool execution interrupted"

/** A `tool.requested` whose result never reached the context: the worker stopped before the runner added it. */
export interface PendingToolCall {
  stepIndex: number
  callIndex: number
  callId: string
  toolName: string
  arguments: Record<string, unknown>
  rawArguments?: string
  argumentsError?: string
  /** Whether the `tool_request` item of the call is already in the history. */
  hasRequestItem: boolean
}

/** The history as the step that wrote this `context.allocated` event passed it to `prepare`. */
export interface AllocationPoint {
  sequence: number
  stepIndex: number
  contentDigest: string
  requestDigest?: string
  items: ContextItem[]
  totalsFromAttempts: ModelUsage
  compactionsCount: number
}

export interface HydratedHistory {
  /** Raw items in persisted order, with every compaction applied; engine transformations are not applied. */
  items: ContextItem[]
  transformations: Array<EventPayload<"context.transformed">>
  compactionsCount: number
  /** The last step that started (0 when none did); the run continues at `stepIndex + 1`. */
  stepIndex: number
  /** Tokens and cost summed over every `provider.attempted`, failed and compaction attempts included. */
  totalsFromAttempts: ModelUsage
  /** Verdicts that failed validation; each one used a repair unless a terminal event followed it. */
  repairsUsed: number
  /** Requested `run_state_probe` calls; an upper bound on the probe runs used, so recovery never grants extra runs. */
  probeRunsUsed: number
  pendingToolCalls: PendingToolCall[]
  lastAllocated?: AllocationPoint
  allocations: AllocationPoint[]
  /** A terminal event is persisted but the run is still `running`: finish the transition, make no model call. */
  terminalPending?: TrajectoryEvent
  lastSequence: number
}

export type Hydration =
  | { kind: "hydrated"; history: HydratedHistory }
  | { kind: "corrupt"; reason: "persistence_failure"; message: string }

export type HydrationCheck =
  | { kind: "verified" }
  | {
      kind: "mismatch"
      reason: "persistence_failure"
      message: string
      expectedDigest: string
      actualDigest?: string
    }

const TerminalEventTypes: ReadonlySet<string> = new Set([
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.budget_exhausted",
])

const zeroUsage: ModelUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }

const callKey = (stepIndex: number, callId: string) => `${stepIndex}\u0000${callId}`

/**
 * Replaces the summarized items with one `compaction_summary` item at the position of the first replaced item. The
 * runner applies a compaction with this function and hydration replays `context.compacted` with it, so both agree.
 */
export const applyCompaction = (
  items: readonly ContextItem[],
  replacedItemIds: readonly string[],
  summaryItem: ContextItem,
): ContextItem[] => {
  const replaced = new Set(replacedItemIds)
  const at = items.findIndex((item) => replaced.has(item.id))
  const kept = items.filter((item) => !replaced.has(item.id))
  return at === -1 ? [...kept, summaryItem] : kept.toSpliced(at, 0, summaryItem)
}

/**
 * Rebuilds the run state from its events (design 5.9, D8): `context.item_added` and `context.compacted` give the raw
 * items, `context.transformed` the transformation records, `provider.attempted` the totals, `step.started` the step.
 * Events must be the run's full, contiguous history from sequence 1 and satisfy their protocol contracts; anything
 * else is reported as corrupt (fail closed), never repaired.
 */
export const hydrateHistory = (events: readonly TrajectoryEvent[]): Hydration => {
  const corrupt = (message: string): Hydration => ({ kind: "corrupt", reason: "persistence_failure", message })
  const gap = events.findIndex((event, index) => event.sequence !== index + 1)
  if (gap !== -1) return corrupt(`event sequence is not contiguous at position ${gap + 1}`)
  const invalid = events.find((event) => !TrajectoryEventSchema.safeParse(event).success)
  if (invalid !== undefined)
    return corrupt(`event ${invalid.sequence} (${invalid.type}) violates its protocol contract`)

  let items: ContextItem[] = []
  const history: Omit<HydratedHistory, "items" | "pendingToolCalls"> = {
    transformations: [],
    compactionsCount: 0,
    stepIndex: 0,
    totalsFromAttempts: zeroUsage,
    repairsUsed: 0,
    probeRunsUsed: 0,
    lastSequence: events.length,
    allocations: [],
  }
  const requested: Array<Omit<PendingToolCall, "hasRequestItem">> = []
  const requestItems = new Set<string>()
  const resultItems = new Set<string>()

  for (const event of events) {
    if (event.type === "context.item_added") {
      const { item } = EventPayloadSchemas["context.item_added"].parse(event.payload)
      items.push(item)
      if (item.toolMeta !== undefined && item.type === "tool_request")
        requestItems.add(callKey(item.turn, item.toolMeta.callId))
      if (item.toolMeta !== undefined && item.type === "tool_result")
        resultItems.add(callKey(item.turn, item.toolMeta.callId))
    }
    if (event.type === "context.compacted") {
      const compacted = EventPayloadSchemas["context.compacted"].parse(event.payload)
      items = applyCompaction(items, compacted.replacedItemIds, compacted.summaryItem)
      history.compactionsCount += 1
    }
    if (event.type === "context.transformed")
      history.transformations.push(EventPayloadSchemas["context.transformed"].parse(event.payload))
    if (event.type === "context.allocated") {
      const allocated = EventPayloadSchemas["context.allocated"].parse(event.payload)
      const point = {
        sequence: event.sequence,
        stepIndex: allocated.stepIndex,
        contentDigest: allocated.telemetry.contentDigest,
        ...(allocated.telemetry.requestDigest === undefined ? {} : { requestDigest: allocated.telemetry.requestDigest }),
        items: [...items],
        totalsFromAttempts: history.totalsFromAttempts,
        compactionsCount: history.compactionsCount,
      }
      history.allocations.push(point)
      history.lastAllocated = point
    }
    if (event.type === "step.started") {
      const { stepIndex } = EventPayloadSchemas["step.started"].parse(event.payload)
      history.stepIndex = Math.max(history.stepIndex, stepIndex)
    }
      if (event.type === "provider.attempted") {
        const attempt = EventPayloadSchemas["provider.attempted"].parse(event.payload)
        const sum = history.totalsFromAttempts
        const usage = attempt.usage
        history.totalsFromAttempts = {
          promptTokens: sum.promptTokens + (usage?.promptTokens ?? 0),
          completionTokens: sum.completionTokens + (usage?.completionTokens ?? 0),
          totalTokens: sum.totalTokens + (usage?.totalTokens ?? 0),
          costUsd: sum.costUsd + (attempt.costUsd ?? 0),
          ...(sum.pricing === "unpriced" || usage?.pricing === "unpriced" || usage === null ? { pricing: "unpriced" as const } : {}),
      }
    }
    if (event.type === "tool.requested") {
      const call = EventPayloadSchemas["tool.requested"].parse(event.payload)
      requested.push({ stepIndex: history.stepIndex, ...call })
      if (call.toolName === RunStateProbeToolName) history.probeRunsUsed += 1
    }
    if (event.type === "verdict.validation_failed") history.repairsUsed += 1
    if (TerminalEventTypes.has(event.type)) history.terminalPending = event
  }

  const pendingToolCalls = requested
    .filter((call) => !resultItems.has(callKey(call.stepIndex, call.callId)))
    .map((call) => ({ ...call, hasRequestItem: requestItems.has(callKey(call.stepIndex, call.callId)) }))
  return { kind: "hydrated", history: { ...history, items, pendingToolCalls } }
}

/**
 * The items the runner appends for interrupted calls before it continues: the missing `tool_request` items, then one
 * error `tool_result` per call stating that it was interrupted. The calls are not executed again.
 */
export const interruptedToolItems = (pending: readonly PendingToolCall[], ids: IdGenerator): ContextItem[] => {
  const item = (call: PendingToolCall, type: ContextItem["type"], content: string, isError?: boolean): ContextItem => ({
    id: ids.next("itm_"),
    turn: call.stepIndex,
    type,
    isPinned: false,
    content,
    toolMeta: { callId: call.callId, toolName: call.toolName, ...(isError === undefined ? {} : { isError }) },
  })
  return [
    ...pending
      .filter((call) => !call.hasRequestItem)
      .map((call) =>
        item(
          call,
          "tool_request",
          call.rawArguments ?? JSON.stringify({ name: call.toolName, arguments: call.arguments }),
        ),
      ),
    ...pending.map((call) =>
      item(
        call,
        "tool_result",
        call.argumentsError !== undefined
          ? `Tool arguments were not valid JSON: ${call.argumentsError}`
          : [
              `${InterruptedToolMessage}: the worker running this adjudication stopped before "${call.toolName}" returned, and the call was not run again.`,
              `Arguments: ${describeArguments(call.arguments)}`,
              `${NextStepMarker} call the tool again if you still need its result.`,
            ].join("\n"),
        true,
      ),
    ),
  ]
}

export interface VerifyHydrationInput {
  engine: ContextEnginePort
  history: HydratedHistory
  policy: ContextPolicy
  modelLimits: ModelLimits
  limits: Pick<BudgetLimits, "totalTokenBudget" | "costCeilingUsd">
  request?: ModelAttemptRequest
}

/**
 * Verifies hydration instead of trusting it (D8): runs `prepare` again on the history as it stood at the last
 * `context.allocated` event, with the budget of that moment, and compares the digest of the prepared items with the
 * recorded one. A mismatch, a non-ready result or an engine fault is a `persistence_failure`; the runner then fails
 * the run without any model call. A run with no allocation yet has nothing to compare and is verified.
 */
export const verifyHydration = async (input: VerifyHydrationInput): Promise<HydrationCheck> => {
  const point = input.history.lastAllocated
  if (point === undefined) return { kind: "verified" }
  const mismatch = (message: string, actualDigest?: string): HydrationCheck => ({
    kind: "mismatch",
    reason: "persistence_failure",
    message,
    expectedDigest: point.contentDigest,
    ...(actualDigest === undefined ? {} : { actualDigest }),
  })
  if (point.requestDigest !== undefined && input.request === undefined)
    return mismatch(`canonical request is unavailable while verifying step ${point.stepIndex}`)
  const prepared = await input.engine
    .prepare({
      items: point.items,
      ...(input.request === undefined ? {} : { request: input.request }),
      policy: input.policy,
      modelLimits: input.modelLimits,
      budget: {
        totalTokensUsed: point.totalsFromAttempts.totalTokens,
        totalTokenLimit: input.limits.totalTokenBudget,
        compactionsCount: point.compactionsCount,
        costUsd: point.totalsFromAttempts.costUsd,
        costCeilingUsd: input.limits.costCeilingUsd,
      },
    })
    .then(
      (result) => ({ kind: "result" as const, result }),
      (error: unknown) => ({ kind: "error" as const, error }),
    )
  if (prepared.kind === "error")
    return mismatch(
      `context engine failed while re-preparing step ${point.stepIndex}: ${describeError(prepared.error)}`,
    )
  if (point.requestDigest !== undefined && prepared.result.telemetry.requestDigest !== point.requestDigest)
    return mismatch(`hydrated request for step ${point.stepIndex} does not match its persisted digest`, prepared.result.telemetry.requestDigest)
  if (prepared.result.status !== "ready")
    return mismatch(`context engine returned ${prepared.result.status} when re-preparing step ${point.stepIndex}`)
  const actualDigest = digestOf(prepared.result.preparedItems)
  if (actualDigest === point.contentDigest) return { kind: "verified" }
  return mismatch(
    `hydrated context for step ${point.stepIndex} does not match the digest recorded at event ${point.sequence}`,
    actualDigest,
  )
}
