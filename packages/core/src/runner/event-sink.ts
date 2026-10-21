import {
  AbsolutePathRedactedPlaceholder,
  EventSchemaVersion,
  TrajectoryEventSchema,
  type ClockPort,
  type EventPayload,
  type EventType,
  type NewTrajectoryEvent,
  type RunClaim,
  type RunStorePort,
  type StaleReason,
  type TrajectoryEvent,
} from "@harness/protocol"
import { digestOf } from "../util/digest"
import type { IdGenerator } from "../util/id"
import type { EventBus } from "./event-bus"

export const MaxBlockedInputLength = 256

const absoluteLooking = /^(?:[\\/]|[A-Za-z]:|file:\/\/)/i

export const isAbsoluteLooking = (input: string) => absoluteLooking.test(input.trim())

/**
 * Normal form of a denied input for `security.blocked`: trimmed, forward slashes, bounded, and an absolute-looking
 * input (checked after trimming, which the protocol regex does not do) replaced by the redaction placeholder.
 */
export const normalizeBlockedInput = (input: string) => {
  const trimmed = input.trim()
  if (isAbsoluteLooking(trimmed)) return AbsolutePathRedactedPlaceholder
  const normalized = trimmed.replaceAll("\\", "/")
  return normalized.length > MaxBlockedInputLength ? `${normalized.slice(0, MaxBlockedInputLength)}...` : normalized
}

export type EventAppendResult = { kind: "appended"; event: TrajectoryEvent } | { kind: "stale"; reason: StaleReason }

export interface EventSinkOptions {
  store: RunStorePort
  claim: RunClaim
  expectedStateVersion: number
  ids: IdGenerator
  clock: ClockPort
  bus?: EventBus
}

export class InvalidEventError extends Error {
  constructor(
    readonly eventType: EventType,
    readonly issues: readonly string[],
  ) {
    super(`event ${eventType} violates its protocol contract: ${issues.join("; ")}`)
    this.name = "InvalidEventError"
  }
}

/**
 * The runner's only write path for events. Each append carries the active claim and expected state version, is
 * validated against the protocol contract, gets a payload digest and an id, and is published on the bus after the
 * store accepted it. Appends are queued, so persisted order, bus order and call order are the same. A rejected append
 * comes back as a typed `stale` result; the caller stops writing. Store faults (infrastructure) propagate.
 */
export class EventSink {
  private readonly store: RunStorePort
  private readonly claim: RunClaim
  private readonly ids: IdGenerator
  private readonly clock: ClockPort
  private readonly bus: EventBus | undefined
  private expectedStateVersion: number
  private tail: Promise<unknown> = Promise.resolve()

  constructor(options: EventSinkOptions) {
    this.store = options.store
    this.claim = options.claim
    this.ids = options.ids
    this.clock = options.clock
    this.bus = options.bus
    this.expectedStateVersion = options.expectedStateVersion
  }

  get runId() {
    return this.claim.runId
  }

  /** Call after each successful state transition so later appends present the new version. */
  setExpectedStateVersion(version: number) {
    this.expectedStateVersion = version
  }

  append<Type extends EventType>(type: Type, payload: EventPayload<Type>, signal?: AbortSignal) {
    const queued = this.tail.then(() => this.write(type, payload, signal))
    this.tail = queued.catch(() => undefined)
    return queued
  }

  createEvent<Type extends EventType>(type: Type, payload: EventPayload<Type>): NewTrajectoryEvent {
    const event = this.makeEvent(type, payload)
    this.validate(event)
    return event
  }

  publish(event: TrajectoryEvent) {
    this.bus?.publish(event)
  }

  nextEventId() {
    return this.ids.next("evt_")
  }

  digestPayload(payload: unknown) {
    return digestOf(payload)
  }

  nowIso() {
    return new Date(this.clock.nowMs()).toISOString()
  }

  private async write(type: EventType, payload: Record<string, unknown>, signal?: AbortSignal) {
    const event = this.makeEvent(type, payload)
    this.validate(event)
    const result = await this.store.appendEvent(
      { claim: this.claim, expectedStateVersion: this.expectedStateVersion, event },
      signal,
    )
    if (result.kind === "stale") return { kind: "stale", reason: result.reason } satisfies EventAppendResult
    this.bus?.publish(result.event)
    return { kind: "appended", event: result.event } satisfies EventAppendResult
  }

  private makeEvent(type: EventType, payload: Record<string, unknown>): NewTrajectoryEvent {
    const recorded =
      type === "security.blocked" && typeof payload.input === "string"
        ? { ...payload, input: normalizeBlockedInput(payload.input) }
        : payload
    const event: NewTrajectoryEvent = {
      eventId: this.ids.next("evt_"),
      type,
      schemaVersion: EventSchemaVersion,
      payload: recorded,
      payloadDigest: digestOf(recorded),
      occurredAt: new Date(this.clock.nowMs()).toISOString(),
    }
    return event
  }

  private validate(event: NewTrajectoryEvent) {
    const checked = TrajectoryEventSchema.safeParse({ ...event, runId: this.claim.runId, sequence: 1 })
    if (!checked.success)
      throw new InvalidEventError(
        event.type,
        checked.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      )

  }
}
