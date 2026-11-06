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
import { PassThroughContextEngine, ProductionContextEngine, createO200kTokenizer } from "../../src/context"
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

  test("reserves the final configured step for synthesis after a tool call", async () => {
    const gateway = new ScriptedGateway([
      { attemptId: "inspect", finishReason: "tool_calls", content: "Read it", toolCalls: [{ id: "read", name: "read_file", arguments: { path: "contracts/Vault.sol" } }], usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7, costUsd: 0 }, latencyMs: 1 },
      { attemptId: "synthesis", finishReason: "stop", content: "Evidence summary", usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10, costUsd: 0 }, latencyMs: 1 },
    ])
    const registry = new MockRegistry()
    const result = await new MultiTurnRunner({ store: new InMemoryRunStore({ clock }), gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })
      .execute({ prompt: "Audit", snapshotId: "snap", limits: { maxSteps: 2 } })
    expect(result).toMatchObject({ state: "completed", output: "Evidence summary", stepsExecuted: 2, observedLimits: ["max_steps"] })
    expect(gateway.calls).toHaveLength(2)
    expect(gateway.calls[0].toolsDisabled).toBe(false)
    expect(gateway.calls[1].toolsDisabled).toBe(true)
    expect(gateway.calls[1].tools).toBeUndefined()
    expect(registry.calls).toHaveLength(1)
  })

  test("does not dispatch tool calls returned by a provider on the final step", async () => {
    const gateway = new ScriptedGateway([
      { attemptId: "final", finishReason: "tool_calls", content: "Need one more read", toolCalls: [{ id: "late", name: "read_file", arguments: { path: "contracts/Vault.sol" } }], usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7, costUsd: 0 }, latencyMs: 1 },
    ])
    const registry = new MockRegistry()
    const result = await new MultiTurnRunner({ store: new InMemoryRunStore({ clock }), gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })
      .execute({ prompt: "Audit", snapshotId: "snap", limits: { maxSteps: 1 } })
    expect(result).toMatchObject({ state: "budget_exhausted", terminalReason: "max_steps", stepsExecuted: 1 })
    expect(registry.calls).toHaveLength(0)
  })

  test("no-progress stops before dispatching the threshold identical tool call", async () => {
    const call = (id: string): ModelAttemptResponse => ({
      attemptId: id,
      finishReason: "tool_calls",
      content: "Read it",
      toolCalls: [{ id, name: "read_file", arguments: { path: "contracts/Vault.sol" } }],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7, costUsd: 0 },
      latencyMs: 1,
    })
    const gateway = new ScriptedGateway([call("one"), call("two"), call("three")])
    const registry = new MockRegistry()
    const store = new InMemoryRunStore({ clock })
    const result = await new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })
      .execute({ prompt: "Audit", snapshotId: "snap", limits: { maxSteps: 5, noProgressMaxRepeats: 3 } })
    if (result.state === "failed") throw new Error(JSON.stringify(await store.loadEvents({ runId: result.runId })))
    expect(result).toMatchObject({ state: "budget_exhausted", terminalReason: "no_progress", observedLimits: ["no_progress"] })
    expect(registry.calls).toHaveLength(2)
    expect(gateway.calls).toHaveLength(3)
  })

  test("no-progress resets when the tool call arguments change", async () => {
    const responses: ModelAttemptResponse[] = ["Vault", "Other", "Other"].map((file, index) => ({
      attemptId: `call-${index}`,
      finishReason: "tool_calls",
      content: "Read it",
      toolCalls: [{ id: `call-${index}`, name: "read_file", arguments: { path: `contracts/${file}.sol` } }],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7, costUsd: 0 },
      latencyMs: 1,
    }))
    const gateway = new ScriptedGateway(responses)
    const registry = new MockRegistry()
    const result = await new MultiTurnRunner({ store: new InMemoryRunStore({ clock }), gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })
      .execute({ prompt: "Audit", snapshotId: "snap", limits: { maxSteps: 4, noProgressMaxRepeats: 3 } })
    expect(result.state).toBe("completed")
    expect(registry.calls).toHaveLength(3)
  })

  test("no-progress catches a threshold repetition inside one provider response", async () => {
    const repeated = ["a", "b", "c"].map((id) => ({ id, name: "read_file", arguments: { path: "contracts/Vault.sol" } }))
    const gateway = new ScriptedGateway([{ attemptId: "batch", finishReason: "tool_calls", content: "Read", toolCalls: repeated, usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7, costUsd: 0 }, latencyMs: 1 }])
    const registry = new MockRegistry()
    const result = await new MultiTurnRunner({ store: new InMemoryRunStore({ clock }), gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })
      .execute({ prompt: "Audit", snapshotId: "snap", limits: { maxSteps: 4, maxToolCalls: 2, noProgressMaxRepeats: 3 } })
    expect(result).toMatchObject({ state: "budget_exhausted", terminalReason: "no_progress" })
    expect(registry.calls).toHaveLength(2)
  })

  test("cancelling an in-flight provider request persists user cancellation", async () => {
    const store = new InMemoryRunStore({ clock })
    const registry = new MockRegistry()
    const controller = new AbortController()
    const gateway: ModelGatewayPort = {
      async executeAttempt(request, signal) {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }))
        return {
          attemptId: "cancelled",
          finishReason: "error",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
          latencyMs: 1,
          error: { category: "transport", message: "Request was aborted", isRetryable: true },
        }
      },
    }
    const running = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })
      .execute({ prompt: "Audit", snapshotId: "snap", signal: controller.signal })
    setTimeout(() => controller.abort(), 0)
    const result = await running
    const events = await store.loadEvents({ runId: result.runId })
    expect(result).toMatchObject({ state: "cancelled", terminalReason: "cancelled_by_user" })
    expect(events.some((event) => event.type === "run.cancelled" && event.payload.boundary === "before_provider_call")).toBe(true)
    expect(registry.calls).toHaveLength(0)
  })

  test("wall-clock timeout during provider call remains a budget stop", async () => {
    const gateway: ModelGatewayPort = {
      async executeAttempt(_request, signal) {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }))
        return { attemptId: "timeout", finishReason: "error", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }, latencyMs: 1, error: { category: "transport", message: "timeout", isRetryable: true } }
      },
    }
    const result = await new MultiTurnRunner({ store: new InMemoryRunStore({ clock }), gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })
      .execute({ prompt: "Audit", snapshotId: "snap", limits: { wallClockTimeoutMs: 50 } })
    expect(result).toMatchObject({ state: "budget_exhausted", terminalReason: "wall_clock", observedLimits: ["wall_clock"] })
  })

  test("cancellation during tool approval prevents dispatch", async () => {
    const store = new InMemoryRunStore({ clock })
    const registry = new MockRegistry()
    const controller = new AbortController()
    let approveStarted!: () => void
    const approvalStarted = new Promise<void>((resolve) => { approveStarted = resolve })
    let finishApproval!: () => void
    const approvalPending = new Promise<"allow">((resolve) => { finishApproval = () => resolve("allow") })
    const gateway = new ScriptedGateway([{ attemptId: "tool", finishReason: "tool_calls", content: "Read", toolCalls: [{ id: "read", name: "read_file", arguments: { path: "contracts/Vault.sol" } }], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 }, latencyMs: 1 }])
    const running = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock, approval: { async decide() { approveStarted(); return approvalPending } } })
      .execute({ prompt: "Audit", snapshotId: "snap", signal: controller.signal })
    await approvalStarted
    controller.abort()
    finishApproval()
    const result = await running
    expect(result).toMatchObject({ state: "cancelled", terminalReason: "cancelled_by_user" })
    expect(registry.calls).toHaveLength(0)
  })

  test("cancellation while approval is pending terminates without waiting for approval", async () => {
    const controller = new AbortController()
    const gateway = new ScriptedGateway([{ attemptId: "tool", finishReason: "tool_calls", content: "Read", toolCalls: [{ id: "read", name: "read_file", arguments: { path: "contracts/Vault.sol" } }], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 }, latencyMs: 1 }])
    let approvalStarted!: () => void
    const approvalEntered = new Promise<void>((resolve) => { approvalStarted = resolve })
    const store = new InMemoryRunStore({ clock })
    const registry = new MockRegistry()
    const running = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock, approval: { async decide() { approvalStarted(); return new Promise<"allow">(() => {}) } } })
      .execute({ prompt: "Audit", snapshotId: "snap", signal: controller.signal })
    await approvalEntered
    controller.abort()
    const result = await running
    expect(result).toMatchObject({ state: "cancelled", terminalReason: "cancelled_by_user" })
    expect(registry.calls).toHaveLength(0)
  })

  test("prepares and sends the same full tool-enabled provider request", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([{ attemptId: "a", finishReason: "stop", content: "ok", usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, costUsd: 0 }, latencyMs: 1 }])
    const contextEngine = new ProductionContextEngine(createO200kTokenizer())
    let preparedEnvelope: ModelAttemptRequest | undefined
    const originalPrepare = contextEngine.prepare.bind(contextEngine)
    contextEngine.prepare = async (input) => {
      preparedEnvelope = input.request
      return originalPrepare(input)
    }
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), clock, contextEngine })
    const result = await runner.execute({ prompt: "Audit", snapshotId: "snap", maxOutputTokens: 16,
      providerProfile: { outputTokensField: "max_tokens", maxContextTokens: 16_384, maxOutputTokens: 16 } })
    if (result.state !== "completed") throw new Error(JSON.stringify(result))
    expect(result.state).toBe("completed")
    const sent = gateway.calls[0]
    expect(sent.tools).toHaveLength(1)
    expect(sent.maxOutputTokens).toBe(16)
    expect(preparedEnvelope).toBeDefined()
    if (preparedEnvelope !== undefined) expect(gateway.calls[0]).toEqual(preparedEnvelope)
    const events = await store.loadEvents({ runId: result.runId })
    const allocation = events.find((event) => event.type === "context.allocated")
    expect(allocation).toBeDefined()
    if (allocation?.type === "context.allocated") {
      const telemetry = allocation.payload.telemetry as { requestDigest?: string; estimatedOutputTokens?: number }
      expect(telemetry.requestDigest).toMatch(/^sha256:/)
      expect(telemetry.estimatedOutputTokens).toBe(16)
    }
  })

  test("production request digest changes when tool schema or output settings change", async () => {
    const engine = new ProductionContextEngine(createO200kTokenizer())
    const items = [{ id: "sys", turn: 1, type: "system_prompt" as const, isPinned: true, content: "x" }]
    const common = {
      items,
      policy: { policyVersion: "v1", windowLimitTokens: 16384, outputReserveTokens: 8, compactionThreshold: 0.8,
        safetyMarginFactor: 1.2, recentWindowTokens: 10, toolOutputMaxTokens: 10, toolOutputMaxLines: 10, maxCompactions: 0,
        flags: { enableToolTruncation: true, enableObsMasking: false, enableSupersedeReads: false, enableDropEmpty: false, enableLlmCompaction: false, enableSessionNote: false } },
      modelLimits: { maxContextTokens: 32768, maxOutputTokens: 100, safetyMarginFactor: 1.2 },
      budget: { totalTokensUsed: 0, totalTokenLimit: 10000, compactionsCount: 0, costUsd: 0 },
    }
    const base = { runId: "r", stepIndex: 1, attemptIndex: 1, profileId: "m", items }
    const first = await engine.prepare({ ...common, request: { ...base, maxOutputTokens: 8 } })
    const changed = await engine.prepare({ ...common, request: { ...base, maxOutputTokens: 9, tools: new MockRegistry().definitions() } })
    expect(first.telemetry.requestDigest).not.toBe(changed.telemetry.requestDigest)
    expect(first.telemetry.estimatedInputTokens).not.toBe(changed.telemetry.estimatedInputTokens)
  })

  test("production usage record preserves unavailable provider usage", async () => {
    const engine = new ProductionContextEngine(createO200kTokenizer())
    const result = await engine.record({
      actualUsage: null,
      modelLimits: { maxContextTokens: 32768, maxOutputTokens: 100, safetyMarginFactor: 1.2 },
      budget: { totalTokensUsed: 27, totalTokenLimit: 1000, compactionsCount: 0, costUsd: 0 },
    })
    expect(result.totalTokensUsed).toBe(27)
    expect(result.tokenDelta).toBe(0)
  })

  test("rejects an explicit output cap larger than the shared reserve", async () => {
    const engine = new ProductionContextEngine(createO200kTokenizer())
    const items = [{ id: "sys", turn: 1, type: "system_prompt" as const, isPinned: true, content: "x" }]
    const result = await engine.prepare({
      items,
      request: { runId: "r", stepIndex: 1, attemptIndex: 1, profileId: "m", items, maxOutputTokens: 16 },
      policy: { policyVersion: "v1", windowLimitTokens: 16_384, outputReserveTokens: 4096, compactionThreshold: 0.8,
        safetyMarginFactor: 1.2, recentWindowTokens: 10, toolOutputMaxTokens: 10, toolOutputMaxLines: 10, maxCompactions: 0,
        flags: { enableToolTruncation: true, enableObsMasking: false, enableSupersedeReads: false, enableDropEmpty: false, enableLlmCompaction: false, enableSessionNote: false } },
      modelLimits: { maxContextTokens: 32_768, maxOutputTokens: 16, safetyMarginFactor: 1.2 },
      budget: { totalTokensUsed: 0, totalTokenLimit: 10_000, compactionsCount: 0, costUsd: 0 },
    })
    expect(result.status).toBe("ready")
  })

  test("rejects explicit output cap above model limit before gateway", async () => {
    const gateway = new ScriptedGateway([])
    const runner = new MultiTurnRunner({ store: new InMemoryRunStore({ clock }), gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: new ProductionContextEngine(createO200kTokenizer()), clock })
    const result = await runner.execute({ prompt: "Audit", snapshotId: "snap", maxOutputTokens: 100,
      providerProfile: { outputTokensField: "max_tokens", maxContextTokens: 32768, maxOutputTokens: 50 } })
    expect(result.state).toBe("failed")
    expect(result.terminalReason).toBe("invalid_input")
    expect(gateway.calls).toHaveLength(0)
  })

  test("sanitizes tool output before shaping and persists only the shaped result", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([
      { attemptId: "tool", finishReason: "tool_calls", toolCalls: [{ id: "call", name: "read_file", arguments: { path: "contracts/Vault.sol" } }], usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3, costUsd: 0 }, latencyMs: 1 },
      { attemptId: "answer", finishReason: "stop", content: "done", usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3, costUsd: 0 }, latencyMs: 1 },
    ])
    const calls: string[] = []
    const contextEngine = new PassThroughContextEngine()
    contextEngine.shapeToolResult = async (input) => {
      calls.push(input.content)
      return { content: "SHAPED:" + input.content, isTruncated: true, tokensBefore: 3, tokensAfter: 4 }
    }
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine, clock, secrets: ["contract"] })
    const result = await runner.execute({ prompt: "Audit", snapshotId: "snap" })
    expect(result.state).toBe("completed")
    expect(calls[0]).not.toContain("contract")
    const events = await store.loadEvents({ runId: result.runId })
    const resultEvent = events.find((event) => event.type === "context.item_added" && (event.payload as { item?: { type?: string } }).item?.type === "tool_result")
    expect(JSON.stringify(resultEvent)).toContain("SHAPED:")
  })

  test("records null provider usage for failed attempts", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([{ attemptId: "err", finishReason: "error", error: { category: "transport", isRetryable: false, message: "offline" }, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }, latencyMs: 1 }])
    let actualUsage: unknown = "unset"
    const engine = new PassThroughContextEngine()
    const record = engine.record.bind(engine)
    engine.record = async (input) => {
      actualUsage = input.actualUsage
      return record(input)
    }
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: engine, clock })
    await runner.execute({ prompt: "Audit", snapshotId: "snap" })
    expect(actualUsage).toBeNull()
  })

  test("missing gateway usage remains unavailable without throwing or fabricating zero", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway: ModelGatewayPort = {
      async executeAttempt() {
        return { attemptId: "missing-usage", finishReason: "stop", content: "answer", latencyMs: 1 } as ModelAttemptResponse
      },
    }
    const contextEngine = new PassThroughContextEngine()
    let recordedUsage: unknown = "unset"
    const record = contextEngine.record.bind(contextEngine)
    contextEngine.record = async (input) => {
      recordedUsage = input.actualUsage
      return record(input)
    }
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine, clock })
    const result = await runner.execute({ prompt: "Audit", snapshotId: "snap" })
    expect(result.state).toBe("completed")
    expect(recordedUsage).toBeNull()
    const attemptEvent = (await store.loadEvents({ runId: result.runId })).find((event) => event.type === "provider.attempted")
    if (attemptEvent?.type === "provider.attempted") expect(attemptEvent.payload.usage).toBeNull()
  })

  test("missing usage consumes conservative estimate before the next step", async () => {
    const seenBudgets: number[] = []
    const engine = new PassThroughContextEngine()
    const prepare = engine.prepare.bind(engine)
    engine.prepare = async (input) => { seenBudgets.push(input.budget.totalTokensUsed); return prepare(input) }
    const gateway: ModelGatewayPort = { async executeAttempt(request) {
      return { attemptId: `missing-${request.stepIndex}`, finishReason: request.stepIndex === 1 ? "tool_calls" : "stop",
        ...(request.stepIndex === 1 ? { toolCalls: [{ id: "c", name: "read_file", arguments: { path: "contracts/Vault.sol" } }] } : { content: "ok" }), latencyMs: 1 } as ModelAttemptResponse
    } }
    const result = await new MultiTurnRunner({ store: new InMemoryRunStore({ clock }), gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: engine, clock })
      .execute({ prompt: "Audit", snapshotId: "snap", limits: { totalTokenBudget: 100_000 } })
    expect(result.state).toBe("completed")
    expect(seenBudgets[1]).toBeGreaterThan(seenBudgets[0])
  })

  test("missing usage estimate can exhaust total token budget before a subsequent provider call", async () => {
    const engine = new PassThroughContextEngine()
    let prepareCount = 0
    let providerCalls = 0
    const originalPrepare = engine.prepare.bind(engine)
    engine.prepare = async (input) => {
      prepareCount += 1
      const prepared = await originalPrepare(input)
      prepared.telemetry.estimatedInputTokens = 300
      prepared.telemetry.outputReserveTokens = 10
      return prepared
    }
    const gateway: ModelGatewayPort = { async executeAttempt(request) {
      providerCalls += 1
      return { attemptId: `missing-${request.stepIndex}`, finishReason: "tool_calls",
        toolCalls: [{ id: `call-${request.stepIndex}`, name: "read_file", arguments: { path: "contracts/Vault.sol" } }], latencyMs: 1 } as unknown as ModelAttemptResponse
    } }
    const result = await new MultiTurnRunner({ store: new InMemoryRunStore({ clock }), gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: engine, clock })
      .execute({ prompt: "Audit", snapshotId: "snap", maxOutputTokens: 10, limits: { totalTokenBudget: 500 } })
    expect(result.state).toBe("budget_exhausted")
    expect(providerCalls).toBe(1)
    expect(prepareCount).toBeGreaterThanOrEqual(2)
  })


  test("read_file truncation metadata gives the next relative line range", async () => {
    const registry: ToolRegistryPort = { definitions: () => new MockRegistry().definitions(), async execute() {
      return { content: "one\ntwo\nthree", isError: false, filePath: "contracts/Vault.sol", lineRange: [1, 3], isTruncated: true }
    } }
    const calls: string[] = []
    const shapedContent: string[] = []
    const engine = new ProductionContextEngine(createO200kTokenizer())
    const shape = engine.shapeToolResult.bind(engine)
    engine.shapeToolResult = async (input) => {
      calls.push(JSON.stringify(input))
      const shaped = await shape({ ...input, policy: { ...input.policy, toolOutputMaxLines: 1,
        toolOutputMaxTokens: createO200kTokenizer().count("[truncated read_file output: showing 1 of 3 lines; read contracts/Vault.sol from line 2]") + 8 } })
      shapedContent.push(shaped.content)
      return shaped
    }
    const gateway = new ScriptedGateway([
      { attemptId: "tool", finishReason: "tool_calls", toolCalls: [{ id: "call", name: "read_file", arguments: { path: "contracts/Vault.sol", startLine: 1 } }], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 }, latencyMs: 1 },
      { attemptId: "done", finishReason: "stop", content: "ok", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 }, latencyMs: 1 },
    ])
    await new MultiTurnRunner({ store: new InMemoryRunStore({ clock }), gateway, registry, snapshot: new MockSnapshot(), contextEngine: engine, clock })
      .execute({ prompt: "Audit", snapshotId: "snap", maxOutputTokens: 16, providerProfile: { outputTokensField: "max_tokens", maxContextTokens: 32768, maxOutputTokens: 4096 } })
    expect(calls[0]).toContain('"path":"contracts/Vault.sol"')
    expect(calls[0]).toContain('"lineRange":[1,3]')
    expect(shapedContent[0]).toContain("contracts/Vault.sol from line 2")
  })

  test("fails closed if a ready context engine omits the prepared request", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([])
    const engine = new PassThroughContextEngine()
    const prepare = engine.prepare.bind(engine)
    engine.prepare = async (input) => {
      const result = await prepare(input)
      if (result.status === "ready") delete result.preparedRequest
      return result
    }
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: engine, clock })
    const result = await runner.execute({ prompt: "Audit", snapshotId: "snap" })
    expect(result.state).toBe("failed")
    expect(gateway.calls).toHaveLength(0)
  })

  test("does not call the gateway if context allocation telemetry cannot be persisted", async () => {
    const store = new InMemoryRunStore({ clock })
    const gateway = new ScriptedGateway([])
    const originalAppend = store.appendEvent.bind(store)
    store.appendEvent = async (input) => {
      if (input.event.type === "context.allocated") throw new Error("allocation store unavailable")
      return originalAppend(input)
    }
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })
    const result = await runner.execute({ prompt: "Audit", snapshotId: "snap" })
    expect(result.state).toBe("failed")
    expect(gateway.calls).toHaveLength(0)
  })

  test("fails closed before gateway when production profile has no evidenced context limit", async () => {
    const gateway = new ScriptedGateway([])
    const runner = new MultiTurnRunner({
      store: new InMemoryRunStore({ clock }), gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(),
      contextEngine: new ProductionContextEngine(createO200kTokenizer()), clock,
    })
    const result = await runner.execute({ prompt: "Audit", snapshotId: "snap", maxOutputTokens: 64,
      providerProfile: { outputTokensField: "max_tokens", maxOutputTokens: 4096 } })
    expect(result.state).toBe("budget_exhausted")
    expect(result.terminalReason).toBe("context_budget")
    expect(gateway.calls).toHaveLength(0)
  })

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
      contextEngine: new PassThroughContextEngine(),
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
      contextEngine: new PassThroughContextEngine(),
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
      contextEngine: new PassThroughContextEngine(),
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
      contextEngine: new PassThroughContextEngine(),
      clock,
    })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-1",
      limits: {
        wallClockTimeoutMs: 60000,
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
      contextEngine: new PassThroughContextEngine(),
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
      contextEngine: new PassThroughContextEngine(),
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
      contextEngine: new PassThroughContextEngine(),
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
      contextEngine: new PassThroughContextEngine(),
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
    let now = 1000
    const clock = { nowMs: () => now }
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
      contextEngine: new PassThroughContextEngine(),
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
      contextEngine: new PassThroughContextEngine(),
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
      contextEngine: new PassThroughContextEngine(),
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
      contextEngine: new PassThroughContextEngine(),
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
      contextEngine: new PassThroughContextEngine(),
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
      contextEngine: new PassThroughContextEngine(),
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

  test("resumed run reuses the persisted context policy instead of current defaults", async () => {
    let now = 1000
    const clock = { nowMs: () => now }
    const store = new InMemoryRunStore({ clock, leaseMs: 1 })
    const runId = "run-resume-policy"
    store.seedRun(runId, "queued", "Audit prompt", "snap-1")
    const firstClaim = await store.claim({ runId, workerId: "first" })
    if (firstClaim.kind !== "claimed") throw new Error("setup claim failed")
    const { buildRunConfigSnapshot } = require("../../src/runner/run-config")
    const { DefaultRetryConfig, ResolvedFlagNames } = require("@harness/protocol")
    const { sha256Hex, digestOf } = require("../../src/util/digest")
    const policy = { policyVersion: "persisted-policy", windowLimitTokens: 12000, outputReserveTokens: 1234, compactionThreshold: 0.75,
      safetyMarginFactor: 1.25, recentWindowTokens: 3000, toolOutputMaxTokens: 700, toolOutputMaxLines: 33, maxCompactions: 0,
      flags: { enableToolTruncation: true, enableObsMasking: false, enableSupersedeReads: false, enableDropEmpty: false, enableLlmCompaction: false, enableSessionNote: false } }
    const flags = Object.fromEntries(ResolvedFlagNames.map((name: string) => [name,
      name in policy.flags ? policy.flags[name as keyof typeof policy.flags] : name !== "enableInfraRetry" && name !== "enableSchemaRepair" && name !== "enableMaxStepsForcing"]))
    const built = buildRunConfigSnapshot({ flags, policy, retry: DefaultRetryConfig,
      limits: { wallClockTimeoutMs: 60000, totalTokenBudget: 100000, maxSteps: 10, noProgressMaxRepeats: 3 },
      systemPromptDigest: `sha256:${sha256Hex("sys")}`, verdictSchemaDigest: `sha256:${sha256Hex("verdict")}` })
    const payload = { snapshot: built.snapshot, snapshotDigest: built.digest }
    await store.appendEvent({ claim: firstClaim.claim, expectedStateVersion: firstClaim.stateVersion, event: {
      eventId: "start-policy", type: "run.started", schemaVersion: 1, payload, payloadDigest: digestOf(payload), occurredAt: new Date(1000).toISOString(),
    } })
    await store.transition({ claim: firstClaim.claim, expectedState: "queued", expectedStateVersion: firstClaim.stateVersion, nextState: "running" })
    await store.appendEvent({ claim: firstClaim.claim, expectedStateVersion: firstClaim.stateVersion, event: {
      eventId: "step-policy", type: "step.started", schemaVersion: 1, payload: { stepIndex: 1, toolsDisabled: false },
      payloadDigest: digestOf({ stepIndex: 1, toolsDisabled: false }), occurredAt: new Date(1001).toISOString(),
    } })
    now += 2
    let observedPolicy: unknown
    const engine = new PassThroughContextEngine()
    const prepare = engine.prepare.bind(engine)
    engine.prepare = async (input) => { observedPolicy = input.policy; return prepare(input) }
    const gateway = new ScriptedGateway([{ attemptId: "resume", finishReason: "stop", content: "ok", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 }, latencyMs: 1 }])
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: engine, clock })
    const resumed = await runner.execute({ runId, workerId: "resumer", prompt: "Audit prompt", snapshotId: "snap-1" })
    expect(observedPolicy, JSON.stringify({ resumed, observedPolicy })).toEqual(policy)
  })

  test("resume with omitted request options restores persisted output and sampling settings", async () => {
    let now = 1000
    const clock = { nowMs: () => now }
    const store = new InMemoryRunStore({ clock, leaseMs: 1 })
    const runId = "run-resume-options"
    store.seedRun(runId, "queued", "Audit prompt", "snap-1")
    const claim = await store.claim({ runId, workerId: "first" })
    if (claim.kind !== "claimed") throw new Error("setup claim failed")
    const { buildRunConfigSnapshot } = require("../../src/runner/run-config")
    const { DefaultRetryConfig, ResolvedFlagNames } = require("@harness/protocol")
    const { digestOf, sha256Hex } = require("../../src/util/digest")
    const policy = {
      policyVersion: "v1", windowLimitTokens: 16384, outputReserveTokens: 4096, compactionThreshold: 0.8, safetyMarginFactor: 1.2,
      recentWindowTokens: 1000, toolOutputMaxTokens: 1000, toolOutputMaxLines: 100, maxCompactions: 0,
      flags: { enableToolTruncation: true, enableObsMasking: false, enableSupersedeReads: false, enableDropEmpty: false, enableLlmCompaction: false, enableSessionNote: false },
    }
    const flags = Object.fromEntries(ResolvedFlagNames.map((name: string) => [name,
      name in policy.flags ? policy.flags[name as keyof typeof policy.flags] : name !== "enableInfraRetry" && name !== "enableSchemaRepair" && name !== "enableMaxStepsForcing"]))
    const cfg = buildRunConfigSnapshot({ flags, policy, retry: DefaultRetryConfig, limits: { wallClockTimeoutMs: 60000, totalTokenBudget: 100000, maxSteps: 10, noProgressMaxRepeats: 3 },
    systemPromptDigest: `sha256:${sha256Hex("sys")}`, verdictSchemaDigest: `sha256:${sha256Hex("verdict")}` })
    const payload = { snapshot: cfg.snapshot, snapshotDigest: cfg.digest, profileId: "custom", requestOptions: { maxOutputTokens: 32, temperature: 0.3 } }
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: { eventId: "start", type: "run.started", schemaVersion: 1, payload, payloadDigest: digestOf(payload), occurredAt: new Date(now).toISOString() } })
    const item = { id: "sys", turn: 1, type: "system_prompt" as const, isPinned: true, content: "x" }
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: { eventId: "item", type: "context.item_added", schemaVersion: 1, payload: { item }, payloadDigest: digestOf({ item }), occurredAt: new Date(now).toISOString() } })
    await store.transition({ claim: claim.claim, expectedState: "queued", expectedStateVersion: claim.stateVersion, nextState: "running" })
    now += 2
    const seen: ModelAttemptRequest[] = []
    const engine = new PassThroughContextEngine()
    const prepare = engine.prepare.bind(engine)
    engine.prepare = async (input) => { const result = await prepare(input); if (input.request) seen.push(input.request); return result }
    const gateway = new ScriptedGateway([{ attemptId: "resume", finishReason: "stop", content: "ok", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 }, latencyMs: 1 }])
    await new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: engine, clock })
      .execute({ runId, workerId: "resume", prompt: "Audit prompt", snapshotId: "snap-1" })
    expect(seen[0]?.profileId).toBe("custom")
    expect(seen[0]?.maxOutputTokens).toBe(32)
    expect(seen[0]?.temperature).toBe(0.3)
  })

  test("resume fails closed before gateway when request digest cannot be reconstructed", async () => {
    let now = 1000
    const clock = { nowMs: () => now }
    const store = new InMemoryRunStore({ clock, leaseMs: 1 })
    const runId = "run-resume-bad-request"
    store.seedRun(runId, "queued", "Audit prompt", "snap-1")
    const claim = await store.claim({ runId, workerId: "first" })
    if (claim.kind !== "claimed") throw new Error("setup claim failed")
    const { digestOf } = require("../../src/util/digest")
    const { buildRunConfigSnapshot } = require("../../src/runner/run-config")
    const { DefaultRetryConfig, ResolvedFlagNames } = require("@harness/protocol")
    const policy = { policyVersion: "v1", windowLimitTokens: 16384, outputReserveTokens: 4096, compactionThreshold: 0.8, safetyMarginFactor: 1.2,
      recentWindowTokens: 1000, toolOutputMaxTokens: 1000, toolOutputMaxLines: 100, maxCompactions: 0,
      flags: { enableToolTruncation: true, enableObsMasking: false, enableSupersedeReads: false, enableDropEmpty: false, enableLlmCompaction: false, enableSessionNote: false } }
    const flags = Object.fromEntries(ResolvedFlagNames.map((name: string) => [name, name in policy.flags ? policy.flags[name as keyof typeof policy.flags] : false]))
    const cfg = buildRunConfigSnapshot({ flags, policy, retry: DefaultRetryConfig, limits: { wallClockTimeoutMs: 60000, totalTokenBudget: 100000, maxSteps: 10, noProgressMaxRepeats: 3 }, systemPromptDigest: "sha256:" + "0".repeat(64), verdictSchemaDigest: "sha256:" + "1".repeat(64) })
    const started = { snapshot: cfg.snapshot, snapshotDigest: cfg.digest, profileId: "default", requestOptions: {} }
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: { eventId: "start", type: "run.started", schemaVersion: 1, payload: started, payloadDigest: digestOf(started), occurredAt: new Date(now).toISOString() } })
    const item = { id: "sys", turn: 1, type: "system_prompt" as const, isPinned: true, content: "x" }
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: { eventId: "item", type: "context.item_added", schemaVersion: 1, payload: { item }, payloadDigest: digestOf({ item }), occurredAt: new Date(now).toISOString() } })
    const allocation = { stepIndex: 1, telemetry: { tokenizer: "o200k_base", policyVersion: "v1", estimatedInputTokens: 1, estimatedSafetyTokens: 0, windowLimitTokens: 16384, outputReserveTokens: 4096, tokensSaved: 0, budgetRemainingTokens: 100000, contentDigest: digestOf([item]), requestDigest: "sha256:" + "f".repeat(64), estimatedOutputTokens: 4096 } }
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: { eventId: "allocation", type: "context.allocated", schemaVersion: 1, payload: allocation, payloadDigest: digestOf(allocation), occurredAt: new Date(now).toISOString() } })
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: { eventId: "step", type: "step.started", schemaVersion: 1, payload: { stepIndex: 1, toolsDisabled: false }, payloadDigest: digestOf({ stepIndex: 1, toolsDisabled: false }), occurredAt: new Date(now).toISOString() } })
    await store.transition({ claim: claim.claim, expectedState: "queued", expectedStateVersion: claim.stateVersion, nextState: "running" })
    now += 2
    const gateway = new ScriptedGateway([])
    const result = await new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: new ProductionContextEngine(createO200kTokenizer()), clock })
      .execute({ runId, workerId: "resume", prompt: "Audit prompt", snapshotId: "snap-1", providerProfile: { outputTokensField: "max_tokens", maxContextTokens: 32768, maxOutputTokens: 4096 } })
    expect(result.state).toBe("failed")
    expect(result.terminalReason).toBe("persistence_failure")
    expect(gateway.calls).toHaveLength(0)
  })

  test("resume charges an allocation whose provider attempt has null usage before budget preflight", async () => {
    let now = 1000
    const clock = { nowMs: () => now }
    const store = new InMemoryRunStore({ clock, leaseMs: 1 })
    const runId = "run-resume-null-usage-budget"
    store.seedRun(runId, "queued", "Audit prompt", "snap-1")
    const claim = await store.claim({ runId, workerId: "first" })
    if (claim.kind !== "claimed") throw new Error("setup claim failed")
    const { digestOf, sha256Hex } = require("../../src/util/digest")
    const { buildRunConfigSnapshot } = require("../../src/runner/run-config")
    const { DefaultRetryConfig, ResolvedFlagNames } = require("@harness/protocol")
    const policy = { policyVersion: "v1", windowLimitTokens: 16384, outputReserveTokens: 4096, compactionThreshold: 0.8, safetyMarginFactor: 1.2,
      recentWindowTokens: 1000, toolOutputMaxTokens: 1000, toolOutputMaxLines: 100, maxCompactions: 0,
      flags: { enableToolTruncation: true, enableObsMasking: false, enableSupersedeReads: false, enableDropEmpty: false, enableLlmCompaction: false, enableSessionNote: false } }
    const flags = Object.fromEntries(ResolvedFlagNames.map((name: string) => [name, name in policy.flags ? policy.flags[name as keyof typeof policy.flags] : false]))
    const cfg = buildRunConfigSnapshot({ flags, policy, retry: DefaultRetryConfig, limits: { wallClockTimeoutMs: 60000, totalTokenBudget: 500, maxSteps: 10, noProgressMaxRepeats: 3 }, systemPromptDigest: `sha256:${sha256Hex("sys")}`, verdictSchemaDigest: `sha256:${sha256Hex("verdict")}` })
    const started = { snapshot: cfg.snapshot, snapshotDigest: cfg.digest, profileId: "default", requestOptions: { maxOutputTokens: 100 } }
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: { eventId: "start", type: "run.started", schemaVersion: 1, payload: started, payloadDigest: digestOf(started), occurredAt: new Date(now).toISOString() } })
    const item = { id: "sys", turn: 1, type: "system_prompt" as const, isPinned: true, content: "x" }
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: { eventId: "item", type: "context.item_added", schemaVersion: 1, payload: { item }, payloadDigest: digestOf({ item }), occurredAt: new Date(now).toISOString() } })
    const allocation = { stepIndex: 1, telemetry: { tokenizer: "o200k_base", policyVersion: "v1", estimatedInputTokens: 300, estimatedSafetyTokens: 60, windowLimitTokens: 16384, outputReserveTokens: 100, tokensSaved: 0, budgetRemainingTokens: 500, contentDigest: digestOf([item]), estimatedOutputTokens: 100 } }
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: { eventId: "allocation", type: "context.allocated", schemaVersion: 1, payload: allocation, payloadDigest: digestOf(allocation), occurredAt: new Date(now).toISOString() } })
    const attempt = { stepIndex: 1, attemptIndex: 1, profileId: "default", purpose: "reasoning", usage: null, costUsd: null, latencyMs: 1, retryDecision: "none", backoffMs: 0 }
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: { eventId: "attempt", type: "provider.attempted", schemaVersion: 1, payload: attempt, payloadDigest: digestOf(attempt), occurredAt: new Date(now).toISOString() } })
    await store.transition({ claim: claim.claim, expectedState: "queued", expectedStateVersion: claim.stateVersion, nextState: "running" })
    now += 2
    let restoredTokens: number | undefined
    const engine = new ProductionContextEngine(createO200kTokenizer())
    const prepare = engine.prepare.bind(engine)
    engine.prepare = async (input) => { restoredTokens = input.budget.totalTokensUsed; return prepare(input) }
    let providerCalls = 0
    const gateway: ModelGatewayPort = { async executeAttempt() { providerCalls++; return { attemptId: "must-not-run", finishReason: "stop", content: "unexpected", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 }, latencyMs: 1 } } }
    const result = await new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: engine, clock })
      .execute({ runId, workerId: "resume", prompt: "Audit prompt", snapshotId: "snap-1", maxOutputTokens: 100, limits: { totalTokenBudget: 500 }, providerProfile: { outputTokensField: "max_tokens", maxContextTokens: 32768, maxOutputTokens: 4096 } })
    expect(restoredTokens).toBe(400)
    expect(result.state).toBe("budget_exhausted")
    expect(result.terminalReason).toBe("context_budget")
    expect(providerCalls).toBe(0)
  })

  test("resumed run fails closed when persisted context policy is malformed", async () => {
    let now = 1000
    const clock = { nowMs: () => now }
    const store = new InMemoryRunStore({ clock, leaseMs: 1 })
    const runId = "run-resume-policy-invalid"
    store.seedRun(runId, "queued", "Audit prompt", "snap-1")
    const claim = await store.claim({ runId, workerId: "first" })
    if (claim.kind !== "claimed") throw new Error("setup claim failed")
    const { digestOf } = require("../../src/util/digest")
    const payload = { snapshot: { contextPolicy: { windowLimitTokens: "bad" } } }
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: {
      eventId: "bad-policy", type: "run.started", schemaVersion: 1, payload, payloadDigest: digestOf(payload), occurredAt: new Date(now).toISOString(),
    } })
    await store.transition({ claim: claim.claim, expectedState: "queued", expectedStateVersion: claim.stateVersion, nextState: "running" })
    now += 2
    const gateway = new ScriptedGateway([])
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })
    const result = await runner.execute({ runId, workerId: "resumer", prompt: "Audit prompt", snapshotId: "snap-1" })
    expect(result.state).toBe("failed")
    expect(result.error).toContain("context policy is missing or invalid")
    expect(gateway.calls).toHaveLength(0)
  })

  test("resumed run fails closed when contextPolicy is explicitly undefined", async () => {
    let now = 1000
    const clock = { nowMs: () => now }
    const store = new InMemoryRunStore({ clock, leaseMs: 1 })
    const runId = "run-resume-policy-undefined"
    store.seedRun(runId, "queued", "Audit prompt", "snap-1")
    const claim = await store.claim({ runId, workerId: "first" })
    if (claim.kind !== "claimed") throw new Error("setup claim failed")
    const { digestOf } = require("../../src/util/digest")
    const snapshot = { contextPolicy: undefined }
    const payload = { snapshot }
    await store.appendEvent({ claim: claim.claim, expectedStateVersion: claim.stateVersion, event: {
      eventId: "undefined-policy", type: "run.started", schemaVersion: 1, payload, payloadDigest: digestOf(payload), occurredAt: new Date(now).toISOString(),
    } })
    await store.transition({ claim: claim.claim, expectedState: "queued", expectedStateVersion: claim.stateVersion, nextState: "running" })
    now += 2
    const gateway = new ScriptedGateway([])
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })
    const result = await runner.execute({ runId, workerId: "resumer", prompt: "Audit prompt", snapshotId: "snap-1" })
    expect(result.state).toBe("failed")
    expect(result.error).toContain("context policy is missing or invalid")
    expect(gateway.calls).toHaveLength(0)
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
      contextEngine: new PassThroughContextEngine(),
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
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })

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
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })

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
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })

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
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })

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
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })

    const result = await runner.execute({ prompt: "Audit Vault.sol", snapshotId: "snap-length" })
    const completed = (await store.loadEvents({ runId: result.runId })).find((event) => event.type === "run.completed")

    expect(result.state).toBe("completed")
    expect(result.outputTruncated).toBe(true)
    expect(registry.calls).toHaveLength(0)
    expect((completed?.payload as { outputTruncated?: boolean }).outputTruncated).toBe(true)
  })

  test("unpriced usage is preserved without cost-ceiling telemetry", async () => {
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
    const runner = new MultiTurnRunner({
      store,
      gateway,
      registry: new MockRegistry(),
      snapshot: new MockSnapshot(),
      contextEngine: new PassThroughContextEngine(),
      clock,
      estimatePromptTokens: () => 10,
    })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-unpriced",
      pricing: "unpriced",
      limits: { maxSteps: 3, maxToolCalls: 3 },
    })
    const started = (await store.loadEvents({ runId: result.runId })).find((event) => event.type === "run.started")

    expect(started?.payload).not.toHaveProperty("costBudgetEnforced")
    expect(result.state).toBe("completed")
    expect(gateway.calls).toHaveLength(2)
    expect(result.usage.pricing).toBe("unpriced")
  })

  test("priced cost does not stop a run", async () => {
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
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })

    const result = await runner.execute({
      prompt: "Audit Vault.sol",
      snapshotId: "snap-priced",
      pricing: "priced",
      limits: { maxSteps: 3, maxToolCalls: 3 },
    })

    expect(result.state).toBe("completed")
    expect(result.usage.costUsd).toBe(0.021)
    expect(registry.calls).toHaveLength(1)
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
    const runner = new MultiTurnRunner({ store, gateway, registry: new MockRegistry(), snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })

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
    const runner = new MultiTurnRunner({ store, gateway, registry, snapshot: new MockSnapshot(), contextEngine: new PassThroughContextEngine(), clock })

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
