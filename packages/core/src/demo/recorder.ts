import type { VerificationPort, VerificationResult, StateProbeResult } from "../verification"
import type {
  IngestionPort,
  SanitizerPort,
  SanitizerResult,
} from "@harness/protocol"

/** What the stage ports returned during a run: the bundle's exploit proof is built from this, not re-derived. */
export interface StageRecord {
  pocCode?: string
  sanitizer?: SanitizerResult
  verification?: VerificationResult
  stateProbes: StateProbeResult[]
}

export const recordStages = (
  ports: { ingestion: IngestionPort; sanitizer: SanitizerPort; verification: VerificationPort },
  record: StageRecord,
) => {
  const ingestion: IngestionPort = {
    ingest: async (input, signal) => {
      const result = await ports.ingestion.ingest(input, signal)
      if (result.kind === "ok") record.pocCode = result.pocCode
      return result
    },
  }
  const sanitizer: SanitizerPort = {
    sanitize: async (input, signal) => {
      const result = await ports.sanitizer.sanitize(input, signal)
      record.sanitizer = result
      return result
    },
    injectStateProbes: (stitchedTestFile, stateVariables, signal) =>
      ports.sanitizer.injectStateProbes(stitchedTestFile, stateVariables, signal),
  }
  const verification: VerificationPort = {
    supportsStateProbe: ports.verification.supportsStateProbe,
    runSingleShot: async (input, signal) => {
      const result = await ports.verification.runSingleShot(input, signal)
      record.verification = result
      return result
    },
    runStateProbe: async (input, signal) => {
      const result = await ports.verification.runStateProbe(input, signal)
      record.stateProbes.push(result)
      return result
    },
  }
  return { ingestion, sanitizer, verification }
}
