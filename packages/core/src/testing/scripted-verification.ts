import type { VerificationPort, VerificationResult, StateProbeResult } from "../verification"
import type {
  StageInput,
} from "@harness/protocol"

/** Results are returned verbatim, one per call; once the list is used up the last one repeats. */
class ResultScript<Result> {
  private index = 0

  constructor(
    private readonly name: string,
    private readonly results: readonly Result[] | undefined,
  ) {}

  next(): Result {
    const results = this.results
    if (results === undefined || results.length === 0) {
      throw new Error(`${this.name}: no result was scripted`)
    }
    const result = results[Math.min(this.index, results.length - 1)]
    this.index += 1
    return result
  }
}

export interface ScriptedVerificationResults {
  singleShot?: readonly [VerificationResult, ...VerificationResult[]]
  stateProbe?: readonly [StateProbeResult, ...StateProbeResult[]]
}

export class ScriptedVerification implements VerificationPort {
  readonly supportsStateProbe: boolean
  readonly singleShotCalls: Array<StageInput & { testFile: string }> = []
  readonly stateProbeCalls: Array<StageInput & { probedTestFile: string }> = []
  private readonly singleShot: ResultScript<VerificationResult>
  private readonly stateProbe: ResultScript<StateProbeResult>

  constructor(results: ScriptedVerificationResults) {
    this.supportsStateProbe = results.stateProbe !== undefined
    this.singleShot = new ResultScript("ScriptedVerification.runSingleShot", results.singleShot)
    this.stateProbe = new ResultScript("ScriptedVerification.runStateProbe", results.stateProbe)
  }

  async runSingleShot(input: StageInput & { testFile: string }, signal?: AbortSignal) {
    signal?.throwIfAborted()
    this.singleShotCalls.push(structuredClone(input))
    return this.singleShot.next()
  }

  async runStateProbe(input: StageInput & { probedTestFile: string }, signal?: AbortSignal) {
    signal?.throwIfAborted()
    this.stateProbeCalls.push(structuredClone(input))
    return this.stateProbe.next()
  }
}
