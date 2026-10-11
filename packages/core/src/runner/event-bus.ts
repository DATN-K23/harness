import type { TrajectoryEvent } from "@harness/protocol"

export type EventListener = (event: TrajectoryEvent) => void

export interface EventBusOptions {
  /** Called when a listener throws. A faulty subscriber never reaches the publisher or the other subscribers. */
  onListenerError?: (error: unknown) => void
}

export interface EventStreamOptions {
  runId?: string
  signal?: AbortSignal
}

/**
 * Live, in-memory fan-out of persisted events. It does not replay: a subscriber sees events published after it
 * attached and loads earlier history from the store. Order is the publisher's order; `EventSink` publishes under
 * its append queue, so subscribers see strictly ascending sequences per run.
 */
export class EventBus {
  private readonly listeners = new Set<{ listener: EventListener; runId?: string }>()
  private readonly streamEnds = new Set<() => void>()
  private closed = false

  constructor(private readonly options: EventBusOptions = {}) {}

  subscribe(listener: EventListener, filter: { runId?: string } = {}) {
    const entry = { listener, runId: filter.runId }
    this.listeners.add(entry)
    return () => {
      this.listeners.delete(entry)
    }
  }

  publish(event: TrajectoryEvent) {
    if (this.closed) return
    ;[...this.listeners]
      .filter((entry) => entry.runId === undefined || entry.runId === event.runId)
      .forEach((entry) => {
        try {
          entry.listener(structuredClone(event))
        } catch (error) {
          this.options.onListenerError?.(error)
        }
      })
  }

  /** Ends every stream (events already buffered stay readable); later publishes are ignored. */
  close() {
    this.closed = true
    ;[...this.streamEnds].forEach((end) => end())
  }

  /** Pull-based view of the same stream; ends on `close()` or when `signal` aborts. */
  stream(options: EventStreamOptions = {}): AsyncIterableIterator<TrajectoryEvent> {
    const buffer: TrajectoryEvent[] = []
    let waiting: ((result: IteratorResult<TrajectoryEvent>) => void) | undefined
    let done = false

    const unsubscribe = this.subscribe((event) => {
      if (waiting === undefined) return void buffer.push(event)
      const resolve = waiting
      waiting = undefined
      resolve({ value: event, done: false })
    }, options)

    const finish = () => {
      if (done) return
      done = true
      unsubscribe()
      this.streamEnds.delete(finish)
      options.signal?.removeEventListener("abort", finish)
      const resolve = waiting
      waiting = undefined
      resolve?.({ value: undefined, done: true })
    }

    if (this.closed || options.signal?.aborted) finish()
    else {
      this.streamEnds.add(finish)
      options.signal?.addEventListener("abort", finish, { once: true })
    }

    const iterator: AsyncIterableIterator<TrajectoryEvent> = {
      next: () => {
        const next = buffer.shift()
        if (next !== undefined) return Promise.resolve({ value: next, done: false })
        if (done) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => {
          waiting = resolve
        })
      },
      return: () => {
        finish()
        buffer.length = 0
        return Promise.resolve({ value: undefined, done: true })
      },
      [Symbol.asyncIterator]: () => iterator,
    }
    return iterator
  }
}
