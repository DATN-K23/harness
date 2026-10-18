import { describe, expect, test } from "bun:test"
import {
  ContextFlagNames,
  DefaultRetryConfig,
  ResolvedFlagNames,
  type ContextPolicy,
  type ModelAttemptRequest,
  type ModelAttemptResponse,
  type ModelGatewayPort,
  type SourceSnapshotPort,
  type ToolCall,
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolRegistryPort,
  type ToolLimits,
  type ResolvedFlags,
} from "@harness/protocol"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { MultiTurnRunner } from "../../src/runner/multi-turn-runner"
import { EventSink } from "../../src/runner/event-sink"
import { buildRunConfigSnapshot } from "../../src/runner/run-config"
import { createIdGenerator } from "../../src/util/id"

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.001 }
const limits = {
  wallClockTimeoutMs: 60_000,
  costCeilingUsd: 5,
  totalTokenBudget: 100_000,
  maxSteps: 10,
  maxToolCalls: 20,
  noProgressMaxRepeats: 3,
}

class Snapshot implements SourceSnapshotPort {
  listCalls = 0

  async listFiles() {
    this.listCalls += 1
    return ["src/Vault.sol"]
  }

  async readLines() {
    return { kind: "ok" as const, lines: [] }
  }
}

class Registry implements ToolRegistryPort {
  calls: ToolCall[] = []
  content = "// source"
  isError = false

  definitions(): readonly ToolDefinition[] {
    return [
      {
        name: "read_file",
        description: "read source",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ]
  }

  async execute(call: ToolCall): Promise<ToolExecutionResult> {
    this.calls.push(call)
    return { content: this.content, isError: this.isError }
  }
}

class QueueGateway implements ModelGatewayPort {
  requests: ModelAttemptRequest[] = []
  calls = 0

  constructor(private readonly responses: ModelAttemptResponse[]) {}

  async executeAttempt(request: ModelAttemptRequest): Promise<ModelAttemptResponse> {
    this.calls += 1
    this.requests.push(request)
    return this.responses.shift() ?? {
      attemptId: `fallback-${this.calls}`,
      finishReason: "stop",
      content: "Done",
      usage,
      latencyMs: 1,
    }
  }
}

const answer = (overrides: Partial<ModelAttemptResponse> = {}): ModelAttemptResponse => ({
  attemptId: "attempt",
  finishReason: "stop",
  content: "Done",
  usage,
  latencyMs: 1,
  ...overrides,
})

const call = (id: string, path = "src/Vault.sol"): ToolCall => ({
  runId: "provider-run",
  callId: id,
  toolName: "read_file",
  arguments: { path },
})

const toolResponse = (calls: ToolCall[], usageOverride = usage): ModelAttemptResponse => ({
  attemptId: "tool-attempt",
  finishReason: "tool_calls",
  toolCalls: calls.map(({ callId, toolName, arguments: args }) => ({ id: callId, name: toolName, arguments: args })),
  usage: usageOverride,
  latencyMs: 1,
})

const makeRunner = (input: {
  store?: InMemoryRunStore
  gateway: ModelGatewayPort
  registry?: Registry & { readonly snapshotId?: string; limits?: () => ToolLimits }
  snapshot?: Snapshot
  clock?: { nowMs: () => number }
  skippedFiles?: () => Promise<Array<{ path: string; reason: string }>>
}) => {
  const store = input.store ?? new InMemoryRunStore({ clock: input.clock ?? { nowMs: () => 1000 } })
  const snapshot = input.snapshot ?? new Snapshot()
  const registry = input.registry ?? new Registry()
  return {
    runner: new MultiTurnRunner({
      store,
      gateway: input.gateway,
      registry,
      snapshot,
      clock: input.clock,
      skippedFiles: input.skippedFiles,
    }),
    store,
    snapshot,
    registry,
  }
}

describe("multi-turn runner hardening", () => {
  test("rejects a registry bound to another snapshot before snapshot access or provider use", async () => {
    const snapshot = new Snapshot()
    const gateway = new QueueGateway([answer()])
    const registry = Object.assign(new Registry(), { snapshotId: "snapshot-2" })
    const { runner } = makeRunner({ gateway, registry, snapshot })

    const result = await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })

    expect(result.terminalReason).toBe("invalid_input")
    expect(snapshot.listCalls).toBe(0)
    expect(gateway.calls).toBe(0)
  })

  test("rejects resume with a different snapshot before snapshot access", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    store.seedRun("resume-snapshot-identity", "queued", "Audit", "snapshot-1")
    const snapshot = new Snapshot()
    const gateway = new QueueGateway([answer()])
    const { runner } = makeRunner({ store, gateway, snapshot })

    const result = await runner.execute({
      runId: "resume-snapshot-identity",
      prompt: "Audit",
      snapshotId: "snapshot-2",
    })

    expect(result.terminalReason).toBe("invalid_input")
    expect(snapshot.listCalls).toBe(0)
    expect(gateway.calls).toBe(0)
  })

  test("rejects resume with a different prompt before snapshot access", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    store.seedRun("resume-prompt-identity", "queued", "Audit", "snapshot-1")
    const snapshot = new Snapshot()
    const gateway = new QueueGateway([answer()])
    const { runner } = makeRunner({ store, gateway, snapshot })

    const result = await runner.execute({
      runId: "resume-prompt-identity",
      prompt: "Different prompt",
      snapshotId: "snapshot-1",
    })

    expect(result.terminalReason).toBe("invalid_input")
    expect(snapshot.listCalls).toBe(0)
    expect(gateway.calls).toBe(0)
  })

  test("rejects an oversized prompt before snapshot access", async () => {
    const snapshot = new Snapshot()
    const gateway = new QueueGateway([answer()])
    const { runner } = makeRunner({ gateway, snapshot })

    const result = await runner.execute({ prompt: "four", snapshotId: "snapshot-1", maxPromptLength: 3 })

    expect(result.terminalReason).toBe("invalid_input")
    expect(snapshot.listCalls).toBe(0)
    expect(gateway.calls).toBe(0)
  })

  test("sanitizes nested Windows paths in tool arguments before persistence and the next request", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const registry = new Registry()
    const modelCall = call("read-1", "D:\\repo\\Vault.sol")
    modelCall.arguments.nested = { note: "C:\\Users\\NHAT DAT\\AppData\\secret.txt" }
    const gateway = new QueueGateway([toolResponse([modelCall]), answer()])
    const { runner } = makeRunner({ store, gateway, registry })
    const result = await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })

    const events = await store.loadEvents({ runId: result.runId })
    const persisted = JSON.stringify(events)
    const laterRequest = JSON.stringify(gateway.requests[1])

    expect(result.state).toBe("completed")
    expect(persisted).not.toContain("D:\\repo")
    expect(laterRequest).not.toContain("D:\\repo")
    expect(persisted).not.toContain("NHAT DAT")
    expect(laterRequest).not.toContain("NHAT DAT")
  })

  test("preserves path-like comments read from snapshot content", async () => {
    const registry = new Registry()
    registry.content = "// see /docs/spec.md for details"
    const gateway = new QueueGateway([toolResponse([call("comment-read")]), answer()])
    const { runner } = makeRunner({ gateway, registry })

    const result = await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })
    const sourceResult = gateway.requests[1].items.find((item) => item.type === "tool_result")?.content

    expect(result.state).toBe("completed")
    expect(sourceResult).toContain("// see /docs/spec.md for details")
  })

  test("redacts credentials in successful snapshot content and persisted history", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const registry = new Registry()
    registry.content = "key = sk-1234567890abcdef123456"
    const gateway = new QueueGateway([toolResponse([call("credential-read")]), answer()])
    const { runner } = makeRunner({ store, gateway, registry })
    const result = await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })

    const events = await store.loadEvents({ runId: result.runId })
    const sourceResult = gateway.requests[1].items.find((item) => item.type === "tool_result")?.content
    expect(result.state).toBe("completed")
    expect(sourceResult).not.toContain("sk-1234567890abcdef123456")
    expect(JSON.stringify(events)).not.toContain("sk-1234567890abcdef123456")
  })

  test("preserves a GitHub permalink in the assembled prompt", async () => {
    const permalink = "https://github.com/org/repo/blob/abc/src/Vault.sol#L10"
    const gateway = new QueueGateway([answer()])
    const { runner } = makeRunner({ gateway })

    const result = await runner.execute({ prompt: `Audit ${permalink}`, snapshotId: "snapshot-1" })
    const promptItem = gateway.requests[0].items.find((item) => item.type === "candidate_finding")

    expect(result.state).toBe("completed")
    expect(promptItem?.content).toContain(permalink)
  })

  test("stops after a tool-calling response crosses the cost ceiling without dispatching", async () => {
    const registry = new Registry()
    const gateway = new QueueGateway([
      toolResponse([call("cost-call")], { ...usage, costUsd: 0.02 }),
    ])
    const { runner } = makeRunner({ gateway, registry })

    const result = await runner.execute({
      prompt: "Audit",
      snapshotId: "snapshot-1",
      limits: { ...limits, costCeilingUsd: 0.01 },
    })

    expect(result.state).toBe("budget_exhausted")
    expect(result.terminalReason).toBe("cost_budget")
    expect(registry.calls).toHaveLength(0)
    expect(gateway.calls).toBe(1)
  })

  test("checks the output reserve before making a second provider attempt", async () => {
    const registry = new Registry()
    const gateway = new QueueGateway([
      toolResponse([call("reserve-call")], {
        promptTokens: 5000,
        completionTokens: 4500,
        totalTokens: 9500,
        costUsd: 0.001,
      }),
      answer(),
    ])
    const { runner } = makeRunner({ gateway, registry })

    const result = await runner.execute({
      prompt: "Audit",
      snapshotId: "snapshot-1",
      maxOutputTokens: 1024,
      limits: { ...limits, totalTokenBudget: 10_000 },
    })

    expect(result.state).toBe("budget_exhausted")
    expect(result.terminalReason).toBe("total_tokens")
    expect(gateway.calls).toBe(1)
    expect(registry.calls).toHaveLength(1)
  })

  test("announces skipped too-large files but hides denied and symlink paths", async () => {
    const gateway = new QueueGateway([answer()])
    const skippedFiles = [
      ...Array.from({ length: 21 }, (_, index) => ({ path: `src/large-${index}.sol`, reason: "too_large" })),
      { path: ".env.local", reason: "denied" },
      { path: "src/link.sol", reason: "symlink" },
    ]
    const { runner } = makeRunner({ gateway, skippedFiles: async () => skippedFiles })

    const result = await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })
    const systemPrompt = gateway.requests[0].items.find((item) => item.type === "system_prompt")?.content ?? ""

    expect(result.state).toBe("completed")
    expect(systemPrompt).toContain("src/large-0.sol (too_large)")
    expect(systemPrompt).toContain("src/large-19.sol (too_large)")
    expect(systemPrompt).not.toContain("src/large-20.sol")
    expect(systemPrompt).toContain("21 total")
    expect(systemPrompt).not.toContain(".env.local")
    expect(systemPrompt).not.toContain("src/link.sol")
  })

  test("announces binary files as present but unreadable", async () => {
    const gateway = new QueueGateway([answer()])
    const { runner } = makeRunner({
      gateway,
      skippedFiles: async () => [{ path: "src/binary.sol", reason: "binary" }],
    })

    await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })
    const systemPrompt = gateway.requests[0].items.find((item) => item.type === "system_prompt")?.content ?? ""

    expect(systemPrompt).toContain("src/binary.sol (binary)")
    expect(systemPrompt).toContain("1 total")
  })

  test("records the registry's effective tool limits in run.started", async () => {
    const toolLimits = {
      readFile: { maxLines: 2000, maxBytes: 1_048_576 },
      grep: { timeoutMs: 1500, maxScanBytes: 52_428_800, maxLineChars: 500, maxMatches: 100 },
      glob: { maxMatches: 100 },
      listDir: { maxEntries: 200 },
    }
    const registry = Object.assign(new Registry(), { limits: () => toolLimits })
    const gateway = new QueueGateway([answer()])
    const { runner, store } = makeRunner({ gateway, registry })

    const result = await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })
    const events = await store.loadEvents({ runId: result.runId })
    const started = events.find((event) => event.type === "run.started")
    const recorded = (started?.payload as { snapshot: { toolLimits?: typeof toolLimits } }).snapshot.toolLimits

    expect(recorded?.grep.timeoutMs).toBe(1500)
  })

  test("persists each tool request and result before its completion event", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const gateway = new QueueGateway([toolResponse([call("ordered-call")]), answer()])
    const { runner } = makeRunner({ store, gateway })

    const result = await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })
    const events = await store.loadEvents({ runId: result.runId })
    const requestIndex = events.findIndex(
      (event) =>
        event.type === "context.item_added" &&
        (event.payload as { item: { type: string } }).item.type === "tool_request",
    )
    const resultIndex = events.findIndex(
      (event) =>
        event.type === "context.item_added" &&
        (event.payload as { item: { type: string } }).item.type === "tool_result",
    )
    const completedIndex = events.findIndex((event) => event.type === "tool.completed")

    expect(requestIndex).toBeGreaterThan(-1)
    expect(resultIndex).toBeGreaterThan(requestIndex)
    expect(completedIndex).toBeGreaterThan(resultIndex)
  })

  test("persists an error result item before tool.failed and links its item id", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const registry = new Registry()
    registry.isError = true
    const gateway = new QueueGateway([toolResponse([call("failed-call")]), answer()])
    const { runner } = makeRunner({ store, gateway, registry })

    const result = await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })
    const events = await store.loadEvents({ runId: result.runId })
    const resultItemEvent = events.find(
      (event) =>
        event.type === "context.item_added" &&
        (event.payload as { item: { type: string; toolMeta?: { callId?: string } } }).item.type === "tool_result" &&
        (event.payload as { item: { toolMeta?: { callId?: string } } }).item.toolMeta?.callId === "failed-call",
    )
    const failedIndex = events.findIndex((event) => event.type === "tool.failed")
    const failed = events[failedIndex]
    const resultItemId =
      resultItemEvent?.type === "context.item_added"
        ? (resultItemEvent.payload as { item: { id: string } }).item.id
        : undefined

    expect(result.state).toBe("completed")
    expect(resultItemEvent).toBeDefined()
    expect(events.findIndex((event) => event.eventId === resultItemEvent?.eventId)).toBeLessThan(failedIndex)
    expect(failed?.type).toBe("tool.failed")
    expect(failed?.type === "tool.failed" ? failed.payload.itemId : undefined).toBe(resultItemId)
  })

  test("records a model attempt before provider.attempted", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const order: string[] = []
    const recordAttempt = store.recordModelAttempt.bind(store)
    store.recordModelAttempt = async (attempt) => {
      order.push("attempt")
      await recordAttempt(attempt)
    }
    const appendEvent = store.appendEvent.bind(store)
    store.appendEvent = async (input, signal) => {
      if (input.event.type === "provider.attempted") order.push("provider.attempted")
      return appendEvent(input, signal)
    }
    const gateway = new QueueGateway([answer()])
    const { runner } = makeRunner({ store, gateway })

    await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })

    expect(order.indexOf("attempt")).toBeLessThan(order.indexOf("provider.attempted"))
  })

  test("maps rate limits to a transient provider terminal reason", async () => {
    const gateway = new QueueGateway([
      answer({
        finishReason: "error",
        error: { category: "rate_limit", isRetryable: true, message: "Try later" },
      }),
    ])
    const { runner } = makeRunner({ gateway })

    const result = await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })

    expect(result.state).toBe("failed")
    expect(result.terminalReason).toBe("provider_transient_primary")
  })

  test("resolves a claim failure as persistence_failure", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    store.failNext("claim", new Error("claim database unavailable"))
    const gateway = new QueueGateway([answer()])
    const { runner } = makeRunner({ store, gateway })

    const result = await runner.execute({ prompt: "Audit", snapshotId: "snapshot-1" })

    expect(result.state).toBe("failed")
    expect(result.terminalReason).toBe("persistence_failure")
    expect(gateway.calls).toBe(0)
    expect((await store.loadRun(result.runId))?.state).toBe("failed")
  })

  test("completes a final text answer even when its reported usage crosses a limit", async () => {
    const gateway = new QueueGateway([
      answer({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.02 } }),
    ])
    const { runner } = makeRunner({ gateway })

    const result = await runner.execute({
      prompt: "Audit",
      snapshotId: "snapshot-1",
      limits: { ...limits, costCeilingUsd: 0.01 },
    })

    expect(result.state).toBe("completed")
    expect(result.output).toBe("Done")
    expect(result.observedLimits).toContain("cost_budget")
  })
})

const appendResumeHistory = async (
  store: InMemoryRunStore,
  runId: string,
  prompt: string,
  snapshotId: string,
  now: () => number,
  resultCount = 3,
  omitLastCompletion = false,
  runMaxToolCalls = 4,
) => {
  const runLimits = { ...limits, maxToolCalls: runMaxToolCalls }
  const flags = Object.fromEntries(ResolvedFlagNames.map((name) => [name, true])) as ResolvedFlags
  const contextFlags = Object.fromEntries(ContextFlagNames.map((name) => [name, true])) as ContextPolicy["flags"]
  const built = buildRunConfigSnapshot({
    flags,
    policy: {
      policyVersion: "v1",
      windowLimitTokens: 128_000,
      outputReserveTokens: 2048,
      compactionThreshold: 0.8,
      recentWindowTokens: 20_000,
      toolOutputMaxTokens: 4000,
      toolOutputMaxLines: 100,
      maxCompactions: 0,
      flags: contextFlags,
    },
    retry: DefaultRetryConfig,
    limits: runLimits,
    systemPromptDigest: `sha256:${"a".repeat(64)}`,
    verdictSchemaDigest: `sha256:${"b".repeat(64)}`,
  })
  store.seedRun(runId, "queued", prompt, snapshotId)
  const claimed = await store.claim({ runId, workerId: "worker-dead" })
  if (claimed.kind !== "claimed") throw new Error("resume history setup claim failed")
  const ids = createIdGenerator({ clock: now, random: (size) => new Uint8Array(size) })
  const sink = new EventSink({
    store,
    claim: claimed.claim,
    expectedStateVersion: claimed.stateVersion,
    ids,
    clock: { nowMs: now },
  })
  await sink.append("run.started", { snapshot: built.snapshot, snapshotDigest: built.digest })
  const transitioned = await store.transition({
    claim: claimed.claim,
    expectedState: "queued",
    expectedStateVersion: claimed.stateVersion,
    nextState: "running",
  })
  if (transitioned.kind !== "transitioned") throw new Error("resume history setup transition failed")
  sink.setExpectedStateVersion(transitioned.stateVersion)
  await sink.append("step.started", { stepIndex: 3, toolsDisabled: false })

  for (let index = 1; index <= resultCount; index += 1) {
    const callId = `resume-${index}`
    await sink.append("tool.requested", {
      callIndex: index - 1,
      callId,
      toolName: "read_file",
      arguments: { path: `src/${index}.sol` },
    })
    await sink.append("context.item_added", {
      item: {
        id: `request-${index}`,
        turn: 3,
        type: "tool_request",
        isPinned: false,
        content: JSON.stringify({ path: `src/${index}.sol` }),
        toolMeta: { callId, toolName: "read_file" },
      },
    })
    await sink.append("context.item_added", {
      item: {
        id: `result-${index}`,
        turn: 3,
        type: "tool_result",
        isPinned: false,
        content: `real result ${index}`,
        toolMeta: { callId, toolName: "read_file", isError: false },
      },
    })
    if (!omitLastCompletion || index !== resultCount) {
      await sink.append("tool.completed", {
        callIndex: index - 1,
        callId,
        toolName: "read_file",
        durationMs: 1,
        isTruncated: false,
        itemId: `result-${index}`,
      })
    }
  }
}

test("resume restores completed tool calls before applying the next dispatch cap", async () => {
  let currentTime = 1000
  const clock = { nowMs: () => currentTime }
  const store = new InMemoryRunStore({ clock, leaseMs: 10 })
  await appendResumeHistory(store, "resume-tool-cap", "Continue", "snapshot-1", clock.nowMs)
  currentTime = 1011
  const gateway = new QueueGateway([toolResponse([call("new-1"), call("new-2")])])
  const registry = new Registry()
  const { runner } = makeRunner({ store, gateway, registry, clock })

  const result = await runner.execute({
    runId: "resume-tool-cap",
    prompt: "Continue",
    snapshotId: "snapshot-1",
    limits: { ...limits, maxToolCalls: 4 },
  })

  expect(result.state).toBe("budget_exhausted")
  expect(result.terminalReason).toBe("max_tool_calls")
  expect(result.toolCallsExecuted).toBe(3)
  expect(gateway.calls).toBe(1)
  expect(registry.calls).toHaveLength(0)
})

test("restores the persisted run start time before enforcing the wall-clock budget", async () => {
  let currentTime = 1000
  const clock = { nowMs: () => currentTime }
  const store = new InMemoryRunStore({ clock, leaseMs: 10 })
  await appendResumeHistory(store, "resume-wall-clock", "Continue", "snapshot-1", clock.nowMs)
  currentTime = 1051
  const gateway = new QueueGateway([answer()])
  const { runner } = makeRunner({ store, gateway, clock })

  const result = await runner.execute({
    runId: "resume-wall-clock",
    prompt: "Continue",
    snapshotId: "snapshot-1",
    limits: { ...limits, wallClockTimeoutMs: 50 },
  })

  expect(result.state).toBe("budget_exhausted")
  expect(result.terminalReason).toBe("wall_clock")
  expect(gateway.calls).toBe(0)
})

test("stops a resumed run whose completed tool calls already reached its cap", async () => {
  let currentTime = 1000
  const clock = { nowMs: () => currentTime }
  const store = new InMemoryRunStore({ clock, leaseMs: 10 })
  await appendResumeHistory(store, "resume-tool-cap-reached", "Continue", "snapshot-1", clock.nowMs, 3, false, 3)
  currentTime = 1011
  const gateway = new QueueGateway([toolResponse([call("over-cap")])])
  const registry = new Registry()
  const { runner } = makeRunner({ store, gateway, registry, clock })

  const result = await runner.execute({
    runId: "resume-tool-cap-reached",
    prompt: "Continue",
    snapshotId: "snapshot-1",
    limits: { ...limits, maxToolCalls: 3 },
  })

  expect(result.state).toBe("budget_exhausted")
  expect(result.terminalReason).toBe("max_tool_calls")
  expect(result.toolCallsExecuted).toBe(3)
  expect(gateway.calls).toBe(0)
  expect(registry.calls).toHaveLength(0)
})

test("resumes a result persisted before a crash without replacing it with an interruption", async () => {
  let currentTime = 1000
  const clock = { nowMs: () => currentTime }
  const store = new InMemoryRunStore({ clock, leaseMs: 10 })
  await appendResumeHistory(store, "resume-result", "Continue", "snapshot-1", clock.nowMs, 1, true)
  currentTime = 1011
  const gateway = new QueueGateway([answer()])
  const { runner } = makeRunner({ store, gateway, clock })

  const result = await runner.execute({
    runId: "resume-result",
    prompt: "Continue",
    snapshotId: "snapshot-1",
    limits: { ...limits, maxToolCalls: 4 },
  })

  const priorResult = gateway.requests[0].items.find(
    (item) => item.type === "tool_result" && item.toolMeta?.callId === "resume-1",
  )
  expect(result.state).toBe("completed")
  expect(priorResult?.content).toBe("real result 1")
  expect(priorResult?.content).not.toContain("interrupted")
})

test("fails corrupt resumed history with persistence_failure and makes no provider call", async () => {
  const now = 1000
  let currentTime = now
  const clock = { nowMs: () => currentTime }
  const store = new InMemoryRunStore({ clock, leaseMs: 10 })
  const runId = "resume-corrupt"
  store.seedRun(runId, "running", "Continue", "snapshot-1")
  const firstClaim = await store.claim({ runId, workerId: "worker-dead" })
  if (firstClaim.kind !== "claimed") throw new Error("corrupt history setup claim failed")
  const payload = { snapshot: {}, snapshotDigest: "bad-digest" }
  await store.appendEvent({
    claim: firstClaim.claim,
    expectedStateVersion: firstClaim.stateVersion,
    event: {
      eventId: "invalid-started",
      type: "run.started",
      schemaVersion: 1,
      payload,
      payloadDigest: `sha256:${"0".repeat(64)}`,
      occurredAt: new Date(now).toISOString(),
    },
  })
  currentTime = now + 11
  const gateway = new QueueGateway([answer()])
  const { runner } = makeRunner({ store, gateway, clock })

  const result = await runner.execute({
    runId,
    prompt: "Continue",
    snapshotId: "snapshot-1",
  })

  expect(result.state).toBe("failed")
  expect(result.terminalReason).toBe("persistence_failure")
  expect(gateway.calls).toBe(0)
})
