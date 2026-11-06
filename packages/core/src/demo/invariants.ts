import { TerminalRunStates, type RunState, type TrajectoryEvent } from "@harness/protocol"
import type { JudgeRunResult } from "../runner/judge-runner"

const terminalEventStates = {
  "run.completed": "completed",
  "run.failed": "failed",
  "run.cancelled": "cancelled",
  "run.budget_exhausted": "budget_exhausted",
} as const

export interface RunObservation {
  /** Undefined when the runner rejected. */
  result: JudgeRunResult | undefined
  rejection?: string
  events: readonly TrajectoryEvent[]
  runState: RunState | undefined
}

export interface RunChecks {
  terminalEvents: number
  contiguousSequences: boolean
  tokensMatch: boolean
  costMatches: boolean
}

export interface InvariantReport {
  crashFree: boolean
  violations: string[]
  checks: RunChecks
}

const CostTolerance = 1e-9

const attemptTotals = (events: readonly TrajectoryEvent[]) =>
  events
    .filter((event) => event.type === "provider.attempted")
    .reduce(
      (total, event) => ({
        tokens: total.tokens + Number((event.payload.usage as { totalTokens?: number }).totalTokens ?? 0),
        costUsd: total.costUsd + Number(event.payload.costUsd ?? 0),
      }),
      { tokens: 0, costUsd: 0 },
    )

/**
 * The per-run crash-free invariants of the stress test: the runner resolved, the run has exactly one terminal state,
 * its event sequence is contiguous from 1, and the totals equal the sum of the recorded provider attempts.
 */
export const checkRunInvariants = (observation: RunObservation): InvariantReport => {
  const { result, events } = observation
  const terminal = events.flatMap((event) =>
    event.type in terminalEventStates ? [terminalEventStates[event.type as keyof typeof terminalEventStates]] : [],
  )
  const contiguousSequences = events.every((event, index) => event.sequence === index + 1)
  const attempts = attemptTotals(events)
  const tokensMatch = result !== undefined && result.usage.totalTokens === attempts.tokens
  const costMatches = result !== undefined && Math.abs(result.usage.costUsd - attempts.costUsd) <= CostTolerance

  const violations = [
    ...(result === undefined ? [`the runner rejected: ${observation.rejection ?? "unknown error"}`] : []),
    ...(result !== undefined && result.kind !== "committed" ? [`the run did not commit (${result.kind})`] : []),
    ...(terminal.length === 1 ? [] : [`expected exactly one terminal event, found ${terminal.length}`]),
    ...(observation.runState !== undefined && !TerminalRunStates.some((state) => state === observation.runState)
      ? [`the stored run state ${observation.runState} is not terminal`]
      : []),
    ...(terminal.length === 1 && observation.runState !== undefined && terminal[0] !== observation.runState
      ? [`the terminal event says ${terminal[0]} but the stored state is ${observation.runState}`]
      : []),
    ...(contiguousSequences ? [] : [`event sequences are not contiguous from 1: ${events.map((e) => e.sequence)}`]),
    ...(result === undefined || tokensMatch
      ? []
      : [`token total ${result.usage.totalTokens} differs from the attempts' ${attempts.tokens}`]),
    ...(result === undefined || costMatches
      ? []
      : [`cost total ${result.usage.costUsd} differs from the attempts' ${attempts.costUsd}`]),
  ]
  return {
    crashFree: violations.length === 0,
    violations,
    checks: { terminalEvents: terminal.length, contiguousSequences, tokensMatch, costMatches },
  }
}
