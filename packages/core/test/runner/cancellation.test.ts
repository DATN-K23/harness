import { describe, expect, test } from "bun:test"
import type { RunState } from "@harness/protocol"
import { checkBoundary, createRunSignal, type RunBoundary } from "../../src/runner/cancellation"

class FakeCancellation {
  readonly polls: string[] = []
  requested = false
  async request() { this.requested = true; return { kind: "requested" as const } }
  async isRequested(runId: string) {
    this.polls.push(runId)
    return this.requested
  }
}

class FakeTimers {
  scheduled: Array<{ ms: number; fire: () => void; cleared: boolean }> = []
  readonly setTimer = (ms: number, fire: () => void) => {
    const timer = { ms, fire, cleared: false }
    this.scheduled.push(timer)
    return () => {
      timer.cleared = true
    }
  }
  fireAll() {
    this.scheduled.filter((timer) => !timer.cleared).forEach((timer) => timer.fire())
  }
}

const boundaries: RunBoundary[] = ["before_stages", "before_model", "before_tools"]

describe("checkBoundary", () => {
  test.each(boundaries)("%s polls the cancellation port exactly once per pass", async (boundary) => {
    const port = new FakeCancellation()
    const result = await checkBoundary(port, "run-1", boundary)
    expect(result).toEqual({ kind: "continue" })
    expect(port.polls).toEqual(["run-1"])
    await checkBoundary(port, "run-1", boundary)
    expect(port.polls).toHaveLength(2)
  })

  test("a request seen at before_model reports the provider-call boundary", async () => {
    const port = new FakeCancellation()
    port.requested = true
    expect(await checkBoundary(port, "run-1", "before_model")).toEqual({
      kind: "cancel",
      boundary: "before_provider_call",
    })
  })

  test("a request seen at before_tools reports the tool-dispatch boundary", async () => {
    const port = new FakeCancellation()
    port.requested = true
    expect(await checkBoundary(port, "run-1", "before_tools")).toEqual({
      kind: "cancel",
      boundary: "before_tool_dispatch",
    })
  })

  test("before_stages reports ingestion by default and sandbox when asked", async () => {
    const port = new FakeCancellation()
    port.requested = true
    expect(await checkBoundary(port, "run-1", "before_stages")).toEqual({
      kind: "cancel",
      boundary: "before_ingestion",
    })
    expect(await checkBoundary(port, "run-1", "before_stages", { stage: "sandbox" })).toEqual({
      kind: "cancel",
      boundary: "before_sandbox",
    })
  })

  test("each boundary is checked once in a full pass through the run", async () => {
    const port = new FakeCancellation()
    const results = await boundaries.reduce<Promise<unknown[]>>(
      async (previous, boundary) => [...(await previous), await checkBoundary(port, "run-1", boundary)],
      Promise.resolve([]),
    )
    expect(results).toEqual([{ kind: "continue" }, { kind: "continue" }, { kind: "continue" }])
    expect(port.polls).toHaveLength(3)
  })

  test.each(["completed", "failed", "cancelled", "budget_exhausted"] as RunState[])(
    "a run already %s is left unchanged and the port is not consulted",
    async (runState) => {
      const port = new FakeCancellation()
      port.requested = true
      expect(await checkBoundary(port, "run-1", "before_model", { runState })).toEqual({ kind: "terminal" })
      expect(port.polls).toEqual([])
    },
  )

  test.each(["accepted", "queued", "running"] as RunState[])("a %s run is polled normally", async (runState) => {
    const port = new FakeCancellation()
    port.requested = true
    expect((await checkBoundary(port, "run-1", "before_model", { runState })).kind).toBe("cancel")
    expect(port.polls).toHaveLength(1)
  })

  test("forwards the abort signal to the port", async () => {
    const signals: Array<AbortSignal | undefined> = []
    const port = {
      request: async () => ({ kind: "requested" as const }),
      isRequested: async (_runId: string, signal?: AbortSignal) => {
        signals.push(signal)
        return false
      },
    }
    const controller = new AbortController()
    await checkBoundary(port, "run-1", "before_tools", { signal: controller.signal })
    expect(signals).toEqual([controller.signal])
  })
})

describe("createRunSignal", () => {
  const clock = (nowMs: number) => ({ nowMs: () => nowMs })
  const runSignalFor = (cancel: AbortController, timers: FakeTimers) =>
    createRunSignal({ cancel: cancel.signal, deadlineMs: 5_000, clock: clock(0), setTimer: timers.setTimer })

  test("is not aborted while the deadline is in the future and nothing was cancelled", () => {
    const timers = new FakeTimers()
    const run = createRunSignal({ deadlineMs: 5_000, clock: clock(1_000), setTimer: timers.setTimer })
    expect(run.signal.aborted).toBe(false)
    expect(run.cause()).toBeUndefined()
    expect(timers.scheduled.map((timer) => timer.ms)).toEqual([4_000])
  })

  test("aborts with wall_clock_timeout when the deadline timer fires", () => {
    const timers = new FakeTimers()
    const run = createRunSignal({ deadlineMs: 5_000, clock: clock(1_000), setTimer: timers.setTimer })
    timers.fireAll()
    expect(run.signal.aborted).toBe(true)
    expect(run.cause()).toBe("wall_clock_timeout")
  })

  test("aborts immediately when the deadline has already passed", () => {
    const timers = new FakeTimers()
    const run = createRunSignal({ deadlineMs: 1_000, clock: clock(1_000), setTimer: timers.setTimer })
    expect(run.signal.aborted).toBe(true)
    expect(run.cause()).toBe("wall_clock_timeout")
    expect(timers.scheduled).toEqual([])
  })

  test("aborts with cancelled when the cancel flag trips", () => {
    const timers = new FakeTimers()
    const cancel = new AbortController()
    const run = runSignalFor(cancel, timers)
    cancel.abort()
    expect(run.signal.aborted).toBe(true)
    expect(run.cause()).toBe("cancelled")
    expect(timers.scheduled.every((timer) => timer.cleared)).toBe(true)
  })

  test("aborts immediately when the cancel flag is already set", () => {
    const timers = new FakeTimers()
    const cancel = new AbortController()
    cancel.abort()
    const run = runSignalFor(cancel, timers)
    expect(run.signal.aborted).toBe(true)
    expect(run.cause()).toBe("cancelled")
  })

  test("the first cause wins when both trip", () => {
    const timers = new FakeTimers()
    const cancel = new AbortController()
    const run = runSignalFor(cancel, timers)
    timers.fireAll()
    cancel.abort()
    expect(run.cause()).toBe("wall_clock_timeout")
  })

  test("notifies listeners of the combined signal", () => {
    const timers = new FakeTimers()
    const cancel = new AbortController()
    const run = runSignalFor(cancel, timers)
    const seen: boolean[] = []
    run.signal.addEventListener("abort", () => seen.push(run.signal.aborted))
    cancel.abort()
    expect(seen).toEqual([true])
  })

  test("dispose clears the timer and detaches from the cancel flag without aborting", () => {
    const timers = new FakeTimers()
    const cancel = new AbortController()
    const run = runSignalFor(cancel, timers)
    run.dispose()
    expect(timers.scheduled.every((timer) => timer.cleared)).toBe(true)
    cancel.abort()
    expect(run.signal.aborted).toBe(false)
  })

  test("works without a cancel flag using the default timer", () => {
    const run = createRunSignal({ deadlineMs: 60_000, clock: clock(0) })
    expect(run.signal.aborted).toBe(false)
    run.dispose()
  })
})
