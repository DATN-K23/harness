import { canonicalize, StopPrecedence, type BudgetLimits, type StopReason } from "@harness/protocol"

export interface NoProgressState {
  /** Tool name and canonical-JSON arguments of the most recent call. */
  lastKey?: string
  repeats: number
}

export const initialNoProgress: NoProgressState = { repeats: 0 }

export interface StopState {
  startedAtMs: number
  costUsd: number
  totalTokens: number
  /** Steps that have finished; the step about to run is `completedSteps + 1`. */
  completedSteps: number
  /** Set when the context engine reported that the context cannot fit even after compaction. */
  contextBudgetExhausted: boolean
  noProgress: NoProgressState
}

export interface StopEvaluation {
  selected: StopReason | undefined
  /** Every exhausted limit in precedence order, recorded in telemetry even though only one is selected. */
  observed: StopReason[]
}

export const evaluateStop = (state: StopState, limits: BudgetLimits, nowMs: number): StopEvaluation => {
  const exhausted: Record<StopReason, boolean> = {
    wall_clock_timeout: nowMs - state.startedAtMs >= limits.wallClockTimeoutMs,
    cost_budget_exhausted: state.costUsd >= limits.costCeilingUsd,
    total_tokens_exhausted: state.totalTokens >= limits.totalTokenBudget,
    max_steps_exceeded: state.completedSteps >= limits.maxSteps,
    context_budget_exhausted: state.contextBudgetExhausted,
    no_progress_detected: state.noProgress.repeats >= limits.noProgressMaxRepeats,
  }
  const observed = StopPrecedence.filter((reason) => exhausted[reason])
  return { selected: observed[0], observed }
}

export interface ObservedToolCall {
  toolName: string
  arguments: Record<string, unknown>
}

/** With detection off the state stays at its initial value, so the streak can never reach the limit. */
export const observeToolCalls = (
  state: NoProgressState,
  calls: readonly ObservedToolCall[],
  enabled: boolean,
): NoProgressState => {
  if (!enabled) return initialNoProgress
  return calls.reduce<NoProgressState>((acc, call) => {
    const key = `${call.toolName}\u0000${canonicalize(call.arguments)}`
    return { lastKey: key, repeats: key === acc.lastKey ? acc.repeats + 1 : 1 }
  }, state)
}

/** Steps are 1-indexed; the last two steps may not call tools so the model gets two chances to give a verdict. */
export const isForcedStep = (stepIndex: number, maxSteps: number, enabled: boolean) =>
  enabled && stepIndex >= maxSteps - 1
