import {
  EventPayloadSchemas,
  StopReasonToTerminalReason,
  type BudgetTerminalReason,
  type JudgeVerdict,
  type RunClaim,
  type RunRecord,
  type RunState,
  type RunStorePort,
  type StopReason,
  type TerminalReason,
  type TerminalRunState,
  type TrajectoryEvent,
} from "@harness/protocol"
import type { CancellationBoundary } from "./cancellation"
import type { EventSink } from "./event-sink"
import { StepFault, StaleWrite, asFault, persistTo, type Persist } from "./judge-step-support"

/** What the runner decided to end the run with. */
export type TerminalCommit =
  | { state: "completed"; verdict: JudgeVerdict }
  | { state: "failed"; reason: TerminalReason; message: string }
  | { state: "cancelled"; boundary: CancellationBoundary }
  /** `observed` lists every exhausted limit seen (telemetry); `reason` is the single terminal reason. */
  | { state: "budget_exhausted"; reason: StopReason; observed: readonly StopReason[] }

export interface CommittedRun {
  state: TerminalRunState
  terminalReason?: TerminalReason
  verdict?: JudgeVerdict
  observedLimits: BudgetTerminalReason[]
}

const committedRun = (terminal: TerminalCommit): CommittedRun => {
  if (terminal.state === "completed") return { state: "completed", verdict: terminal.verdict, observedLimits: [] }
  if (terminal.state === "failed") return { state: "failed", terminalReason: terminal.reason, observedLimits: [] }
  if (terminal.state === "cancelled")
    return { state: "cancelled", terminalReason: "cancelled_by_user", observedLimits: [] }
  return {
    state: "budget_exhausted",
    terminalReason: StopReasonToTerminalReason[terminal.reason],
    observedLimits: terminal.observed.map((reason) => StopReasonToTerminalReason[reason]),
  }
}

/** The run state and terminal reason a persisted terminal event stands for. */
const pendingRun = (event: TrajectoryEvent): CommittedRun => {
  if (event.type === "run.completed") {
    const { verdict } = EventPayloadSchemas["run.completed"].parse(event.payload)
    return { state: "completed", verdict, observedLimits: [] }
  }
  if (event.type === "run.failed")
    return {
      state: "failed",
      terminalReason: EventPayloadSchemas["run.failed"].parse(event.payload).reason,
      observedLimits: [],
    }
  if (event.type === "run.cancelled")
    return {
      state: "cancelled",
      terminalReason: EventPayloadSchemas["run.cancelled"].parse(event.payload).reason,
      observedLimits: [],
    }
  const exhausted = EventPayloadSchemas["run.budget_exhausted"].parse(event.payload)
  return { state: "budget_exhausted", terminalReason: exhausted.reason, observedLimits: exhausted.observedLimits }
}

/**
 * The run's only write path for state: compare-and-set transitions on the claim and state version, and the terminal
 * commit. A refused write throws `StaleWrite` (stop writing); a store fault throws `StepFault(persistence_failure)`.
 */
export class RunWriter {
  readonly persist: Persist
  private current: RunState
  private stateVersion: number
  private terminalEventWritten = false

  constructor(
    private readonly store: RunStorePort,
    readonly sink: EventSink,
    private readonly claim: RunClaim,
    record: Pick<RunRecord, "state" | "stateVersion">,
  ) {
    this.persist = persistTo(sink)
    this.current = record.state
    this.stateVersion = record.stateVersion
  }

  get state() {
    return this.current
  }

  /** Once the terminal event is persisted no other terminal event may follow, whatever happens to the transition. */
  get terminalWritten() {
    return this.terminalEventWritten
  }

  async transition(nextState: RunState, terminalReason?: TerminalReason) {
    const result = await this.store
      .transition({
        claim: this.claim,
        expectedState: this.current,
        expectedStateVersion: this.stateVersion,
        nextState,
        ...(terminalReason === undefined ? {} : { terminalReason }),
      })
      .catch(asFault("persistence_failure"))
    if (result.kind === "stale") throw new StaleWrite(result.reason)
    this.current = nextState
    this.stateVersion = result.stateVersion
    this.sink.setExpectedStateVersion(result.stateVersion)
  }

  /**
   * Verdict, terminal event and transition as one commit. The event goes first because the store refuses appends to a
   * terminal run; a crash between the two leaves a terminal-pending run that the next worker finishes (`finishPending`).
   */
  async commit(terminal: TerminalCommit): Promise<CommittedRun> {
    const run = committedRun(terminal)
    if (this.store.commitTerminal) {
      const terminalData = this.terminalEvent(terminal)
      const event = this.sink.createEvent(terminalData.type, terminalData.payload)
      const result = await this.store.commitTerminal({
        claim: this.claim,
        expectedState: this.current,
        expectedStateVersion: this.stateVersion,
        event,
        nextState: run.state,
        ...(run.terminalReason === undefined ? {} : { terminalReason: run.terminalReason }),
        ...(terminal.state === "completed" ? {
          resultContent: terminal.verdict.summary,
        } : terminal.state === "failed" ? {
          errorMessage: terminal.message,
          errorCategory: terminal.reason,
        } : {}),
      }).catch((error: unknown) => {
        throw error instanceof StepFault ? error : new StepFault("persistence_failure", error)
      })
      if (result.kind === "stale") throw new StaleWrite(result.reason)
      this.terminalEventWritten = true
      this.current = run.state
      this.stateVersion = result.stateVersion
      this.sink.setExpectedStateVersion(result.stateVersion)
      return run
    }
    await this.appendTerminal(terminal)
    this.terminalEventWritten = true
    await this.transition(run.state, run.terminalReason)
    return run
  }

  /**
   * Completes the transition of a terminal event that is already persisted. Writes no event, makes no model call.
   * The hydrator has validated the event against its contract, so its payload parses.
   */
  async finishPending(event: TrajectoryEvent): Promise<CommittedRun> {
    this.terminalEventWritten = true
    const run = pendingRun(event)
    await this.transition(run.state, run.terminalReason)
    return run
  }

  private appendTerminal(terminal: TerminalCommit) {
    if (terminal.state === "completed") return this.persist("run.completed", { verdict: terminal.verdict })
    if (terminal.state === "failed")
      return this.persist("run.failed", { reason: terminal.reason, message: terminal.message })
    if (terminal.state === "cancelled")
      return this.persist("run.cancelled", { reason: "cancelled_by_user", boundary: terminal.boundary })
    return this.persist("run.budget_exhausted", {
      reason: StopReasonToTerminalReason[terminal.reason],
      observedLimits: terminal.observed.map((reason) => StopReasonToTerminalReason[reason]),
    })
  }

  private terminalEvent(terminal: TerminalCommit) {
    if (terminal.state === "completed") return {
      type: "run.completed" as const,
      payload: { verdict: terminal.verdict },
    }
    if (terminal.state === "failed") return {
      type: "run.failed" as const,
      payload: { reason: terminal.reason, message: terminal.message },
    }
    if (terminal.state === "cancelled") return {
      type: "run.cancelled" as const,
      payload: { reason: "cancelled_by_user" as const, boundary: terminal.boundary },
    }
    const payload = {
      reason: StopReasonToTerminalReason[terminal.reason],
      observedLimits: terminal.observed.map((reason) => StopReasonToTerminalReason[reason]),
    }
    return {
      type: "run.budget_exhausted" as const,
      payload,
    }
  }
}
