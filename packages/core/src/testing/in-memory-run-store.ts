import {
  TerminalRunStates,
  type AppendResult,
  type ClaimResult,
  type ClockPort,
  type NewTrajectoryEvent,
  type RunClaim,
  type RunRecord,
  type RunState,
  type RunStorePort,
  type TransitionResult,
  type TrajectoryEvent,
} from "@harness/protocol"

export const DefaultLeaseMs = 300_000

export interface InMemoryRunStoreOptions {
  clock: ClockPort
  /** How long a claim blocks other workers. A successful write does not extend it; only a re-claim after expiry does. */
  leaseMs?: number
}

export type RunStoreOperation = "claim" | "appendEvent" | "transition" | "loadRun" | "loadEvents"

interface StoredRun {
  record: RunRecord
  events: TrajectoryEvent[]
  claim?: RunClaim & { expiresAtMs: number }
  claimVersion: number
}

const isTerminal = (state: RunState) => TerminalRunStates.some((terminal) => terminal === state)

/**
 * In-memory `RunStorePort`. Every rule the contract tests check lives here: claims with lease expiry, writes that must
 * present the current claim and state version, store-assigned unique contiguous sequences, compare-and-set transitions
 * and immutable terminal runs. Rejected writes change nothing. Lease expiry only gates `claim`: a write is accepted
 * while the presented claim is still the latest one, as with a token comparison in SQL.
 */
export class InMemoryRunStore implements RunStorePort {
  private readonly clock: ClockPort
  private readonly leaseMs: number
  private readonly runs = new Map<string, StoredRun>()
  private readonly listeners = new Set<(event: TrajectoryEvent) => void>()
  private readonly faults: Array<{ operation: RunStoreOperation; error: Error }> = []
  private forcedSequence: number | "duplicate" | undefined

  constructor(options: InMemoryRunStoreOptions) {
    this.clock = options.clock
    this.leaseMs = options.leaseMs ?? DefaultLeaseMs
  }

  /** Test setup: creates a run the way the (out of scope) acceptance path would. */
  seedRun(runId: string, state: RunState = "queued") {
    if (this.runs.has(runId)) throw new Error(`run ${runId} already exists`)
    this.runs.set(runId, { record: { runId, state, stateVersion: 1 }, events: [], claimVersion: 0 })
  }

  /** Subscribes to every stored event, in sequence order, after it is persisted. Listeners must not throw. */
  onAppend(listener: (event: TrajectoryEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** The next call of `operation` rejects with `error` before it reads or writes anything. Faults fire in order. */
  failNext(operation: RunStoreOperation, error = new Error(`injected ${operation} failure`)) {
    this.faults.push({ operation, error })
  }

  /** The next append proposes this sequence number; the uniqueness guard rejects it unless it is the next one. */
  forceNextSequence(sequence: number) {
    this.forcedSequence = sequence
  }

  /** The next append proposes the sequence number the run's latest event already holds. */
  duplicateNextSequence() {
    this.forcedSequence = "duplicate"
  }

  async claim(input: { runId: string; workerId: string }, signal?: AbortSignal): Promise<ClaimResult> {
    this.enter("claim", signal)
    const run = this.runs.get(input.runId)
    if (run === undefined) return { kind: "unavailable", reason: "not_found" }
    if (isTerminal(run.record.state)) return { kind: "unavailable", reason: "terminal" }
    const now = this.clock.nowMs()
    if (run.claim !== undefined && now < run.claim.expiresAtMs)
      return { kind: "unavailable", reason: "already_claimed" }
    run.claimVersion += 1
    const claim: RunClaim = {
      runId: input.runId,
      claimToken: `claim:${input.runId}:${run.claimVersion}:${input.workerId}`,
      claimVersion: run.claimVersion,
    }
    run.claim = { ...claim, expiresAtMs: now + this.leaseMs }
    return { kind: "claimed", claim, state: run.record.state, stateVersion: run.record.stateVersion }
  }

  async appendEvent(
    input: { claim: RunClaim; expectedStateVersion: number; event: NewTrajectoryEvent },
    signal?: AbortSignal,
  ): Promise<AppendResult> {
    this.enter("appendEvent", signal)
    const run = this.runs.get(input.claim.runId)
    if (run === undefined || !this.holds(run, input.claim)) return { kind: "stale", reason: "claim_lost" }
    if (isTerminal(run.record.state) || run.record.stateVersion !== input.expectedStateVersion)
      return { kind: "stale", reason: "state_changed" }

    const sequence = this.proposeSequence(run)
    const last = run.events.at(-1)?.sequence ?? 0
    if (sequence !== last + 1)
      throw new Error(`run ${run.record.runId}: rejected sequence ${sequence}, the next contiguous one is ${last + 1}`)

    const event: TrajectoryEvent = structuredClone({ ...input.event, runId: run.record.runId, sequence })
    run.events.push(event)
    this.listeners.forEach((listener) => listener(structuredClone(event)))
    return { kind: "appended", event: structuredClone(event) }
  }

  async transition(input: Parameters<RunStorePort["transition"]>[0], signal?: AbortSignal): Promise<TransitionResult> {
    this.enter("transition", signal)
    const run = this.runs.get(input.claim.runId)
    if (run === undefined || !this.holds(run, input.claim)) return { kind: "stale", reason: "claim_lost" }
    const { record } = run
    if (isTerminal(record.state)) return { kind: "stale", reason: "state_changed" }
    if (record.state !== input.expectedState || record.stateVersion !== input.expectedStateVersion)
      return { kind: "stale", reason: "state_changed" }

    record.state = input.nextState
    record.stateVersion += 1
    if (input.terminalReason !== undefined) record.terminalReason = input.terminalReason
    return { kind: "transitioned", stateVersion: record.stateVersion }
  }

  async loadRun(runId: string, signal?: AbortSignal): Promise<RunRecord | undefined> {
    this.enter("loadRun", signal)
    const run = this.runs.get(runId)
    return run === undefined ? undefined : { ...run.record }
  }

  async loadEvents(input: { runId: string; afterSequence?: number }, signal?: AbortSignal): Promise<TrajectoryEvent[]> {
    this.enter("loadEvents", signal)
    const after = input.afterSequence ?? 0
    return structuredClone((this.runs.get(input.runId)?.events ?? []).filter((event) => event.sequence > after))
  }

  private enter(operation: RunStoreOperation, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const index = this.faults.findIndex((fault) => fault.operation === operation)
    if (index === -1) return
    const [fault] = this.faults.splice(index, 1)
    throw fault.error
  }

  private holds(run: StoredRun, claim: RunClaim) {
    return run.claim?.claimToken === claim.claimToken && run.claim.claimVersion === claim.claimVersion
  }

  private proposeSequence(run: StoredRun) {
    const last = run.events.at(-1)?.sequence ?? 0
    const forced = this.forcedSequence
    this.forcedSequence = undefined
    if (forced === undefined) return last + 1
    return forced === "duplicate" ? last : forced
  }
}
