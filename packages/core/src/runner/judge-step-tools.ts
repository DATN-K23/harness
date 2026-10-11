import type { ContextItem, ModelToolCall, ToolCallOutcome, ToolExecutionResult } from "@harness/protocol"
import {
  NextStepMarker,
  ParallelToolDispatcher,
  describeArguments,
  type DispatchedCall,
  type SettleResult,
} from "../step/parallel-tool-dispatcher"
import { checkBoundary, type CancellationBoundary } from "./cancellation"
import type { JudgeStepDeps, JudgeStepInput } from "./judge-step"
import { StaleWrite, asFault, bounded, type Persist } from "./judge-step-support"

const MaxFailureMessageChars = 2_000

export interface ToolBranchContext {
  deps: JudgeStepDeps
  input: JudgeStepInput
  persist: Persist
  newItem: (type: ContextItem["type"], content: string, toolMeta?: ContextItem["toolMeta"]) => ContextItem
  toolsDisabled: boolean
}

export type ToolBranch =
  | { kind: "settled"; outcomes: ToolCallOutcome[]; items: ContextItem[] }
  | { kind: "cancelled"; boundary: CancellationBoundary }

interface Settled {
  outcome: ToolCallOutcome
  request: ContextItem
  result: ContextItem
}

const disabledMessage = (call: ModelToolCall) =>
  [
    `Tool "${call.name}" was not run: tools are disabled because this adjudication reached its step limit.`,
    `Arguments: ${describeArguments(call.arguments)}`,
    `${NextStepMarker} reply now with your final JSON verdict, using only the evidence already gathered.`,
  ].join("\n")

/**
 * Gate 7 for one call: the security filter sees the raw output first, the context engine shapes the filtered text,
 * and the step persists `tool.completed` or `tool.failed` from the filtered text only.
 */
const settle = async (context: ToolBranchContext, call: DispatchedCall): Promise<Settled> => {
  const { deps, input } = context
  const filtered = await deps.security.filterSecrets(call.result.content, input.signal)
  const shaped = await deps.contextEngine.shapeToolResult({
    content: filtered.content,
    toolName: call.toolName,
    policy: input.policy,
  })
  const note = shaped.isTruncated ? shaped.continuationNote : undefined
  const content = note !== undefined && !shaped.content.includes(note) ? `${shaped.content}\n${note}` : shaped.content
  const location = {
    ...(call.result.filePath === undefined ? {} : { filePath: call.result.filePath }),
    ...(call.result.lineRange === undefined ? {} : { lineRange: call.result.lineRange }),
  }
  const identity = { callId: call.callId, toolName: call.toolName }
  const request = context.newItem(
    "tool_request",
    JSON.stringify({ name: call.toolName, arguments: call.arguments }),
    identity,
  )
  const result = context.newItem("tool_result", content, { ...identity, ...location, isError: call.result.isError })
  const event = { callIndex: call.callIndex, ...identity, durationMs: Math.max(0, Math.round(call.durationMs)) }
  if (call.result.isError)
    await context.persist("tool.failed", { ...event, message: bounded(filtered.content, MaxFailureMessageChars) })
  else await context.persist("tool.completed", { ...event, isTruncated: shaped.isTruncated, itemId: result.id })
  const visible: ToolExecutionResult = { content, isError: call.result.isError, ...location }
  return {
    outcome: {
      callIndex: call.callIndex,
      callId: call.callId,
      toolName: call.toolName,
      arguments: call.arguments,
      result: visible,
    },
    request,
    result,
  }
}

/** A forced step does not execute tools: each call is recorded and answered with an error result. */
const refuseAll = async (
  context: ToolBranchContext,
  calls: readonly ModelToolCall[],
  onResult: (call: DispatchedCall) => Promise<SettleResult>,
) => {
  for (const [callIndex, call] of calls.entries())
    await context.persist("tool.requested", {
      callIndex,
      callId: call.id,
      toolName: call.name,
      arguments: call.arguments,
    })
  for (const [callIndex, call] of calls.entries())
    await onResult({
      callIndex,
      callId: call.id,
      toolName: call.name,
      arguments: call.arguments,
      result: { content: disabledMessage(call), isError: true },
      durationMs: 0,
      failureKind: "tools_disabled",
    })
}

/** Gates 6 and 7: cancellation boundary, deterministic dispatch (or refusal on a forced step), filter then shape. */
export const runToolBranch = async (
  context: ToolBranchContext,
  calls: readonly ModelToolCall[],
): Promise<ToolBranch> => {
  const { deps, input } = context
  const boundary = await checkBoundary(deps.cancellation, deps.sink.runId, "before_tools", { signal: input.signal })
  if (boundary.kind === "cancel") return { kind: "cancelled", boundary: boundary.boundary }

  const settled: Settled[] = []
  const onResult = async (call: DispatchedCall): Promise<SettleResult> => {
    settled.push(await settle(context, call).catch(asFault("worker_interrupted")))
    return { kind: "continue" }
  }

  if (context.toolsDisabled) await refuseAll(context, calls, onResult)
  if (!context.toolsDisabled) {
    const dispatcher = new ParallelToolDispatcher({
      registry: input.tools,
      sink: deps.sink,
      clock: deps.clock,
      enableParallelToolDispatch: input.flags.enableParallelToolDispatch,
    })
    // Tool execution never rejects; what escapes the dispatcher is an event-store fault or one tagged in `onResult`.
    const dispatched = await dispatcher
      .dispatch({ calls, signal: input.signal, onResult })
      .catch(asFault("persistence_failure"))
    if (dispatched.kind === "stale") throw new StaleWrite(dispatched.reason)
  }

  return {
    kind: "settled",
    outcomes: settled.map((entry) => entry.outcome),
    items: [...settled.map((entry) => entry.request), ...settled.map((entry) => entry.result)],
  }
}
