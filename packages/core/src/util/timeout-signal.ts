export interface TimeoutSignal {
  signal: AbortSignal
  /** Clears the timer; call it once the guarded work has settled. */
  dispose: () => void
}

/**
 * A timeout signal backed by an ordinary timer.
 *
 * `AbortSignal.timeout` uses a timer that does not keep the event loop alive, and on Bun for Windows it never
 * fires when it is the only pending work, so an attempt waiting only on that signal hangs forever. The reason is
 * the same `TimeoutError` DOMException that `AbortSignal.timeout` would use.
 */
export function createTimeoutSignal(ms: number): TimeoutSignal {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), ms)
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}
