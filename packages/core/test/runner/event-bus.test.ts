import { describe, expect, test } from "bun:test"
import type { TrajectoryEvent } from "@harness/protocol"
import { EventBus } from "../../src/runner/event-bus"
import { newTestEvent } from "../../src/testing/run-store-contract"

const event = (runId: string, sequence: number): TrajectoryEvent => ({
  ...newTestEvent(`${runId}-${sequence}`),
  runId,
  sequence,
})

describe("EventBus callbacks", () => {
  test("delivers events to every subscriber in publish order", () => {
    const bus = new EventBus()
    const first: number[] = []
    const second: number[] = []
    bus.subscribe((published) => first.push(published.sequence))
    bus.subscribe((published) => second.push(published.sequence))
    ;[1, 2, 3].forEach((sequence) => bus.publish(event("run-1", sequence)))
    expect(first).toEqual([1, 2, 3])
    expect(second).toEqual([1, 2, 3])
  })

  test("filters by run and stops after unsubscribe", () => {
    const bus = new EventBus()
    const only: string[] = []
    const stop = bus.subscribe((published) => only.push(published.eventId), { runId: "run-2" })
    bus.publish(event("run-1", 1))
    bus.publish(event("run-2", 1))
    stop()
    bus.publish(event("run-2", 2))
    expect(only).toEqual(["evt-run-2-1"])
  })

  test("a subscriber that mutates its copy cannot change what others see", () => {
    const bus = new EventBus()
    const seen: unknown[] = []
    bus.subscribe((published) => {
      published.payload.label = "tampered"
    })
    bus.subscribe((published) => seen.push(published.payload.label))
    bus.publish(event("run-1", 1))
    expect(seen).toEqual(["run-1-1"])
  })

  test("a throwing subscriber is reported and does not stop the others", () => {
    const errors: unknown[] = []
    const bus = new EventBus({ onListenerError: (error) => errors.push(error) })
    const seen: number[] = []
    bus.subscribe(() => {
      throw new Error("bad listener")
    })
    bus.subscribe((published) => seen.push(published.sequence))
    expect(() => bus.publish(event("run-1", 1))).not.toThrow()
    expect(seen).toEqual([1])
    expect(errors).toHaveLength(1)
  })

  test("does not replay events published before the subscription", () => {
    const bus = new EventBus()
    bus.publish(event("run-1", 1))
    const seen: number[] = []
    bus.subscribe((published) => seen.push(published.sequence))
    bus.publish(event("run-1", 2))
    expect(seen).toEqual([2])
  })
})

describe("EventBus stream", () => {
  test("yields buffered events in order and ends on close", async () => {
    const bus = new EventBus()
    const stream = bus.stream()
    ;[1, 2, 3].forEach((sequence) => bus.publish(event("run-1", sequence)))
    bus.close()
    const received: number[] = []
    for await (const published of stream) received.push(published.sequence)
    expect(received).toEqual([1, 2, 3])
  })

  test("a waiting consumer is woken by the next publish", async () => {
    const bus = new EventBus()
    const stream = bus.stream({ runId: "run-1" })
    const pending = stream.next()
    bus.publish(event("run-2", 1))
    bus.publish(event("run-1", 1))
    expect(await pending).toEqual({ value: event("run-1", 1), done: false })
  })

  test("a waiting consumer ends on close or abort", async () => {
    const bus = new EventBus()
    const waiting = bus.stream().next()
    bus.close()
    expect((await waiting).done).toBe(true)

    const controller = new AbortController()
    const another = new EventBus().stream({ signal: controller.signal })
    const next = another.next()
    controller.abort()
    expect((await next).done).toBe(true)
  })

  test("breaking out of the loop unsubscribes", async () => {
    const bus = new EventBus()
    const stream = bus.stream()
    bus.publish(event("run-1", 1))
    for await (const published of stream) {
      expect(published.sequence).toBe(1)
      break
    }
    bus.publish(event("run-1", 2))
    expect((await stream.next()).done).toBe(true)
  })

  test("a stream opened after close is already finished", async () => {
    const bus = new EventBus()
    bus.close()
    expect((await bus.stream().next()).done).toBe(true)
  })
})
