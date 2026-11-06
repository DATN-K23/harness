import {
  TerminalRunStates,
  type CancellationBoundaries,
  type CancellationPort,
  type ClockPort,
  type RunState,
} from "@harness/protocol"

/** The three places the runner polls: before the stages, before preparing and calling the model, before tools. */
export type RunBoundary = "before_stages" | "before_model" | "before_tools"

export type CancellationBoundary = (typeof CancellationBoundaries)[number]

export type BoundaryCheck =
  | { kind: "continue" }
  /** `boundary` is the event-level name to put in `run.cancelled`. */
  | { kind: "cancel"; boundary: CancellationBoundary }
  /** The run is already terminal: nothing is polled and nothing may be written. */
  | { kind: "terminal" }

export interface BoundaryOptions {
  /** Which stage boundary is being checked; `before_stages` is polled before ingestion and again before the sandbox. */
  stage?: "ingestion" | "sandbox"
  runState?: RunState
  signal?: AbortSignal
}

const isTerminal = (state: RunState) => TerminalRunStates.some((terminal) => terminal === state)

export const checkBoundary = async (
  port: CancellationPort,
  runId: string,
  boundary: RunBoundary,
  options: BoundaryOptions = {},
): Promise<BoundaryCheck> => {
  if (options.runState !== undefined && isTerminal(options.runState)) return { kind: "terminal" }
  if (!(await port.isRequested(runId, options.signal))) return { kind: "continue" }
  if (boundary === "before_model") return { kind: "cancel", boundary: "before_provider_call" }
  if (boundary === "before_tools") return { kind: "cancel", boundary: "before_tool_dispatch" }
  return { kind: "cancel", boundary: options.stage === "sandbox" ? "before_sandbox" : "before_ingestion" }
}

export type RunAbortCause = "cancelled" | "wall_clock_timeout"

export type SetTimer = (ms: number, fire: () => void) => () => void

const systemTimer: SetTimer = (ms, fire) => {
  const handle = setTimeout(fire, ms)
  return () => clearTimeout(handle)
}

export interface RunSignalOptions {
  /** Aborted by whoever observes the cancel flag. */
  cancel?: AbortSignal
  /** Absolute deadline in clock milliseconds. */
  deadlineMs: number
  clock: ClockPort
  /** The only real timer in the module; tests inject a fake. */
  setTimer?: SetTimer
}

export interface RunSignal {
  signal: AbortSignal
  /** Why the signal aborted; the first cause wins. */
  cause(): RunAbortCause | undefined
  /** Clears the deadline timer and detaches from the cancel flag. Call once the run has finished. */
  dispose(): void
}

export const createRunSignal = (options: RunSignalOptions): RunSignal => {
  const controller = new AbortController()
  let abortCause: RunAbortCause | undefined
  const abortWith = (cause: RunAbortCause) => {
    if (abortCause !== undefined) return
    abortCause = cause
    controller.abort(cause)
  }
  const onCancel = () => abortWith("cancelled")

  if (options.cancel?.aborted) onCancel()
  const remainingMs = options.deadlineMs - options.clock.nowMs()
  if (abortCause === undefined && remainingMs <= 0) abortWith("wall_clock_timeout")

  const clearTimer =
    abortCause === undefined
      ? (options.setTimer ?? systemTimer)(remainingMs, () => abortWith("wall_clock_timeout"))
      : () => {}
  if (abortCause === undefined) options.cancel?.addEventListener("abort", onCancel)

  const dispose = () => {
    clearTimer()
    options.cancel?.removeEventListener("abort", onCancel)
  }
  controller.signal.addEventListener("abort", dispose)

  return { signal: controller.signal, cause: () => abortCause, dispose }
}
