import type { VerificationPort } from "./contracts"

export type { VerificationPort, VerificationResult, StateProbeResult, StateDelta } from "./contracts"

const unavailable = { outcome: "unavailable", exitCode: -1, trace: "", durationMs: 0 } as const

export const unavailableVerification: VerificationPort = {
  async runSingleShot() { return { ...unavailable } },
  async runStateProbe() { return { ...unavailable, stateDeltas: [] } },
}
