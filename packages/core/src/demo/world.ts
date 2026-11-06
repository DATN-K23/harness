import type {
  ContextEnginePort,
  IngestionResult,
  NewTrajectoryEvent,
  RunState,
  RunStorePort,
  SandboxResult,
  SanitizerResult,
  StateProbeResult,
  TrajectoryEvent,
} from "@harness/protocol"
import { EventBus } from "../runner/event-bus"
import { JudgeRunner, type JudgeRunConfig, type JudgeRunResult } from "../runner/judge-runner"
import { FakeClock, FakeSleep, SeededRandom } from "../testing/deterministic"
import { PassThroughContextEngine } from "../testing/fake-context-engines"
import { InMemoryRunStore } from "../testing/in-memory-run-store"
import { InMemorySnapshot } from "../testing/in-memory-snapshot"
import { InMemoryToolRegistry } from "../testing/in-memory-tool-registry"
import { RegexSecurityFilter } from "../testing/regex-security-filter"
import { ScriptedModelGateway, type ScriptedModelEntry } from "../testing/scripted-model-gateway"
import { FakeCancellation, ScriptedIngestion, ScriptedSandbox, ScriptedSanitizer } from "../testing/scripted-stages"
import { createIdGenerator } from "../util/id"
import { DemoSnapshotId, demoInput, snapshotFiles } from "./fixtures"
import { recordStages, type StageRecord } from "./recorder"

/** One scenario: the scripted ports and model, plus how the run is disturbed. Everything is offline and seeded. */
export interface ScenarioSpec {
  name: string
  ingestion: IngestionResult
  sanitizer: SanitizerResult
  sandbox: SandboxResult
  stateProbes?: StateProbeResult[]
  script: ScriptedModelEntry[]
  engine?: () => ContextEnginePort
  config?: Partial<JudgeRunConfig>
  /** Cancellation is requested from this 1-based poll number onward. */
  cancelOnPoll?: number
  /** Worker A loses the store when step `atStep` is allocated; worker B takes over after the lease and continues. */
  interrupt?: { atStep: number; takeoverScript: ScriptedModelEntry[] }
}

export interface ScenarioRun {
  name: string
  runId: string
  result: JudgeRunResult | undefined
  rejection?: string
  events: TrajectoryEvent[]
  /** Events as the live bus delivered them during the run. */
  streamed: TrajectoryEvent[]
  stages: StageRecord
  runState: RunState | undefined
}

export interface ScenarioOptions {
  seed: number
  runId: string
  /** Wraps the store the runner and the observation use; the stress negative test injects a faulty one here. */
  decorateStore?: (store: RunStorePort) => RunStorePort
}

/** Fails every write from the first matching append on, like a worker that loses its database, until healed. */
class InterruptibleStore implements RunStorePort {
  private matches: ((event: NewTrajectoryEvent) => boolean) | undefined
  private down = false

  constructor(private readonly inner: RunStorePort) {}

  admit(...args: Parameters<RunStorePort["admit"]>) {
    return this.inner.admit(...args)
  }

  interruptWhen(matches: (event: NewTrajectoryEvent) => boolean) {
    this.matches = matches
  }

  heal() {
    this.matches = undefined
    this.down = false
  }

  claim(...args: Parameters<RunStorePort["claim"]>) {
    return this.inner.claim(...args)
  }

  async appendEvent(...args: Parameters<RunStorePort["appendEvent"]>) {
    if (this.matches?.(args[0].event)) this.down = true
    if (this.down) throw new Error("store unavailable")
    return this.inner.appendEvent(...args)
  }

  async transition(...args: Parameters<RunStorePort["transition"]>) {
    if (this.down) throw new Error("store unavailable")
    return this.inner.transition(...args)
  }

  loadRun(...args: Parameters<RunStorePort["loadRun"]>) {
    return this.inner.loadRun(...args)
  }

  loadEvents(...args: Parameters<RunStorePort["loadEvents"]>) {
    return this.inner.loadEvents(...args)
  }
}

const StartMs = Date.parse("2026-03-01T00:00:00.000Z")
const InterruptLeaseMs = 1_000

export const runScenario = async (spec: ScenarioSpec, options: ScenarioOptions): Promise<ScenarioRun> => {
  const { runId } = options
  const clock = new FakeClock(StartMs)
  const inner = new InMemoryRunStore({ clock, leaseMs: spec.interrupt ? InterruptLeaseMs : 100_000_000 })
  inner.seedRun(runId)
  const interruptible = new InterruptibleStore(inner)
  const store = options.decorateStore?.(interruptible) ?? interruptible
  const bus = new EventBus()
  const streamed: TrajectoryEvent[] = []
  bus.subscribe((event) => streamed.push(event), { runId })
  const cancellation = new FakeCancellation()
  if (spec.cancelOnPoll !== undefined) cancellation.requestOnPoll(spec.cancelOnPoll)
  const stages: StageRecord = { stateProbes: [] }
  const input = demoInput(spec.config)
  let workers = 0

  const worker = (script: ScriptedModelEntry[], engine: ContextEnginePort) => {
    const random = new SeededRandom(options.seed + workers)
    workers += 1
    const sleep = new FakeSleep(clock)
    const recorded = recordStages(
      {
        ingestion: new ScriptedIngestion([spec.ingestion]),
        sanitizer: new ScriptedSanitizer([spec.sanitizer]),
        sandbox: new ScriptedSandbox({
          singleShot: [spec.sandbox],
          ...(spec.stateProbes === undefined || spec.stateProbes.length === 0
            ? {}
            : { stateProbe: spec.stateProbes as [StateProbeResult, ...StateProbeResult[]] }),
        }),
      },
      stages,
    )
    return new JudgeRunner({
      store,
      contextEngine: engine,
      gateway: new ScriptedModelGateway(script, { sleep }),
      tools: new InMemoryToolRegistry({ files: snapshotFiles, deniedPrefixes: ["secrets"] }),
      security: new RegexSecurityFilter(),
      snapshot: new InMemorySnapshot({ snapshotId: DemoSnapshotId, files: snapshotFiles }),
      ...recorded,
      cancellation,
      clock,
      random,
      sleep,
      ids: createIdGenerator({ clock: () => clock.nowMs(), random: (size) => random.bytes(size) }),
      bus,
      setTimer: () => () => {},
    })
  }

  const start = async (workerId: string, runner: JudgeRunner) => {
    const claimed = await store.claim({ runId, workerId })
    if (claimed.kind !== "claimed") throw new Error(`claim refused: ${claimed.reason}`)
    return runner.run(claimed.claim, input)
  }

  type Settled = { result: JudgeRunResult | undefined; rejection: string | undefined }
  const settle = (run: Promise<JudgeRunResult>): Promise<Settled> =>
    run.then(
      (result) => ({ result, rejection: undefined }),
      (error: unknown) => ({ result: undefined, rejection: error instanceof Error ? error.message : String(error) }),
    )

  const interrupt = spec.interrupt
  if (interrupt !== undefined)
    interruptible.interruptWhen(
      (event) => event.type === "context.allocated" && event.payload.stepIndex === interrupt.atStep,
    )

  const first = await settle(start("worker-a", worker(spec.script, spec.engine?.() ?? new PassThroughContextEngine())))
  const takeover = async (): Promise<Settled> => {
    if (interrupt === undefined || first.result?.kind !== "error") return first
    interruptible.heal()
    clock.advance(2 * InterruptLeaseMs)
    return settle(start("worker-b", worker(interrupt.takeoverScript, new PassThroughContextEngine())))
  }
  const { result, rejection } = await takeover()

  return {
    name: spec.name,
    runId,
    result,
    ...(rejection === undefined ? {} : { rejection }),
    events: await store.loadEvents({ runId }),
    streamed,
    stages,
    runState: (await store.loadRun(runId))?.state,
  }
}
