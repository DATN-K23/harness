import { describe, expect, test } from "bun:test"
import {
  DefaultRetryConfig,
  EventPayloadSchemas,
  JudgeVerdictSchema,
  type CandidateFinding,
  type ContextItem,
  type ContextPolicy,
  type EventType,
  type IngestionResult,
  type NewTrajectoryEvent,
  type RunStorePort,
  type SandboxResult,
  type SanitizerResult,
} from "@harness/protocol"
import {
  JudgeRunner,
  type JudgeRunConfig,
  type JudgeRunInput,
  type JudgeRunResult,
} from "../../src/runner/judge-runner"
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
import { files, flags, limits, policy, validVerdict } from "./judge-step-harness"

const RunId = "run-1"

const finding: CandidateFinding = {
  findingId: "finding-7",
  reportMarkdown: "## Reentrancy in Vault.withdraw\nThe attacker re-enters withdraw before balances are updated.",
}

const baseConfig: JudgeRunConfig = {
  flags,
  policy,
  retry: DefaultRetryConfig,
  limits,
  modelLimits: { maxContextTokens: 128_000, maxOutputTokens: 4_000, safetyMarginFactor: 1.1 },
  profileId: "profile-a",
}

const runInput = (config: Partial<JudgeRunConfig> = {}): JudgeRunInput => ({
  finding,
  snapshotId: "snap-1",
  config: { ...baseConfig, ...config },
})

const okIngestion: IngestionResult = {
  kind: "ok",
  pocCode: "function testExploit() public { vault.withdraw(1 ether); assertGt(attacker.balance, 1 ether); }",
  bceSlices: [{ filePath: "src/Vault.sol", content: "line 10 of Vault.sol", lineRange: [10, 10] }],
}

const okSanitizer: SanitizerResult = {
  kind: "ok",
  stitchedTestFile: "contract ExploitTest is BaseTest { function testExploit() public {} }",
  hasSubmitterAssertions: true,
  antiCheatReport: { rulesChecked: ["vm-ffi"], findings: [] },
}

const okSandbox: SandboxResult = {
  exitCode: 0,
  trace: "[PASS] testExploit()\n  withdraw -> call{value}",
  durationMs: 12,
}

const verdictText = textResponse(JSON.stringify(validVerdict), { usage: usageOf(80, 20, 0.02) })

const readVault = (id: string, startLine: number, endLine: number) =>
  toolCallResponse([{ id, name: "read_file", arguments: { path: "src/Vault.sol", startLine, endLine } }], {
    usage: usageOf(100, 20, 0.01),
  })

/** Delegates to the in-memory store; a matching append fails once, or (sticky) every write from then on fails. */
class FaultyStore implements RunStorePort {
  private failure: { matches: (event: NewTrajectoryEvent) => boolean; sticky: boolean } | undefined
  private down = false

  constructor(readonly inner: InMemoryRunStore) {}

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

interface WorkerOptions {
  script?: ScriptedModelEntry[]
  engine?: PassThroughContextEngine | ScriptedContextEngine
  ingestion?: IngestionResult
  sanitizer?: SanitizerResult
  sandbox?: SandboxResult
}

const createWorld = (options: { leaseMs?: number } = {}) => {
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
    const sanitizer = new ScriptedSanitizer([workerOptions.sanitizer ?? okSanitizer])
    const sandbox = new ScriptedSandbox({ singleShot: [workerOptions.sandbox ?? okSandbox] })
    const runner = new JudgeRunner({
      store,
      contextEngine: engine,
      gateway,
      tools: registry,
      security: new RegexSecurityFilter(),
      snapshot: new InMemorySnapshot({ snapshotId: "snap-1", files }),
      ingestion,
      sanitizer,
      sandbox,
      cancellation,
      clock,
      random,
      sleep: new FakeSleep(clock),
      ids: createIdGenerator({ clock: () => clock.nowMs(), random: (size) => random.bytes(size) }),
      setTimer: () => () => {},
    })
    const start = async (workerId = "worker-a", input = runInput()) => runner.run(await claim(workerId), input)
    return { runner, gateway, engine, registry, ingestion, sanitizer, sandbox, start }
  }

  const events = async (type?: EventType) =>
    (await store.loadEvents({ runId: RunId })).filter((event) => type === undefined || event.type === type)
  const state = async () => (await store.loadRun(RunId))?.state

  return { clock, store, cancellation, claim, worker, events, state }
}

type World = ReturnType<typeof createWorld>
type Worker = ReturnType<World["worker"]>

const expectContiguous = async (world: World) => {
  const sequences = (await world.events()).map((event) => event.sequence)
  expect(sequences).toEqual(sequences.map((_, index) => index + 1))
}

const expectFastReject = async (world: World, worker: Worker, result: JudgeRunResult, reasonCode: string) => {
  expect(result).toMatchObject({
    kind: "committed",
    state: "completed",
    verdict: { reasonCode, validity: "invalid", verificationStatus: "FAIL", confidence: "HIGH" },
  })
  expect(worker.gateway.callCount).toBe(0)
  expect(result.usage.totalTokens).toBe(0)
  expect(worker.engine.prepareCalls).toHaveLength(0)
  expect(await world.state()).toBe("completed")
  const [completed] = await world.events("run.completed")
  expect(JudgeVerdictSchema.safeParse(completed.payload.verdict).success).toBe(true)
  expect(completed.payload.verdict).toMatchObject({ reasonCode, runId: RunId, findingId: finding.findingId })
}

describe("JudgeRunner: state machine", () => {
  test("stale worker: a write after another worker claimed the run is refused and the runner returns", async () => {
    const world = createWorld({ leaseMs: 1_000 })
    const a = world.worker()
    const claimA = await world.claim("worker-a")
    world.clock.advance(2_000)
    await world.claim("worker-b")

    const result = await a.runner.run(claimA, runInput())
    expect(result).toMatchObject({ kind: "stale", reason: "claim_lost" })
    expect(await world.state()).toBe("queued")
    expect(await world.events()).toEqual([])
    expect(a.ingestion.calls).toHaveLength(0)
  })
})

describe("JudgeRunner: zero-token fast-reject", () => {
  test("missing PoC: MISSING_POC, sanitizer and sandbox never called", async () => {
    const world = createWorld()
    const w = world.worker({ ingestion: { kind: "missing_poc" } })
    await expectFastReject(world, w, await w.start(), "MISSING_POC")
    expect(w.sanitizer.sanitizeCalls).toHaveLength(0)
    expect(w.sandbox.singleShotCalls).toHaveLength(0)
    expect((await world.events()).map((event) => event.type)).toEqual([
      "run.started",
      "stage.started",
      "stage.finished",
      "run.completed",
    ])
  })

  test("anti-cheat violation: NON_FAITHFUL_OVERRIDE, sandbox never called", async () => {
    const world = createWorld()
    const w = world.worker({
      sanitizer: { kind: "cheat_detected", findings: [{ ruleId: "vm-ffi", message: "vm.ffi escapes the sandbox" }] },
    })
    await expectFastReject(world, w, await w.start(), "NON_FAITHFUL_OVERRIDE")
    expect(w.sandbox.singleShotCalls).toHaveLength(0)
  })

  test("sandbox failure: EXECUTION_FAILED with zero gateway calls", async () => {
    const world = createWorld()
    const w = world.worker({ sandbox: { exitCode: 1, trace: "[FAIL] testExploit() reverted", durationMs: 4 } })
    await expectFastReject(world, w, await w.start(), "EXECUTION_FAILED")
    const [sandboxFinished] = (await world.events("stage.finished")).filter(
      (event) => event.payload.stage === "sandbox",
    )
    expect(sandboxFinished.payload).toMatchObject({ outcome: "rejected", reasonCode: "EXECUTION_FAILED" })
  })
})

describe("JudgeRunner: reasoning loop", () => {
  test("multi-step run: two tool steps then a verdict completes with three provider attempts", async () => {
    const world = createWorld()
    const w = world.worker({ script: [readVault("call-1", 1, 5), readVault("call-2", 10, 20), verdictText] })
    const result = await w.start()

    expect(result).toMatchObject({ kind: "committed", state: "completed", lastStepIndex: 3 })
    if (result.kind !== "committed") throw new Error("expected a committed run")
    expect(JudgeVerdictSchema.safeParse(result.verdict).success).toBe(true)
    expect(await world.events("provider.attempted")).toHaveLength(3)
    expect(await world.state()).toBe("completed")
    await expectContiguous(world)
    // Every item the model saw was persisted as context.item_added.
    const persisted = new Set(
      (await world.events("context.item_added")).map(
        (event) => EventPayloadSchemas["context.item_added"].parse(event.payload).item.id,
      ),
    )
    expect(w.gateway.calls[2].items.every((item) => persisted.has(item.id))).toBe(true)
  })

  test("max steps: a model that never concludes ends budget_exhausted(max_steps)", async () => {
    const world = createWorld()
    const w = world.worker({ script: [readVault("call-1", 1, 5), readVault("call-2", 6, 9)] })
    const result = await w.start("worker-a", runInput({ limits: { ...limits, maxSteps: 2 } }))
    expect(result).toMatchObject({ kind: "committed", state: "budget_exhausted", terminalReason: "max_steps" })
    expect(w.gateway.callCount).toBe(2)
    expect(w.registry.calls).toHaveLength(0)
  })

  test("no progress: the third identical tool call ends budget_exhausted(no_progress)", async () => {
    const world = createWorld()
    const w = world.worker({
      script: [readVault("call-1", 1, 5), readVault("call-2", 1, 5), readVault("call-3", 1, 5), verdictText],
    })
    const result = await w.start()
    expect(result).toMatchObject({ kind: "committed", state: "budget_exhausted", terminalReason: "no_progress" })
    expect(w.gateway.callCount).toBe(3)
    const [exhausted] = await world.events("run.budget_exhausted")
    expect(exhausted.payload).toEqual({ reason: "no_progress", observedLimits: ["no_progress"] })
  })
})

describe("JudgeRunner: compaction", () => {
  const summarizeUnpinned = (input: { items: ContextItem[] }) => ({
    status: "needs_compaction" as const,
    summaryPrompt: "Summarize the investigation so far.",
    itemsToSummarize: input.items.filter((item) => !item.isPinned),
  })

  test("compaction succeeds: context.compacted persisted, its attempt counted in the totals, run continues", async () => {
    const world = createWorld()
    const engine = new ScriptedContextEngine([
      (input) => ({ status: "ready", preparedItems: input.items }),
      summarizeUnpinned,
    ])
    const summary = textResponse("Step 1 read Vault.sol lines 1-5: withdraw sends ether first.", {
      usage: usageOf(50, 10, 0.005),
    })
    const w = world.worker({ engine, script: [readVault("call-1", 1, 5), summary, verdictText] })
    const result = await w.start()

    expect(result).toMatchObject({ kind: "committed", state: "completed" })
    expect(await world.events("context.compacted")).toHaveLength(1)
    expect(w.gateway.calls[1].toolsDisabled).toBe(true)
    expect(w.gateway.calls[2].items.some((item) => item.type === "compaction_summary")).toBe(true)
    expect(w.gateway.calls[2].items.some((item) => item.type === "tool_result")).toBe(false)
    const attempts = (await world.events("provider.attempted")).map((event) => event.payload)
    const tokens = attempts.reduce((sum, payload) => sum + (payload.usage as { totalTokens: number }).totalTokens, 0)
    const cost = attempts.reduce((sum, payload) => sum + Number(payload.costUsd), 0)
    expect(result.usage.totalTokens).toBe(120 + 60 + 100)
    expect(tokens).toBe(result.usage.totalTokens)
    expect(cost).toBeCloseTo(result.usage.costUsd, 10)
  })

  test("compaction disabled: budget_exhausted(context_budget) and no summary attempt", async () => {
    const world = createWorld()
    const off: ContextPolicy = { ...policy, flags: { ...policy.flags, enableLlmCompaction: false } }
    const w = world.worker({ engine: new ScriptedContextEngine([summarizeUnpinned]), script: [verdictText] })
    const result = await w.start("worker-a", runInput({ policy: off, flags: { ...flags, enableLlmCompaction: false } }))
    expect(result).toMatchObject({ kind: "committed", state: "budget_exhausted", terminalReason: "context_budget" })
    expect(w.gateway.callCount).toBe(0)
    expect(await world.events("context.compacted")).toHaveLength(0)
  })
})

describe("JudgeRunner: recovery by hydration", () => {
  /** Worker A completes steps 1 and 2; the store becomes unreachable when step 3 records its allocation. */
  const crashAtStepThree = async () => {
    const world = createWorld({ leaseMs: 1_000 })
    const a = world.worker({ script: [readVault("call-1", 1, 5), readVault("call-2", 10, 20), verdictText] })
    world.store.failWhen((event) => event.type === "context.allocated" && event.payload.stepIndex === 3, {
      sticky: true,
    })
    const crashed = await a.start("worker-a")
    expect(crashed.kind).toBe("error")
    expect(await world.state()).toBe("running")
    world.store.heal()
    world.clock.advance(2_000)
    return { world, a }
  }

  test("worker killed at step 2: worker B starts at step 3 with A's items and repeats no step", async () => {
    const { world, a } = await crashAtStepThree()
    const b = world.worker({ script: [verdictText] })
    const result = await b.start("worker-b")

    expect(result).toMatchObject({ kind: "committed", state: "completed", lastStepIndex: 3 })
    expect(b.gateway.calls.map((call) => call.stepIndex)).toEqual([3])
    // B's first prepare re-verifies step 2; its second prepares step 3 from the same items A had prepared.
    expect(b.engine.prepareCalls[1].items).toEqual(a.engine.prepareCalls.at(-1)?.items ?? [])
    expect((await world.events("step.started")).map((event) => event.payload.stepIndex)).toEqual([1, 2, 3])
    expect(b.ingestion.calls).toHaveLength(0)
    await expectContiguous(world)
  })

  test("hydration mismatch: failed with persistence_failure and no model call", async () => {
    const { world } = await crashAtStepThree()
    const b = world.worker({ engine: new ScriptedContextEngine([{ status: "ready", preparedItems: [] }]) })
    const result = await b.start("worker-b")

    expect(result).toMatchObject({ kind: "committed", state: "failed", terminalReason: "persistence_failure" })
    expect(b.gateway.callCount).toBe(0)
    const [failed] = await world.events("run.failed")
    expect(failed.payload.reason).toBe("persistence_failure")
  })
})

describe("JudgeRunner: cooperative cancellation", () => {
  // Polls: 1 before ingestion, 2 before the sandbox, 3 before step 1's model call, 4 before its tools, 5 before step 2.
  test("cancel before the provider call of step 2: no attempt for step 2, cancelled, earlier events kept", async () => {
    const world = createWorld()
    world.cancellation.requestOnPoll(5)
    const w = world.worker({ script: [readVault("call-1", 1, 5), verdictText] })
    const result = await w.start()

    expect(result).toMatchObject({ kind: "committed", state: "cancelled", terminalReason: "cancelled_by_user" })
    expect(w.gateway.callCount).toBe(1)
    expect(await world.events("tool.completed")).toHaveLength(1)
    const [cancelled] = await world.events("run.cancelled")
    expect(cancelled.payload).toEqual({ reason: "cancelled_by_user", boundary: "before_provider_call" })
    await expectContiguous(world)
  })

  test("cancel before tool dispatch: the tool never runs", async () => {
    const world = createWorld()
    world.cancellation.requestOnPoll(4)
    const w = world.worker({ script: [readVault("call-1", 1, 5), verdictText] })
    const result = await w.start()

    expect(result).toMatchObject({ kind: "committed", state: "cancelled" })
    expect(w.registry.calls).toHaveLength(0)
    expect(await world.events("tool.requested")).toHaveLength(0)
    const [cancelled] = await world.events("run.cancelled")
    expect(cancelled.payload.boundary).toBe("before_tool_dispatch")
  })
})

describe("JudgeRunner: never crashes the worker", () => {
  test("a tool registry that throws a non-Error value becomes a model-visible error and the run completes", async () => {
    const world = createWorld()
    const w = world.worker({ script: [readVault("call-1", 1, 5), verdictText] })
    w.registry.throwOn("read_file", "adapter exploded")
    const result = await w.start()

    expect(result).toMatchObject({ kind: "committed", state: "completed" })
    const toolResult = w.gateway.calls[1].items.find((item) => item.type === "tool_result")
    expect(toolResult?.toolMeta?.isError).toBe(true)
    expect(toolResult?.content).toContain("adapter exploded")
  })

  test("a store that throws on the terminal write: the runner resolves with a failure result", async () => {
    const world = createWorld()
    world.store.failWhen((event) => event.type === "run.completed", { sticky: false })
    const w = world.worker({ script: [verdictText] })
    const result = await w.start()

    expect(result).toMatchObject({ kind: "committed", state: "failed", terminalReason: "persistence_failure" })
    expect(await world.events("run.completed")).toHaveLength(0)
    expect(await world.state()).toBe("failed")
  })
})

describe("JudgeRunner: agent-visible inputs exclude ground truth", () => {
  test("no field of the run input or a context item is named for a label, adjudication or score", () => {
    // `satisfies Record<keyof T, true>` fails to compile when a field is added to or removed from these types.
    const inputFields = { finding: true, snapshotId: true, config: true } satisfies Record<keyof JudgeRunInput, true>
    const findingFields = { findingId: true, reportMarkdown: true } satisfies Record<keyof CandidateFinding, true>
    const configFields = {
      flags: true,
      policy: true,
      retry: true,
      limits: true,
      maxProbeRuns: true,
      modelLimits: true,
      profileId: true,
    } satisfies Record<keyof JudgeRunConfig, true>
    const itemFields = {
      id: true,
      turn: true,
      type: true,
      isPinned: true,
      content: true,
      toolMeta: true,
    } satisfies Record<keyof ContextItem, true>
    const names = [inputFields, findingFields, configFields, itemFields].flatMap((fields) => Object.keys(fields))
    expect(names.filter((name) => /label|truth|adjudicat|score/i.test(name))).toEqual([])
  })
})
