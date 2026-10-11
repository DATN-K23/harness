import type { EventPayload, EventType, ModelUsage, StaleReason, TerminalReason } from "@harness/protocol"
import type { EventSink } from "./event-sink"
import type { AttemptRecord } from "./retry-policy"

const MaxErrorChars = 500

export const bounded = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}...` : text)

export const describeError = (error: unknown) =>
  bounded(error instanceof Error ? `${error.name}: ${error.message}` : String(error), MaxErrorChars)

/** An unexpected fault inside a step, tagged with the terminal reason the runner should commit. */
export class StepFault extends Error {
  constructor(
    readonly reason: TerminalReason,
    readonly fault: unknown,
  ) {
    super(describeError(fault))
    this.name = "StepFault"
  }
}

/** The store refused a write (claim lost or state changed): the step stops and nothing more may be written. */
export class StaleWrite extends Error {
  constructor(readonly reason: StaleReason) {
    super(`the run store refused a write (${reason})`)
    this.name = "StaleWrite"
  }
}

/** A promise rejection handler: keeps a fault that is already classified, tags anything else with `reason`. */
export const asFault =
  (reason: TerminalReason) =>
  (error: unknown): never => {
    throw error instanceof StepFault || error instanceof StaleWrite ? error : new StepFault(reason, error)
  }

export type Persist = <Type extends EventType>(type: Type, payload: EventPayload<Type>) => Promise<void>

/** Appends through the sink; a store fault becomes `persistence_failure` and a refused write a `StaleWrite`. */
export const persistTo =
  (sink: EventSink): Persist =>
  async (type, payload) => {
    const appended = await sink.append(type, payload).catch(asFault("persistence_failure"))
    if (appended.kind === "stale") throw new StaleWrite(appended.reason)
  }

/** The `provider.attempted` record of one attempt; reasoning steps and compaction attempts are recorded alike. */
export const attemptPayload = (
  stepIndex: number,
  profileId: string,
  attempt: AttemptRecord,
): EventPayload<"provider.attempted"> => ({
  stepIndex,
  attemptIndex: attempt.attemptIndex,
  profileId,
  usage: attempt.usage,
  costUsd: attempt.costUsd,
  latencyMs: Math.max(0, Math.round(attempt.latencyMs)),
  ...(attempt.errorCategory === undefined ? {} : { errorCategory: attempt.errorCategory }),
  retryDecision: attempt.retryDecision,
  backoffMs: attempt.backoffMs,
})

/** Tokens and cost of every attempt, failed ones included: this is what the run budget is charged. */
export const sumUsage = (attempts: readonly AttemptRecord[]): ModelUsage =>
  attempts.reduce(
    (sum, attempt) => ({
      promptTokens: sum.promptTokens + attempt.usage.promptTokens,
      completionTokens: sum.completionTokens + attempt.usage.completionTokens,
      totalTokens: sum.totalTokens + attempt.usage.totalTokens,
      costUsd: sum.costUsd + attempt.costUsd,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
  )
