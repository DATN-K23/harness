import { describe, expect, test } from "bun:test"
import type {
  ModelAttemptRequest,
  ModelAttemptResponse,
  ModelGatewayPort,
  SourceSnapshotPort,
  ToolCall,
  ToolDefinition,
  ToolExecutionResult,
  ToolRegistryPort,
  ToolLimits,
} from "@harness/protocol"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { MultiTurnRunner } from "../../src/runner/multi-turn-runner"
import { getMultiTurnExecutionSummary } from "../../src/runner/run-queries"

class ScriptedGateway implements ModelGatewayPort {
  private step = 0
  readonly calls: ModelAttemptRequest[] = []
  constructor(private readonly responses: ModelAttemptResponse[]) {}

  async executeAttempt(request: ModelAttemptRequest): Promise<ModelAttemptResponse> {
    this.calls.push(request)
    const res = this.responses[this.step] ?? {
      attemptId: `att-${this.step}`,
      finishReason: "stop",
      content: "default answer",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.001 },
      latencyMs: 50,
    }
    this.step += 1
    return res
  }
}

class MockRegistry implements ToolRegistryPort {
  calls: ToolCall[] = []
  definitions(): readonly ToolDefinition[] {
    return [
      {
        name: "read_file",
        description: "read source file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ]
  }

  async execute(call: ToolCall): Promise<ToolExecutionResult> {
    this.calls.push(call)
    if (call.arguments.path === "missing.sol") {
      return { content: "File not found: missing.sol", isError: true }
    }
    return { content: "contract Vault { uint balance; }", isError: false }
  }
}

class MockSnapshot implements SourceSnapshotPort {
  async listFiles() {
    return ["contracts/Vault.sol"]
  }
  async readLines() {
    return { kind: "ok" as const, lines: ["contract Vault {}"] }
  }
}

describe("MultiTurnRunner", () => {
  const clock = { nowMs: () => 1000 }

  test("runs single turn when model does not call any tools", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-1",
        finishReason: "stop",
        content: "No vulnerability detected.",
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30, costUsd: 0.002 },
        latencyMs: 100,
      },
    ])
    const registry = new MockRegistry()
    const snapshot = new MockSnapshot()

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry,
      snapshot,
      clock,
    })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-1",
      profileId: "test-model",
    })

    expect(result.state).toBe("completed")
    expect(result.terminalReason).toBeUndefined()
    expect(result.output).toBe("No vulnerability detected.")
    expect(result.stepsExecuted).toBe(1)
    expect(result.toolCallsExecuted).toBe(0)

    const runRecord = await store.loadRun(result.runId)
    expect(runRecord?.state).toBe("completed")
    expect(runRecord?.snapshotId).toBe("snap-1")

    const attempts = await store.loadModelAttempts(result.runId)
    expect(attempts).toHaveLength(1)
    expect(attempts[0].stepIndex).toBe(1)
  })

  test("executes tool call and continues loop to get final answer", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-1",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call-1",
            name: "read_file",
            arguments: { path: "contracts/Vault.sol" },
          },
        ],
        usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25, costUsd: 0.001 },
        latencyMs: 100,
      },
      {
        attemptId: "att-2",
        finishReason: "stop",
        content: "Found reentrancy in Vault.sol",
        usage: { promptTokens: 40, completionTokens: 15, totalTokens: 55, costUsd: 0.003 },
        latencyMs: 120,
      },
    ])
    const registry = new MockRegistry()
    const snapshot = new MockSnapshot()

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry,
      snapshot,
      clock,
    })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-1",
    })

    expect(result.state).toBe("completed")
    expect(result.output).toBe("Found reentrancy in Vault.sol")
    expect(result.stepsExecuted).toBe(2)
    expect(result.toolCallsExecuted).toBe(1)
    expect(registry.calls).toHaveLength(1)
    expect(registry.calls[0].arguments.path).toBe("contracts/Vault.sol")

    // Verify events: provider.attempted and model.responded for both turns
    const events = await store.loadEvents({ runId: result.runId })
    const eventTypes = events.map((e) => e.type)
    expect(eventTypes).toContain("run.started")
    expect(eventTypes).toContain("tool.requested")
    expect(eventTypes).toContain("tool.completed")
    expect(eventTypes).toContain("model.responded")

    // Verify attempts
    const attempts = await store.loadModelAttempts(result.runId)
    expect(attempts).toHaveLength(2)
    expect(attempts[0].stepIndex).toBe(1)
    expect(attempts[1].stepIndex).toBe(2)
  })

  test("tool failure normalizes to error result and model continues without failing run", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-1",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call-err",
            name: "read_file",
            arguments: { path: "missing.sol" },
          },
        ],
        usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25, costUsd: 0.001 },
        latencyMs: 80,
      },
      {
        attemptId: "att-2",
        finishReason: "stop",
        content: "File was missing, handled gracefully.",
        usage: { promptTokens: 35, completionTokens: 10, totalTokens: 45, costUsd: 0.002 },
        latencyMs: 90,
      },
    ])
    const registry = new MockRegistry()
    const snapshot = new MockSnapshot()

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry,
      snapshot,
      clock,
    })

    const result = await runner.execute({
      prompt: "Audit missing file",
      snapshotId: "snap-1",
    })

    expect(result.state).toBe("completed")
    expect(result.output).toBe("File was missing, handled gracefully.")

    const events = await store.loadEvents({ runId: result.runId })
    const failedToolEvent = events.find((e) => e.type === "tool.failed")
    expect(failedToolEvent).toBeDefined()
  })

  test("stops with max_tool_calls_exceeded when tool call cap is reached", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-1",
        finishReason: "tool_calls",
        toolCalls: [
          { id: "c1", name: "read_file", arguments: { path: "contracts/Vault.sol" } },
          { id: "c2", name: "read_file", arguments: { path: "contracts/Vault.sol" } },
        ],
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30, costUsd: 0.001 },
        latencyMs: 100,
      },
    ])
    const registry = new MockRegistry()
    const snapshot = new MockSnapshot()

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry,
      snapshot,
      clock,
    })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-1",
      limits: {
        wallClockTimeoutMs: 60000,
        costCeilingUsd: 5,
        totalTokenBudget: 100000,
        maxSteps: 10,
        maxToolCalls: 1, // Cap is 1, but model asked for 2
        noProgressMaxRepeats: 3,
      },
    })

    expect(result.state).toBe("budget_exhausted")
    expect(result.terminalReason).toBe("max_tool_calls")
  })

  test("halts when snapshot cannot be accessed before any provider call", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([])
    const registry = new MockRegistry()
    const brokenSnapshot: SourceSnapshotPort = {
      async listFiles() {
        throw new Error("Snapshot not found on disk")
      },
      async readLines() {
        return { kind: "not_found" }
      },
    }

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry,
      snapshot: brokenSnapshot,
      clock,
    })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "nonexistent",
    })

    expect(result.state).toBe("failed")
    expect(result.terminalReason).toBe("snapshot_integrity")
    expect(result.error).toContain("Cannot access snapshot")
    expect(result.stepsExecuted).toBe(0)
  })

  test("consults ToolApprovalPort seam and halts when tool call is denied", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-1",
        finishReason: "tool_calls",
        toolCalls: [
          { id: "c1", name: "read_file", arguments: { path: "contracts/Vault.sol" } },
        ],
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30, costUsd: 0.001 },
        latencyMs: 100,
      },
    ])
    const registry = new MockRegistry()
    const snapshot = new MockSnapshot()

    const denyingApproval = {
      async decide() {
        return "deny" as const
      },
    }

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry,
      snapshot,
      clock,
      approval: denyingApproval,
    })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-1",
    })

    expect(result.state).toBe("cancelled")
    expect(result.terminalReason).toBe("cancelled_by_user")
    expect(registry.calls).toHaveLength(0) // Tool execution was not dispatched!
  })

  test("provider returning finishReason 'stop' with toolCalls continues loop (OpenCode resilience)", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-quirky",
        finishReason: "stop", // Quirky provider returns stop instead of tool_calls
        toolCalls: [
          { id: "c-q", name: "read_file", arguments: { path: "contracts/Vault.sol" } },
        ],
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30, costUsd: 0.001 },
        latencyMs: 100,
      },
      {
        attemptId: "att-final",
        finishReason: "stop",
        content: "Completed despite quirky provider",
        usage: { promptTokens: 30, completionTokens: 10, totalTokens: 40, costUsd: 0.001 },
        latencyMs: 100,
      },
    ])
    const registry = new MockRegistry()
    const snapshot = new MockSnapshot()

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry,
      snapshot,
      clock,
    })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-1",
    })

    expect(result.state).toBe("completed")
    expect(result.output).toBe("Completed despite quirky provider")
    expect(result.stepsExecuted).toBe(2)
    expect(registry.calls).toHaveLength(1)
  })

  test("propagates maxOutputTokens from run input to every provider attempt", async () => {
    const store = new InMemoryRunStore({ clock })
    const recordedRequests: ModelAttemptRequest[] = []

    const capturingGateway: ModelGatewayPort = {
      async executeAttempt(req) {
        recordedRequests.push(req)
        return {
          attemptId: `att-${recordedRequests.length}`,
          finishReason: recordedRequests.length === 1 ? "tool_calls" : "stop",
          toolCalls: recordedRequests.length === 1 ? [{ id: "c1", name: "read_file", arguments: { path: "contracts/Vault.sol" } }] : undefined,
          content: "Done",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
          latencyMs: 50,
        }
      },
    }

    const runner = new MultiTurnRunner({
      store,
      gateway: capturingGateway,
      registry: new MockRegistry(),
      snapshot: new MockSnapshot(),
      clock,
    })

    await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-1",
      maxOutputTokens: 2048,
    })

    expect(recordedRequests).toHaveLength(2)
    expect(recordedRequests[0].maxOutputTokens).toBe(2048)
    expect(recordedRequests[1].maxOutputTokens).toBe(2048)
  })

  test("halts immediately when event append returns stale or fails", async () => {
    const clock = { nowMs: () => 1000 }
    const store = new InMemoryRunStore({ clock })

    const capturingGateway: ModelGatewayPort = {
      async executeAttempt() {
        return {
          attemptId: "att-1",
          finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "contracts/Vault.sol" } }],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
          latencyMs: 50,
        }
      },
    }

    const runner = new MultiTurnRunner({
      store,
      gateway: capturingGateway,
      registry: new MockRegistry(),
      snapshot: new MockSnapshot(),
      clock,
    })

    // Invalidate next appendEvent via fault injection
    store.failNext("appendEvent", new Error("Database disk full"))

    const result = await runner.execute({
      runId: "run-stale-test",
      prompt: "Audit Vault.sol",
      snapshotId: "snap-1",
    })

    expect(result.state).toBe("failed")
    expect(result.terminalReason).toBe("persistence_failure")
  })

  test("tool.completed.itemId matches exactly the persisted tool_result context item id", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-1",
        finishReason: "tool_calls",
        toolCalls: [{ id: "call-xyz", name: "read_file", arguments: { path: "contracts/Vault.sol" } }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
        latencyMs: 50,
      },
      {
        attemptId: "att-2",
        finishReason: "stop",
        content: "Done",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
        latencyMs: 50,
      },
    ])

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry: new MockRegistry(),
      snapshot: new MockSnapshot(),
      clock,
    })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-1",
    })

    expect(result.state).toBe("completed")
    const events = await store.loadEvents({ runId: result.runId })
    const toolCompleted = events.find((e) => e.type === "tool.completed")
    expect(toolCompleted).toBeDefined()
    const completedItemId = (toolCompleted?.payload as { itemId: string }).itemId

    // Find the corresponding tool_result item in context.item_added events
    const itemAddedEvents = events.filter((e) => e.type === "context.item_added")
    const resItemEvent = itemAddedEvents.find(
      (e) => (e.payload as { item: { type: string; id: string } }).item.type === "tool_result",
    )
    expect(resItemEvent).toBeDefined()
    const persistedResItemId = (resItemEvent?.payload as { item: { id: string } }).item.id

    // Must match 100%
    expect(completedItemId).toBe(persistedResItemId)
  })

  test("persists initial and tool context items, allowing complete history hydration via hydrateHistory", async () => {
    const { hydrateHistory } = require("../../src/runner/history-hydrator")
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-1",
        finishReason: "tool_calls",
        toolCalls: [{ id: "call-1", name: "read_file", arguments: { path: "contracts/Vault.sol" } }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
        latencyMs: 50,
      },
      {
        attemptId: "att-2",
        finishReason: "stop",
        content: "Audit complete",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
        latencyMs: 50,
      },
    ])

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry: new MockRegistry(),
      snapshot: new MockSnapshot(),
      clock,
    })

    const result = await runner.execute({
      prompt: "Find reentrancy in Vault.sol",
      snapshotId: "snap-1",
    })

    expect(result.state).toBe("completed")
    const events = await store.loadEvents({ runId: result.runId })

    const hydration = hydrateHistory(events)
    expect(hydration.kind).toBe("hydrated")
    if (hydration.kind === "hydrated") {
      // Must contain initial system_prompt, candidate_finding, and tool_request, tool_result
      const types = hydration.history.items.map((i: { type: string }) => i.type)
      expect(types).toContain("system_prompt")
      expect(types).toContain("candidate_finding")
      expect(types).toContain("tool_request")
      expect(types).toContain("tool_result")
      expect(hydration.history.items.length).toBeGreaterThanOrEqual(4)
    }
  })

  test("transitions run to failed in store when error occurs after running (never stuck in running)", async () => {
    const store = new InMemoryRunStore({ clock })
    const failingGateway: ModelGatewayPort = {
      async executeAttempt() {
        return {
          attemptId: "att-fail",
          finishReason: "error",
          error: { category: "transport", isRetryable: false, message: "Network connection severed" },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
          latencyMs: 50,
        }
      },
    }

    const runner = new MultiTurnRunner({
      store,
      gateway: failingGateway,
      registry: new MockRegistry(),
      snapshot: new MockSnapshot(),
      clock,
    })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-1",
    })

    expect(result.state).toBe("failed")
    expect(result.terminalReason).toBe("provider_transient_primary")

    // Verify stored record in store is transitioned to "failed", not stuck in "running"
    const storedRun = await store.loadRun(result.runId)
    expect(storedRun?.state).toBe("failed")
    expect(storedRun?.terminalReason).toBe("provider_transient_primary")
    expect(storedRun?.errorMessage).toContain("Network connection severed")
  })

  test("each turn request contains exactly 1 system_prompt and exactly 1 candidate_finding (N1 fixed)", async () => {
    const store = new InMemoryRunStore({ clock })
    const capturedRequests: ModelAttemptRequest[] = []

    const gateway: ModelGatewayPort = {
      async executeAttempt(req) {
        capturedRequests.push(req)
        if (capturedRequests.length === 1) {
          return {
            attemptId: "att-1",
            finishReason: "tool_calls",
            toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "contracts/Vault.sol" } }],
            usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25, costUsd: 0 },
            latencyMs: 50,
          }
        }
        return {
          attemptId: "att-2",
          finishReason: "stop",
          content: "Done",
          usage: { promptTokens: 30, completionTokens: 10, totalTokens: 40, costUsd: 0 },
          latencyMs: 50,
        }
      },
    }

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry: new MockRegistry(),
      snapshot: new MockSnapshot(),
      clock,
    })

    await runner.execute({
      prompt: "Find reentrancy in Vault.sol",
      snapshotId: "snap-1",
    })

    expect(capturedRequests).toHaveLength(2)

    // Verify step 1 request items
    const step1Types = capturedRequests[0].items.map((i) => i.type)
    expect(step1Types.filter((t) => t === "system_prompt")).toHaveLength(1)
    expect(step1Types.filter((t) => t === "candidate_finding")).toHaveLength(1)

    // Verify step 2 request items: MUST STILL HAVE EXACTLY 1 system_prompt and 1 candidate_finding!
    const step2Types = capturedRequests[1].items.map((i) => i.type)
    expect(step2Types.filter((t) => t === "system_prompt")).toHaveLength(1)
    expect(step2Types.filter((t) => t === "candidate_finding")).toHaveLength(1)
    expect(step2Types.filter((t) => t === "tool_request")).toHaveLength(1)
    expect(step2Types.filter((t) => t === "tool_result")).toHaveLength(1)
  })

  test("resumes run with pending interrupted tool calls using interruptedToolItems (N2 implemented)", async () => {
    let currentTime = 1000
    const testClock = { nowMs: () => currentTime }
    const store = new InMemoryRunStore({ clock: testClock, leaseMs: 10 })
    const runId = "run-interrupted-resume"
    store.seedRun(runId, "queued", "Audit prompt", "snap-1")

    const claimRes = await store.claim({ runId, workerId: "worker-dead" })
    if (claimRes.kind !== "claimed") throw new Error("setup claim failed")

    // Event 1: run.started
    const { buildRunConfigSnapshot } = require("../../src/runner/run-config")
    const { DefaultRetryConfig, ResolvedFlagNames, ContextFlagNames } = require("@harness/protocol")
    const { sha256Hex } = require("../../src/util/digest")
    const flags = Object.fromEntries(ResolvedFlagNames.map((n: string) => [n, true]))
    const cFlags = Object.fromEntries(ContextFlagNames.map((n: string) => [n, true]))
    const built = buildRunConfigSnapshot({
      flags,
      policy: {
        policyVersion: "v1",
        windowLimitTokens: 128_000,
        outputReserveTokens: 2048,
        compactionThreshold: 0.8,
        safetyMarginFactor: 1.2,
        recentWindowTokens: 20_000,
        toolOutputMaxTokens: 4_000,
        toolOutputMaxLines: 100,
        maxCompactions: 0,
        flags: cFlags,
      },
      retry: DefaultRetryConfig,
      limits: {
        wallClockTimeoutMs: 60000,
        costCeilingUsd: 5,
        totalTokenBudget: 100000,
        maxSteps: 10,
        noProgressMaxRepeats: 3,
      },
      systemPromptDigest: `sha256:${sha256Hex("sys")}`,
      verdictSchemaDigest: `sha256:${sha256Hex("verdict")}`,
    })

    const { digestOf } = require("../../src/util/digest")
    const payload1 = { snapshot: built.snapshot, snapshotDigest: built.digest }
    await store.appendEvent({
      claim: claimRes.claim,
      expectedStateVersion: claimRes.stateVersion,
      event: {
        eventId: "e1",
        type: "run.started",
        schemaVersion: 1,
        payload: payload1,
        payloadDigest: digestOf(payload1),
        occurredAt: "1970-01-01T00:00:01.000Z",
      },
    })

    // Event 2: step.started
    const payload2 = { stepIndex: 1, toolsDisabled: false }
    await store.appendEvent({
      claim: claimRes.claim,
      expectedStateVersion: claimRes.stateVersion,
      event: {
        eventId: "e2",
        type: "step.started",
        schemaVersion: 1,
        payload: payload2,
        payloadDigest: digestOf(payload2),
        occurredAt: "1970-01-01T00:00:01.001Z",
      },
    })

    // Event 3: tool.requested (worker died before tool completed)
    const payload3 = { callIndex: 0, callId: "interrupted-call-1", toolName: "read_file", arguments: { path: "contracts/Vault.sol" } }
    await store.appendEvent({
      claim: claimRes.claim,
      expectedStateVersion: claimRes.stateVersion,
      event: {
        eventId: "e3",
        type: "tool.requested",
        schemaVersion: 1,
        payload: payload3,
        payloadDigest: digestOf(payload3),
        occurredAt: "1970-01-01T00:00:01.002Z",
      },
    })

    // Advance state to running and advance clock to expire claim lease
    await store.transition({
      claim: claimRes.claim,
      expectedState: "queued",
      expectedStateVersion: claimRes.stateVersion,
      nextState: "running",
    })
    currentTime += 11 // expire the short test lease

    const capturedRequests: ModelAttemptRequest[] = []
    const resumingGateway: ModelGatewayPort = {
      async executeAttempt(req) {
        capturedRequests.push(req)
        return {
          attemptId: "att-resume",
          finishReason: "stop",
          content: "Analyzed after resume",
          usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50, costUsd: 0 },
          latencyMs: 50,
        }
      },
    }

    const runner = new MultiTurnRunner({
      store,
      gateway: resumingGateway,
      registry: new MockRegistry(),
      snapshot: new MockSnapshot(),
      clock: testClock,
    })

    // New worker resumes execution of the interrupted run
    const result = await runner.execute({
      runId,
      workerId: "worker-resumer",
      prompt: "Audit prompt",
      snapshotId: "snap-1",
    })

    expect(result.state).toBe("completed")
    expect(capturedRequests).toHaveLength(1)

    // The resumed request must contain an error tool_result indicating interruption
    const resumedItems = capturedRequests[0].items
    const interruptedResultItem = resumedItems.find(
      (i) => i.type === "tool_result" && i.toolMeta?.callId === "interrupted-call-1",
    )
    expect(interruptedResultItem).toBeDefined()
    expect(interruptedResultItem?.content).toContain("Tool execution interrupted")
    expect(interruptedResultItem?.toolMeta?.isError).toBe(true)
  })

  test("propagates maxSourceEntries to all turn requests and records in runConfigSnapshot (N3 fixed)", async () => {
    const store = new InMemoryRunStore({ clock })
    const capturedRequests: ModelAttemptRequest[] = []

    const gateway: ModelGatewayPort = {
      async executeAttempt(req) {
        capturedRequests.push(req)
        if (capturedRequests.length === 1) {
          return {
            attemptId: "att-1",
            finishReason: "tool_calls",
            toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "contracts/Vault.sol" } }],
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
            latencyMs: 50,
          }
        }
        return {
          attemptId: "att-2",
          finishReason: "stop",
          content: "Done",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
          latencyMs: 50,
        }
      },
    }

    const manyFilesSnapshot: SourceSnapshotPort = {
      async listFiles() {
        return Array.from({ length: 50 }, (_, i) => `contracts/Contract_${i}.sol`)
      },
      async readLines() {
        return { kind: "ok", lines: [] }
      },
    }

    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry: new MockRegistry(),
      snapshot: manyFilesSnapshot,
      clock,
    })

    const result = await runner.execute({
      prompt: "Audit files",
      snapshotId: "snap-many",
      maxSourceEntries: 10, // Bound at 10 files
    })

    expect(result.state).toBe("completed")
    expect(capturedRequests).toHaveLength(2)

    // Both step 1 and step 2 must have the same 10-file bound applied
    const step1Sys = capturedRequests[0].items.find((i) => i.type === "system_prompt")
    const step2Sys = capturedRequests[1].items.find((i) => i.type === "system_prompt")
    expect(step1Sys?.content).toContain("...40 lines truncated...")
    expect(step2Sys?.content).toContain("...40 lines truncated...")

    // Check that run.started recorded the bound
    const events = await store.loadEvents({ runId: result.runId })
    const started = events.find((e) => e.type === "run.started")
    expect(started).toBeDefined()
    const snapshotPayload = started?.payload as { snapshot: { contextPolicy: { toolOutputMaxLines: number } } }
    expect(snapshotPayload.snapshot.contextPolicy.toolOutputMaxLines).toBe(10)
  })

  test("Text next to a tool call is replayed", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-text-tool",
        finishReason: "tool_calls",
        content: "I will read the vault",
        toolCalls: [{ id: "call-text", name: "read_file", arguments: { path: "contracts/Vault.sol" } }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.001 },
        latencyMs: 20,
      },
      {
        attemptId: "att-text-answer",
        finishReason: "stop",
        content: "The vault is safe.",
        usage: { promptTokens: 20, completionTokens: 6, totalTokens: 26, costUsd: 0.001 },
        latencyMs: 20,
      },
    ])
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), clock })

    const result = await runner.execute({ prompt: "Audit Vault.sol", snapshotId: "snap-text" })
    const nextItems = gateway.calls[1].items
    const reasoningIndex = nextItems.findIndex((item) => item.type === "assistant_reasoning")
    const requestIndex = nextItems.findIndex((item) => item.type === "tool_request")

    expect(result.state).toBe("completed")
    expect(nextItems[reasoningIndex]?.content).toBe("I will read the vault")
    expect(reasoningIndex).toBeGreaterThanOrEqual(0)
    expect(reasoningIndex).toBeLessThan(requestIndex)
    expect(nextItems[reasoningIndex]?.turn).toBe(nextItems[requestIndex]?.turn)
  })

  test("Model gets a chance to repair its call", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-invalid-arguments",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call-invalid",
            name: "read_file",
            arguments: {},
            argumentsError: "Unexpected end of JSON input",
            rawArguments: '{"path":',
          },
        ],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.001 },
        latencyMs: 20,
      },
      {
        attemptId: "att-repaired-answer",
        finishReason: "stop",
        content: "I repaired the request.",
        usage: { promptTokens: 20, completionTokens: 6, totalTokens: 26, costUsd: 0.001 },
        latencyMs: 20,
      },
    ])
    const registry = new MockRegistry()
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), clock })

    const result = await runner.execute({ prompt: "Audit Vault.sol", snapshotId: "snap-invalid" })
    const events = await store.loadEvents({ runId: result.runId })
    const failed = events.find((event) => event.type === "tool.failed")
    const failedPayload = failed?.payload as { failureKind?: string }
    const invalidItems = events
      .filter((event) => event.type === "context.item_added")
      .map((event) => event.payload as { item: { type: string; content: string; toolMeta?: { callId?: string } } })
    const requestItem = invalidItems.find((entry) => entry.item.type === "tool_request")
    const resultItem = invalidItems.find((entry) => entry.item.type === "tool_result")
    const repairResult = gateway.calls[1].items.find(
      (item) => item.type === "tool_result" && item.toolMeta?.callId === "call-invalid",
    )

    expect(result.state).toBe("completed")
    expect(registry.calls).toHaveLength(0)
    expect(failedPayload.failureKind).toBe("invalid_arguments")
    expect(requestItem?.item.content).toBe('{"path":')
    expect(resultItem?.item.content).toContain("Tool arguments were not valid JSON: Unexpected end of JSON input")
    expect(repairResult?.content).toBe(resultItem?.item.content)
    const requestEvent = events.find((event) =>
      event.type === "context.item_added" &&
      (event.payload as { item?: { type?: string; toolMeta?: { callId?: string } } }).item?.type === "tool_request",
    )
    const resultEvent = events.find((event) =>
      event.type === "context.item_added" &&
      (event.payload as { item?: { type?: string; toolMeta?: { callId?: string } } }).item?.type === "tool_result",
    )
    expect(requestEvent?.sequence ?? 0).toBeLessThan(resultEvent?.sequence ?? 0)
    expect(resultEvent?.sequence ?? 0).toBeLessThan(failed?.sequence ?? 0)
  })



  test("valid calls around malformed calls retain response order", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-mixed-calls",
        finishReason: "tool_calls",
        toolCalls: [
          { id: "call-before", name: "read_file", arguments: { path: "before.sol" } },
          { id: "call-broken", name: "read_file", arguments: {}, argumentsError: "invalid JSON", rawArguments: "{" },
          { id: "call-after", name: "read_file", arguments: { path: "after.sol" } },
        ],
        usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18, costUsd: 0.001 },
        latencyMs: 20,
      },
      {
        attemptId: "att-mixed-answer",
        finishReason: "stop",
        content: "Done.",
        usage: { promptTokens: 20, completionTokens: 4, totalTokens: 24, costUsd: 0.001 },
        latencyMs: 20,
      },
    ])
    const registry = new MockRegistry()
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), clock })

    const result = await runner.execute({ prompt: "Audit Vault.sol", snapshotId: "snap-mixed" })
    const requestItems = (await store.loadEvents({ runId: result.runId }))
      .filter((event) => event.type === "context.item_added")
      .map((event) => event.payload as { item: { type: string; toolMeta?: { callId?: string } } })
      .filter((entry) => entry.item.type === "tool_request")
      .map((entry) => entry.item.toolMeta?.callId)

    expect(result.state).toBe("completed")
    expect(registry.calls.map((call) => call.arguments.path)).toEqual(["before.sol", "after.sol"])
    expect(requestItems).toEqual(["call-before", "call-broken", "call-after"])
  })

  test("Invalid calls are bounded", async () => {
    const invalidCall = (id: string) => ({
      attemptId: `att-${id}`,
      finishReason: "tool_calls" as const,
      toolCalls: [{ id, name: "read_file", arguments: {}, argumentsError: "invalid JSON", rawArguments: "{" }],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.001 },
      latencyMs: 20,
    })
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([invalidCall("bad-1"), invalidCall("bad-2"), invalidCall("bad-3")])
    const registry = new MockRegistry()
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), clock })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-invalid-limit",
      limits: { maxSteps: 5, maxToolCalls: 2 },
    })

    expect(result.state).toBe("budget_exhausted")
    expect(result.terminalReason).toBe("max_tool_calls")
    expect(result.toolCallsExecuted).toBe(2)
    expect(gateway.calls).toHaveLength(2)
    expect(registry.calls).toHaveLength(0)
  })

  test("Truncated final answer is marked", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-length",
        finishReason: "length",
        content: "The answer stopped at the output limit.",
        toolCalls: [{ id: "ignored-call", name: "read_file", arguments: { path: "Vault.sol" } }],
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0.001 },
        latencyMs: 20,
      },
    ])
    const registry = new MockRegistry()
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), clock })

    const result = await runner.execute({ prompt: "Audit Vault.sol", snapshotId: "snap-length" })
    const completed = (await store.loadEvents({ runId: result.runId })).find((event) => event.type === "run.completed")

    expect(result.state).toBe("completed")
    expect(result.outputTruncated).toBe(true)
    expect(registry.calls).toHaveLength(0)
    expect((completed?.payload as { outputTruncated?: boolean }).outputTruncated).toBe(true)
  })

  test("Unpriced run records the disabled cost check", async () => {
    const unpricedUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0, pricing: "unpriced" as const }
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-unpriced-tool",
        finishReason: "tool_calls",
        toolCalls: [{ id: "call-unpriced", name: "read_file", arguments: { path: "Vault.sol" } }],
        usage: unpricedUsage,
        latencyMs: 20,
      },
      {
        attemptId: "att-unpriced-answer",
        finishReason: "stop",
        content: "Done without a priced profile.",
        usage: unpricedUsage,
        latencyMs: 20,
      },
    ])
    let costEstimates = 0
    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry: new MockRegistry(),
      snapshot: new MockSnapshot(),
      clock,
      estimateCostUsd: () => {
        costEstimates += 1
        return 1
      },
      estimatePromptTokens: () => 10,
    })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-unpriced",
      pricing: "unpriced",
      limits: { maxSteps: 3, maxToolCalls: 3, costCeilingUsd: 0.01 },
    })
    const started = (await store.loadEvents({ runId: result.runId })).find((event) => event.type === "run.started")

    expect((started?.payload as { costBudgetEnforced?: boolean }).costBudgetEnforced).toBe(false)
    expect(result.state).toBe("completed")
    expect(gateway.calls).toHaveLength(2)
    expect(costEstimates).toBe(0)
    expect(result.usage.pricing).toBe("unpriced")
  })

  test("Priced runs still stop at the cost ceiling", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-priced-cost",
        finishReason: "tool_calls",
        toolCalls: [{ id: "call-priced", name: "read_file", arguments: { path: "Vault.sol" } }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.02, pricing: "priced" },
        latencyMs: 20,
      },
    ])
    const registry = new MockRegistry()
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), clock })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-priced",
      pricing: "priced",
      limits: { maxSteps: 3, maxToolCalls: 3, costCeilingUsd: 0.01 },
    })

    expect(result.state).toBe("budget_exhausted")
    expect(result.terminalReason).toBe("cost_budget")
    expect(registry.calls).toHaveLength(0)
  })

  test("Effective settings are recorded per run", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-profile",
        finishReason: "stop",
        content: "The run completed.",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.001 },
        latencyMs: 20,
      },
    ])
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), clock })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-profile",
      providerProfile: {
        outputTokensField: "max_completion_tokens",
        inputCostPerMTok: 2,
        outputCostPerMTok: 8,
      },
      limits: { maxSteps: 5 },
    })
    const started = (await store.loadEvents({ runId: result.runId })).find((event) => event.type === "run.started")
    const payload = started?.payload as {
      snapshot: { budget: { maxSteps: number } }
      providerProfile: { outputTokensField: string; inputCostPerMTok: number; outputCostPerMTok: number }
    }

    expect(payload.snapshot.budget.maxSteps).toBe(5)
    expect(payload.providerProfile).toEqual({
      outputTokensField: "max_completion_tokens",
      inputCostPerMTok: 2,
      outputCostPerMTok: 8,
    })
  })

  test("summary includes two attempt steps and one call linked by step and call ID", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      {
        attemptId: "att-summary-1",
        finishReason: "tool_calls",
        toolCalls: [{ id: "summary-call", name: "read_file", arguments: { path: "Vault.sol" } }],
        usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18, costUsd: 0.002 },
        latencyMs: 21,
      },
      {
        attemptId: "att-summary-2",
        finishReason: "stop",
        content: "Audit finished.",
        usage: { promptTokens: 13, completionTokens: 5, totalTokens: 18, costUsd: 0.003 },
        latencyMs: 22,
      },
    ])
    const registry = new MockRegistry() as MockRegistry & { limits: () => ToolLimits }
    registry.limits = () => ({
      readFile: { maxLines: 100, maxBytes: 20_000 },
      grep: { timeoutMs: 2_000, maxScanBytes: 100_000, maxLineChars: 2_000, maxMatches: 100 },
      glob: { maxMatches: 100 },
      listDir: { maxEntries: 100 },
    })
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), clock })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-summary",
      profileId: "summary-model",
      limits: { maxSteps: 5, maxToolCalls: 5 },
    })
    const summary = await getMultiTurnExecutionSummary(result.runId, store)

    expect(summary?.steps).toEqual([
      {
        stepIndex: 1,
        attemptNumber: 1,
        model: "summary-model",
        finishReason: "tool_calls",
        promptTokens: 11,
        completionTokens: 7,
        totalTokens: 18,
        costUsd: 0.002,
        pricing: "priced",
        latencyMs: 0,
      },
      {
        stepIndex: 2,
        attemptNumber: 1,
        model: "summary-model",
        finishReason: "stop",
        promptTokens: 13,
        completionTokens: 5,
        totalTokens: 18,
        costUsd: 0.003,
        pricing: "priced",
        latencyMs: 0,
      },
    ])
    expect(summary?.toolCalls).toHaveLength(1)
    expect(summary?.toolCalls[0]).toMatchObject({ stepIndex: 1, callId: "summary-call", status: "completed" })
    expect(summary?.limits?.maxSteps).toBe(5)
    expect(summary?.toolLimits?.readFile.maxLines).toBe(100)
  })

})
