import type {
  CancellationPort,
  IngestionPort,
  IngestionResult,
  SandboxPort,
  SandboxResult,
  SanitizerPort,
  SanitizerResult,
  StageInput,
  StateProbeResult,
  CandidateFinding,
} from "@harness/protocol"

/** Results are returned verbatim, one per call; once the list is used up the last one repeats. */
class ResultScript<Result> {
  private index = 0

  constructor(
    private readonly name: string,
    private readonly results: readonly Result[] | undefined,
  ) {}

  next() {
    const results = this.results
    if (results === undefined || results.length === 0) throw new Error(`${this.name}: no result was scripted`)
    const result = results[Math.min(this.index, results.length - 1)]
    this.index += 1
    return result
  }
}

export class ScriptedIngestion implements IngestionPort {
  readonly calls: Array<StageInput & { finding: CandidateFinding }> = []
  private readonly script: ResultScript<IngestionResult>

  constructor(results: readonly [IngestionResult, ...IngestionResult[]]) {
    this.script = new ResultScript("ScriptedIngestion", results)
  }

  async ingest(input: StageInput & { finding: CandidateFinding }, signal?: AbortSignal) {
    signal?.throwIfAborted()
    this.calls.push(structuredClone(input))
    return this.script.next()
  }
}

export interface ScriptedSanitizerOptions {
  /** Builds the probed test file; the default appends a comment naming the probed variables. */
  probe?: (stitchedTestFile: string, stateVariables: string[]) => string
}

export class ScriptedSanitizer implements SanitizerPort {
  readonly sanitizeCalls: Array<StageInput & { pocCode: string }> = []
  readonly probeCalls: Array<{ stitchedTestFile: string; stateVariables: string[] }> = []
  private readonly script: ResultScript<SanitizerResult>
  private readonly probe: (stitchedTestFile: string, stateVariables: string[]) => string

  constructor(results: readonly [SanitizerResult, ...SanitizerResult[]], options: ScriptedSanitizerOptions = {}) {
    this.script = new ResultScript("ScriptedSanitizer", results)
    this.probe =
      options.probe ??
      ((stitchedTestFile, stateVariables) => `${stitchedTestFile}\n// state probes: ${stateVariables.join(", ")}\n`)
  }

  async sanitize(input: StageInput & { pocCode: string }, signal?: AbortSignal) {
    signal?.throwIfAborted()
    this.sanitizeCalls.push(structuredClone(input))
    return this.script.next()
  }

  async injectStateProbes(stitchedTestFile: string, stateVariables: string[], signal?: AbortSignal) {
    signal?.throwIfAborted()
    this.probeCalls.push({ stitchedTestFile, stateVariables: [...stateVariables] })
    return { probedTestFile: this.probe(stitchedTestFile, stateVariables) }
  }
}

export interface ScriptedSandboxResults {
  singleShot?: readonly [SandboxResult, ...SandboxResult[]]
  stateProbe?: readonly [StateProbeResult, ...StateProbeResult[]]
}

export class ScriptedSandbox implements SandboxPort {
  readonly singleShotCalls: Array<StageInput & { testFile: string }> = []
  readonly stateProbeCalls: Array<StageInput & { probedTestFile: string }> = []
  private readonly singleShot: ResultScript<SandboxResult>
  private readonly stateProbe: ResultScript<StateProbeResult>

  constructor(results: ScriptedSandboxResults) {
    this.singleShot = new ResultScript("ScriptedSandbox.runSingleShot", results.singleShot)
    this.stateProbe = new ResultScript("ScriptedSandbox.runStateProbe", results.stateProbe)
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

/** Cancellation is requested for a run id, or from a given poll number onward. */
export class FakeCancellation implements CancellationPort {
  readonly polls: string[] = []
  private readonly requested = new Set<string>()
  private requestAfterPolls: number | undefined

  request(runId: string) {
    this.requested.add(runId)
  }

  /** The poll with this 1-based number, and every later one, reports a request. */
  requestOnPoll(pollNumber: number) {
    this.requestAfterPolls = pollNumber
  }

  async isRequested(runId: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    this.polls.push(runId)
    if (this.requestAfterPolls !== undefined && this.polls.length >= this.requestAfterPolls) return true
    return this.requested.has(runId)
  }
}
