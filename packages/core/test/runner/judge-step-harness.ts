import {
  DefaultRetryConfig,
  type BudgetLimits,
  type ContextEnginePort,
  type ContextItem,
  type ContextPolicy,
  type EventType,
  type ModelAttemptRequest,
  type ModelGatewayPort,
  type ResolvedFlags,
  type SecurityFilterPort,
  type ToolCall,
  type ToolRegistryPort,
  type TrajectoryEvent,
} from "@harness/protocol"
import { EventSink } from "../../src/runner/event-sink"
import { JudgeStep, type JudgeStepInput, type JudgeStepResult } from "../../src/runner/judge-step"
import { createRetryPolicy } from "../../src/runner/retry-policy"
import { evaluateStop, initialNoProgress } from "../../src/runner/stop-conditions"
import { FakeClock, FakeSleep, SeededRandom } from "../../src/testing/deterministic"
import { PassThroughContextEngine } from "../../src/testing/fake-context-engines"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { InMemorySnapshot } from "../../src/testing/in-memory-snapshot"
import { InMemoryToolRegistry } from "../../src/testing/in-memory-tool-registry"
import { RegexSecurityFilter } from "../../src/testing/regex-security-filter"
import { FakeCancellation } from "../../src/testing/scripted-stages"
import { ScriptedModelGateway, type ScriptedModelEntry } from "../../src/testing/scripted-model-gateway"
import { createIdGenerator } from "../../src/util/id"

export const vaultLines = Array.from({ length: 30 }, (_, index) => `line ${index + 1} of Vault.sol`)

export const files = {
  "src/Vault.sol": `${vaultLines.join("\n")}\n`,
  "secrets/key.txt": "hunter2\n",
}

export const invalidVerdict = {
  validity: "invalid",
  verificationStatus: "FAIL",
  reasonCode: "BENIGN_MECHANICS",
  confidence: "MEDIUM",
  summary: "The PoC only shows a normal withdrawal.",
  reasoning: "The asserted balance change is the user's own deposit coming back, which is intended behavior.",
}

export const validVerdict = {
  validity: "valid",
  verificationStatus: "PASS",
  reasonCode: "EXPLOIT_CONFIRMED",
  severity: "HIGH",
  confidence: "HIGH",
  summary: "Withdraw lets an attacker drain the vault.",
  reasoning: "The trace shows the attacker balance increasing after reentering withdraw before the state update.",
  citesEvidence: [{ filePath: "src/Vault.sol", startLine: 10, endLine: 20, explanation: "state update after call" }],
}

export const policy: ContextPolicy = {
  policyVersion: "test-policy-1",
  windowLimitTokens: 100_000,
  outputReserveTokens: 4_000,
  compactionThreshold: 0.8,
  recentWindowTokens: 10_000,
  toolOutputMaxTokens: 4_000,
  toolOutputMaxLines: 50,
  maxCompactions: 2,
  flags: {
    enableToolTruncation: true,
    enableObsMasking: true,
    enableSupersedeReads: true,
    enableDropEmpty: true,
    enableLlmCompaction: true,
    enableSessionNote: false,
  },
}

export const flags: ResolvedFlags = {
  ...policy.flags,
  enableSchemaRepair: true,
  enableMaxStepsForcing: true,
  enableNoProgressDetection: true,
  enableInfraRetry: true,
  enableParallelToolDispatch: true,
}

export const limits: BudgetLimits = {
  wallClockTimeoutMs: 3_600_000,
  costCeilingUsd: 10,
  totalTokenBudget: 1_000_000,
  maxSteps: 10,
  noProgressMaxRepeats: 3,
}

export const baseItems: ContextItem[] = [
  { id: "itm-system", turn: 0, type: "system_prompt", isPinned: true, content: "You are the Judge." },
  { id: "itm-finding", turn: 0, type: "candidate_finding", isPinned: true, content: "Vault withdraw is reentrant." },
]

/** Records the order in which the step reaches each port; entries carry the content each port saw where it matters. */
export type LogEntry =
  | { port: "prepare" }
  | { port: "gateway" }
  | { port: "record"; totalTokens: number }
  | { port: "filter"; content: string }
  | { port: "shape"; content: string }
  | { port: "tool"; toolName: string }

class LoggedEngine implements ContextEnginePort {
  constructor(
    private readonly inner: ContextEnginePort,
    private readonly log: LogEntry[],
  ) {}

  prepare(input: Parameters<ContextEnginePort["prepare"]>[0]) {
    this.log.push({ port: "prepare" })
    return this.inner.prepare(input)
  }

  record(input: Parameters<ContextEnginePort["record"]>[0]) {
    this.log.push({ port: "record", totalTokens: input.actualUsage.totalTokens })
    return this.inner.record(input)
  }

  shapeToolResult(input: Parameters<ContextEnginePort["shapeToolResult"]>[0]) {
    this.log.push({ port: "shape", content: input.content })
    return this.inner.shapeToolResult(input)
  }
}

class LoggedGateway implements ModelGatewayPort {
  constructor(
    private readonly inner: ModelGatewayPort,
    private readonly log: LogEntry[],
  ) {}

  executeAttempt(request: ModelAttemptRequest, signal?: AbortSignal) {
    this.log.push({ port: "gateway" })
    return this.inner.executeAttempt(request, signal)
  }
}

class LoggedSecurity implements SecurityFilterPort {
  constructor(
    private readonly inner: SecurityFilterPort,
    private readonly log: LogEntry[],
  ) {}

  filterSecrets(content: string, signal?: AbortSignal) {
    this.log.push({ port: "filter", content })
    return this.inner.filterSecrets(content, signal)
  }
}

class LoggedRegistry implements ToolRegistryPort {
  constructor(
    private readonly inner: ToolRegistryPort,
    private readonly log: LogEntry[],
  ) {}

  definitions() {
    return this.inner.definitions()
  }

  execute(call: ToolCall, signal?: AbortSignal) {
    this.log.push({ port: "tool", toolName: call.toolName })
    return this.inner.execute(call, signal)
  }
}

export interface HarnessOptions {
  script: ScriptedModelEntry[]
  engine?: ContextEnginePort
  flags?: Partial<ResolvedFlags>
  limits?: Partial<BudgetLimits>
  deniedPrefixes?: string[]
  files?: Record<string, string>
}

export const createHarness = async (options: HarnessOptions) => {
  const clock = new FakeClock(Date.parse("2026-03-01T00:00:00.000Z"))
  const startedAtMs = clock.nowMs()
  const random = new SeededRandom(7)
  const sleep = new FakeSleep(clock)
  const store = new InMemoryRunStore({ clock, leaseMs: 100_000_000 })
  store.seedRun("run-1", "running")
  const claimed = await store.claim({ runId: "run-1", workerId: "worker-a" })
  if (claimed.kind !== "claimed") throw new Error("expected a claim")
  const log: LogEntry[] = []
  const resolvedFlags = { ...flags, ...options.flags }
  const resolvedLimits = { ...limits, ...options.limits }
  const gateway = new ScriptedModelGateway(options.script)
  const cancellation = new FakeCancellation()
  const registry = new InMemoryToolRegistry({
    files: options.files ?? files,
    deniedPrefixes: options.deniedPrefixes ?? ["secrets"],
  })
  const engine = options.engine ?? new PassThroughContextEngine()
  const sink = new EventSink({
    store,
    claim: claimed.claim,
    expectedStateVersion: claimed.stateVersion,
    ids: createIdGenerator({ clock: () => clock.nowMs(), random: (size) => random.bytes(size) }),
    clock,
  })
  const retryPolicy = createRetryPolicy({
    gateway: new LoggedGateway(gateway, log),
    cancellation,
    sleep,
    random,
    clock,
    config: DefaultRetryConfig,
    flags: { enableInfraRetry: resolvedFlags.enableInfraRetry },
  })
  const step = new JudgeStep({
    contextEngine: new LoggedEngine(engine, log),
    retryPolicy,
    security: new LoggedSecurity(new RegexSecurityFilter(), log),
    snapshot: new InMemorySnapshot({ snapshotId: "snap-1", files: options.files ?? files }),
    cancellation,
    sink,
    clock,
    ids: createIdGenerator({ clock: () => clock.nowMs(), random: (size) => random.bytes(size) }),
  })

  const input = (overrides: Partial<JudgeStepInput> = {}): JudgeStepInput => ({
    findingId: "finding-7",
    snapshotId: "snap-1",
    profileId: "profile-a",
    stepIndex: 1,
    items: baseItems,
    tools: new LoggedRegistry(registry, log),
    flags: resolvedFlags,
    policy,
    modelLimits: { maxContextTokens: 128_000, maxOutputTokens: 4_000, safetyMarginFactor: 1.1 },
    budget: { totalTokensUsed: 0, totalTokenLimit: 1_000_000, compactionsCount: 0, costUsd: 0, costCeilingUsd: 10 },
    limits: resolvedLimits,
    stopState: {
      startedAtMs,
      costUsd: 0,
      totalTokens: 0,
      completedSteps: 0,
      contextBudgetExhausted: false,
      noProgress: initialNoProgress,
    },
    repairsUsed: 0,
    ...overrides,
  })

  const events = async (type?: EventType) =>
    (await store.loadEvents({ runId: "run-1" })).filter((event) => type === undefined || event.type === type)

  /** A minimal stand-in for the runner: loops steps, appends new items, sums usage and checks stop conditions. */
  const drive = async () => {
    const results: JudgeStepResult[] = []
    let items = baseItems
    let repairsUsed = 0
    let costUsd = 0
    let totalTokens = 0
    for (let stepIndex = 1; ; stepIndex += 1) {
      const stopState = {
        startedAtMs,
        costUsd,
        totalTokens,
        completedSteps: stepIndex - 1,
        contextBudgetExhausted: false,
        noProgress: initialNoProgress,
      }
      const stop = evaluateStop(stopState, resolvedLimits, clock.nowMs())
      if (stop.selected !== undefined) return { end: "budget_exhausted" as const, reason: stop.selected, results }
      const result = await step.execute(input({ stepIndex, items, repairsUsed, stopState }))
      results.push(result)
      costUsd += result.usage.costUsd
      totalTokens += result.usage.totalTokens
      if (result.outcome.type !== "continue_turn") return { end: result.outcome.type, outcome: result.outcome, results }
      items = [...items, ...result.newItems]
      repairsUsed = result.repairsUsed
    }
  }

  return { clock, store, gateway, registry, engine, cancellation, sleep, log, step, input, events, drive }
}

export const payloadsOf = (events: readonly TrajectoryEvent[]) => events.map((event) => event.payload)
