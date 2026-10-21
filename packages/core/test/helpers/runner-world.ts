import { expect } from "bun:test"
import {
  DefaultRetryConfig,
  type CandidateFinding,
  type EventType,
  type IngestionResult,
  type NewTrajectoryEvent,
  type ModelGatewayPort,
  type RunStorePort,
  type SandboxPort,
  type SandboxResult,
  type SanitizerPort,
  type StateProbeResult,
  type SanitizerResult,
} from "@harness/protocol"
import type { SetTimer } from "../../src/runner/cancellation"
import { JudgeRunner, type JudgeRunConfig, type JudgeRunInput } from "../../src/runner/judge-runner"
import { FakeClock, FakeSleep, SeededRandom } from "../../src/testing/deterministic"
import { PassThroughContextEngine, ScriptedContextEngine } from "../../src/testing/fake-context-engines"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { InMemorySnapshot } from "../../src/testing/in-memory-snapshot"
import { InMemoryToolRegistry } from "../../src/testing/in-memory-tool-registry"
import { RegexSecurityFilter } from "../../src/testing/regex-security-filter"
import {
  ScriptedModelGateway,
  textResponse,
  toolCallResponse,
  usageOf,
  type ScriptedModelEntry,
} from "../../src/testing/scripted-model-gateway"
import {
  FakeCancellation,
  ScriptedIngestion,
  ScriptedSandbox,
  ScriptedSanitizer,
} from "../../src/testing/scripted-stages"
import { createIdGenerator } from "../../src/util/id"
import { files, flags, limits, policy, validVerdict } from "../runner/judge-step-harness"

export const RunId = "run-1"

export const finding: CandidateFinding = {
  findingId: "finding-7",
  reportMarkdown: "## Reentrancy in Vault.withdraw\nThe attacker re-enters withdraw before balances are updated.",
}

export const baseConfig: JudgeRunConfig = {
  flags,
  policy,
  retry: DefaultRetryConfig,
  limits,
  modelLimits: { maxContextTokens: 128_000, maxOutputTokens: 4_000, safetyMarginFactor: 1.1 },
  profileId: "profile-a",
}

export const runInput = (config: Partial<JudgeRunConfig> = {}): JudgeRunInput => ({
  finding,
  snapshotId: "snap-1",
  config: { ...baseConfig, ...config },
})

export const okIngestion: IngestionResult = {
  kind: "ok",
  pocCode: "function testExploit() public { vault.withdraw(1 ether); assertGt(attacker.balance, 1 ether); }",
  bceSlices: [{ filePath: "src/Vault.sol", content: "line 10 of Vault.sol", lineRange: [10, 10] }],
}

export const okSanitizer: SanitizerResult = {
  kind: "ok",
  stitchedTestFile: "contract ExploitTest is BaseTest { function testExploit() public {} }",
  hasSubmitterAssertions: true,
  antiCheatReport: { rulesChecked: ["vm-ffi"], findings: [] },
}

export const okSandbox: SandboxResult = {
  exitCode: 0,
  trace: "[PASS] testExploit()\n  withdraw -> call{value}",
  durationMs: 12,
}

export const verdictText = textResponse(JSON.stringify(validVerdict), { usage: usageOf(80, 20, 0.02) })

export const readVault = (id: string, startLine: number, endLine: number) =>
  toolCallResponse([{ id, name: "read_file", arguments: { path: "src/Vault.sol", startLine, endLine } }], {
    usage: usageOf(100, 20, 0.01),
  })

/** Delegates to the in-memory store; a matching append fails once, or (sticky) every write from then on fails. */
export class FaultyStore implements RunStorePort {
  private failure: { matches: (event: NewTrajectoryEvent) => boolean; sticky: boolean } | undefined
  private down = false

  constructor(readonly inner: InMemoryRunStore) {}

  admit(...args: Parameters<RunStorePort["admit"]>) {
    return this.inner.admit(...args)
  }

  commitTerminal(...args: Parameters<NonNullable<RunStorePort["commitTerminal"]>>) {
    const failure = this.failure
    if (failure !== undefined && failure.matches(args[0].event)) {
      if (failure.sticky) this.down = true
      if (!failure.sticky) this.failure = undefined
      throw Object.assign(new Error(`store unavailable while committing ${args[0].event.type}`), { reason: "persistence_failure" })
    }
    if (this.down) throw new Error("store unavailable")
    return this.inner.commitTerminal(...args)
  }

  failWhen(matches: (event: NewTrajectoryEvent) => boolean, options: { sticky: boolean }) {
    this.failure = { matches, ...options }
  }

  heal() {
    this.failure = undefined
    this.down = false
  }

  claim(...args: Parameters<RunStorePort["claim"]>) {
    return this.inner.claim(...args)
  }

  async appendEvent(...args: Parameters<RunStorePort["appendEvent"]>) {
    const failure = this.failure
    if (failure !== undefined && failure.matches(args[0].event)) {
      if (failure.sticky) this.down = true
      if (!failure.sticky) this.failure = undefined
      throw new Error(`store unavailable while appending ${args[0].event.type}`)
    }
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

export interface WorkerOptions {
  script?: ScriptedModelEntry[]
  engine?: PassThroughContextEngine | ScriptedContextEngine
  ingestion?: IngestionResult
  sanitizer?: SanitizerResult
  sandbox?: SandboxResult
  stateProbe?: StateProbeResult
  sanitizerResult?: SanitizerResult
  /** Wraps the scripted gateway or sandbox, e.g. to break a port's contract; the scripted fake stays inspectable. */
  wrapGateway?: (gateway: ScriptedModelGateway) => ModelGatewayPort
  wrapSandbox?: (sandbox: ScriptedSandbox) => SandboxPort
  wrapSanitizer?: (sanitizer: ScriptedSanitizer) => SanitizerPort
  /** Defaults to a timer that never fires. */
  setTimer?: SetTimer
}

export const createWorld = (options: { leaseMs?: number } = {}) => {
  const clock = new FakeClock(Date.parse("2026-03-01T00:00:00.000Z"))
  const store = new FaultyStore(new InMemoryRunStore({ clock, leaseMs: options.leaseMs ?? 100_000_000 }))
  store.inner.seedRun(RunId)
  const cancellation = new FakeCancellation()
  let seed = 1

  const claim = async (workerId: string) => {
    const claimed = await store.claim({ runId: RunId, workerId })
    if (claimed.kind !== "claimed") throw new Error(`claim refused: ${claimed.reason}`)
    return claimed.claim
  }

  const worker = (workerOptions: WorkerOptions = {}) => {
    const random = new SeededRandom(seed++)
    const gateway = new ScriptedModelGateway(workerOptions.script ?? [])
    const engine = workerOptions.engine ?? new PassThroughContextEngine()
    const registry = new InMemoryToolRegistry({ files, deniedPrefixes: ["secrets"] })
    const ingestion = new ScriptedIngestion([workerOptions.ingestion ?? okIngestion])
    const sanitizer = new ScriptedSanitizer([workerOptions.sanitizerResult ?? workerOptions.sanitizer ?? okSanitizer])
    const sandbox = new ScriptedSandbox({
      singleShot: [workerOptions.sandbox ?? okSandbox],
      ...(workerOptions.stateProbe === undefined ? {} : { stateProbe: [workerOptions.stateProbe] }),
    })
    const runner = new JudgeRunner({
      store,
      contextEngine: engine,
      gateway: workerOptions.wrapGateway?.(gateway) ?? gateway,
      tools: registry,
      security: new RegexSecurityFilter(),
      snapshot: new InMemorySnapshot({ snapshotId: "snap-1", files }),
      ingestion,
      sanitizer: workerOptions.wrapSanitizer?.(sanitizer) ?? sanitizer,
      sandbox: workerOptions.wrapSandbox?.(sandbox) ?? sandbox,
      cancellation,
      clock,
      random,
      sleep: new FakeSleep(clock),
      ids: createIdGenerator({ clock: () => clock.nowMs(), random: (size) => random.bytes(size) }),
      setTimer: workerOptions.setTimer ?? (() => () => {}),
    })
    const start = async (workerId = "worker-a", input = runInput()) => runner.run(await claim(workerId), input)
    return { runner, gateway, engine, registry, ingestion, sanitizer, sandbox, start }
  }

  const events = async (type?: EventType) =>
    (await store.loadEvents({ runId: RunId })).filter((event) => type === undefined || event.type === type)
  const state = async () => (await store.loadRun(RunId))?.state

  return { clock, store, cancellation, claim, worker, events, state }
}

export type World = ReturnType<typeof createWorld>
export type Worker = ReturnType<World["worker"]>

export const expectContiguous = async (world: World) => {
  const sequences = (await world.events()).map((event) => event.sequence)
  expect(sequences).toEqual(sequences.map((_, index) => index + 1))
}
