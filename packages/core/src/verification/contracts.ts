import type { LocalExecutionProfile, StageInput, VerificationTelemetry } from "@harness/protocol"

export interface VerificationResult {
  outcome: VerificationTelemetry["outcome"]
  exitCode: number
  trace: string
  durationMs: number
  telemetry?: VerificationTelemetry
}

export interface StateDelta {
  variable: string
  before: string
  after: string
}

export interface StateProbeResult {
  outcome: VerificationResult["outcome"]
  exitCode: number
  trace: string
  stateDeltas: StateDelta[]
}

export interface VerificationPort {
  readonly supportsStateProbe?: boolean
  readonly executionProfile?: Extract<LocalExecutionProfile, { backend: "host" | "scripted" }>
  runSingleShot(input: StageInput & { testFile: string }, signal?: AbortSignal): Promise<VerificationResult>
  runStateProbe(input: StageInput & { probedTestFile: string }, signal?: AbortSignal): Promise<StateProbeResult>
}
