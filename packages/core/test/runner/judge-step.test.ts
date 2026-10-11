import { describe, expect, test } from "bun:test"
import type { ContextItem, ModelAttemptError } from "@harness/protocol"
import { loadPrompt } from "../../src/prompts/index"
import { ScriptedContextEngine } from "../../src/testing/fake-context-engines"
import { errorResponse, textResponse, toolCallResponse, usageOf } from "../../src/testing/scripted-model-gateway"
import { digestOf, textDigest } from "../../src/util/digest"
import { baseItems, createHarness, invalidVerdict, validVerdict, vaultLines } from "./judge-step-harness"

const json = (value: unknown) => JSON.stringify(value)
const readVault = (id = "call-1") =>
  toolCallResponse([{ id, name: "read_file", arguments: { path: "src/Vault.sol", startLine: 1, endLine: 5 } }])
const http = (statusCode: number, message = `HTTP ${statusCode}`): ModelAttemptError => ({
  isRetryable: false,
  category: statusCode === 429 ? "rate_limit" : statusCode === 401 ? "authentication" : "transport",
  message,
  statusCode,
})
const maxStepsPrompt = loadPrompt("max-steps.v1").text

describe("JudgeStep: seven gates", () => {
  test("gate order: prepare, gateway, record, then the tool runs and is filtered before it is shaped", async () => {
    const h = await createHarness({ script: [readVault()] })
    const result = await h.step.execute(h.input())
    expect(result.outcome.type).toBe("continue_turn")
    expect(h.log.map((entry) => entry.port)).toEqual(["prepare", "gateway", "record", "tool", "filter", "shape"])
  })

  test("the gateway receives exactly the prepared items, unchanged", async () => {
    const prepared: ContextItem[] = [
      baseItems[0],
      { id: "itm-masked", turn: 1, type: "tool_result", isPinned: false, content: "[masked: read again if needed]" },
    ]
    const before = structuredClone(prepared)
    const engine = new ScriptedContextEngine([{ status: "ready", preparedItems: prepared }])
    const h = await createHarness({ script: [textResponse(json(invalidVerdict))], engine })
    await h.step.execute(h.input())
    expect(h.gateway.calls[0].items).toEqual(before)
    expect(prepared).toEqual(before)
    expect("toolsDisabled" in h.gateway.calls[0]).toBe(false)
  })
})

describe("JudgeStep: context preflight", () => {
  test("engine stop: budget_exhausted with the engine's reason and zero gateway calls", async () => {
    const engine = new ScriptedContextEngine([{ status: "stop", stopReason: "context_budget" }])
    const h = await createHarness({ script: [textResponse(json(invalidVerdict))], engine })
    const result = await h.step.execute(h.input())
    expect(result.outcome).toEqual({ type: "budget_exhausted", reason: "context_budget_exhausted" })
    expect(h.gateway.callCount).toBe(0)
  })

  test("needs_compaction is handed to the runner with zero gateway calls", async () => {
    const engine = new ScriptedContextEngine([
      { status: "needs_compaction", summaryPrompt: "Summarize.", itemsToSummarize: [baseItems[1]] },
    ])
    const h = await createHarness({ script: [], engine })
    const result = await h.step.execute(h.input())
    expect(result.outcome).toEqual({
      type: "needs_compaction",
      summaryPrompt: "Summarize.",
      itemsToSummarize: [baseItems[1]],
    })
    expect(h.gateway.callCount).toBe(0)
  })

  test("two transformations become two context.transformed events and the allocation carries the digest", async () => {
    const transformations = [
      { action: "masked", targetItemId: "a", tokensBefore: 400, tokensAfter: 12, replacementNote: "[masked a]" },
      { action: "dropped_empty", targetItemId: "b", tokensBefore: 9, tokensAfter: 0, replacementNote: "[dropped b]" },
    ] as const
    const engine = new ScriptedContextEngine([
      { status: "ready", preparedItems: baseItems, transformations: [...transformations] },
    ])
    const h = await createHarness({ script: [textResponse(json(invalidVerdict))], engine })
    await h.step.execute(h.input())
    expect((await h.events("context.transformed")).map((event) => event.payload)).toEqual([...transformations])
    const [allocated] = await h.events("context.allocated")
    expect(allocated.payload).toMatchObject({ stepIndex: 1, telemetry: { contentDigest: digestOf(baseItems) } })
  })
})

describe("JudgeStep: step-limit forcing", () => {
  test("maxSteps 4: step 3 disables tools, appends the forcing instruction and a verdict there completes", async () => {
    const h = await createHarness({ script: [textResponse(json(invalidVerdict))], limits: { maxSteps: 4 } })
    const result = await h.step.execute(h.input({ stepIndex: 3 }))
    const request = h.gateway.calls[0]
    expect(request.toolsDisabled).toBe(true)
    expect(request.items.slice(0, -1)).toEqual(baseItems)
    expect(request.items.at(-1)?.content).toBe(maxStepsPrompt)
    expect(result.outcome.type).toBe("completed")
  })

  test("a model that never concludes ends budget_exhausted with max_steps and no tool runs on forced steps", async () => {
    const script = [1, 2, 3, 4].map((step) => readVault(`call-${step}`))
    const h = await createHarness({ script, limits: { maxSteps: 4 } })
    const run = await h.drive()
    expect(run).toMatchObject({ end: "budget_exhausted", reason: "max_steps_exceeded" })
    expect(h.registry.calls).toHaveLength(2)
    const refused = run.results[3].newItems.find((item) => item.type === "tool_result")
    expect(refused?.toolMeta?.isError).toBe(true)
    expect(refused?.content).toContain("tools are disabled")
    expect((await h.events("tool.failed")).length).toBe(2)
  })

  test("forcing disabled: step maxSteps - 1 does not set toolsDisabled", async () => {
    const h = await createHarness({
      script: [textResponse(json(invalidVerdict))],
      limits: { maxSteps: 4 },
      flags: { enableMaxStepsForcing: false },
    })
    await h.step.execute(h.input({ stepIndex: 3 }))
    expect("toolsDisabled" in h.gateway.calls[0]).toBe(false)
    expect(h.gateway.calls[0].items).toEqual(baseItems)
  })
})

describe("JudgeStep: verdict validation and repair", () => {
  test("repair succeeds: the run completes after the second answer with one validation_failed event", async () => {
    const script = [textResponse(json({ ...invalidVerdict, reasoning: "short" })), textResponse(json(invalidVerdict))]
    const h = await createHarness({ script })
    const run = await h.drive()
    expect(run.end).toBe("completed")
    expect(run.results).toHaveLength(2)
    expect(await h.events("verdict.validation_failed")).toHaveLength(1)
    expect(h.gateway.calls[1].items.at(-1)?.content).toContain("reasoning")
  })

  test("repair exhausted: three invalid verdicts end failed with schema_repair_exhausted", async () => {
    const bad = textResponse(json({ ...invalidVerdict, reasoning: "short" }))
    const h = await createHarness({ script: [bad, bad, bad] })
    const run = await h.drive()
    expect(run).toMatchObject({ end: "failed", outcome: { reason: "schema_repair_exhausted" } })
    expect(await h.events("verdict.validation_failed")).toHaveLength(3)
  })

  test("repair disabled: the first invalid verdict ends failed with schema_repair_exhausted", async () => {
    const h = await createHarness({
      script: [textResponse(json({ ...invalidVerdict, reasoning: "short" }))],
      flags: { enableSchemaRepair: false },
    })
    const result = await h.step.execute(h.input())
    expect(result.outcome).toMatchObject({ type: "failed", reason: "schema_repair_exhausted" })
  })

  test("evidence outside the snapshot fails validation and no verdict is committed", async () => {
    const verdict = {
      ...validVerdict,
      citesEvidence: [{ filePath: "src/Missing.sol", startLine: 1, endLine: 2, explanation: "x" }],
    }
    const h = await createHarness({ script: [textResponse(json(verdict))] })
    const result = await h.step.execute(h.input())
    expect(result.outcome).toEqual({ type: "continue_turn", toolOutcomes: [] })
    const [failed] = await h.events("verdict.validation_failed")
    expect(failed.payload).toEqual({
      attempt: 1,
      issues: [{ reason: "EVIDENCE_UNRESOLVED", path: ["citesEvidence", 0, "filePath"] }],
    })
  })

  test("the committed evidence carries the runner's digest of exactly lines 10-20", async () => {
    const h = await createHarness({ script: [textResponse(json(validVerdict))] })
    const result = await h.step.execute(h.input())
    expect(result.outcome.type).toBe("completed")
    if (result.outcome.type !== "completed") return
    expect(result.outcome.verdict.citesEvidence[0]?.contentDigest).toBe(textDigest(vaultLines.slice(9, 20).join("\n")))
  })
})

describe("JudgeStep: provider attempts", () => {
  test("two 429s then success: three provider.attempted events, backoff on the first two", async () => {
    const script = [errorResponse(http(429)), errorResponse(http(429)), readVault()]
    const h = await createHarness({ script })
    await h.step.execute(h.input())
    const attempts = (await h.events("provider.attempted")).map((event) => event.payload)
    expect(attempts.map((payload) => payload.attemptIndex)).toEqual([1, 2, 3])
    expect(attempts.map((payload) => (payload.backoffMs as number) > 0)).toEqual([true, true, false])
    expect(attempts.every((payload) => payload.stepIndex === 1)).toBe(true)
  })

  test("totals equal the sum over all attempts, including a failed attempt that returned usage", async () => {
    const script = [
      errorResponse(http(503), { usage: usageOf(7, 0, 0.002) }),
      textResponse(json(invalidVerdict), { usage: usageOf(100, 20, 0.01) }),
    ]
    const h = await createHarness({ script })
    const result = await h.step.execute(h.input())
    const attempts = (await h.events("provider.attempted")).map((event) => event.payload)
    const tokens = attempts.reduce((sum, payload) => sum + (payload.usage as { totalTokens: number }).totalTokens, 0)
    const cost = attempts.reduce((sum, payload) => sum + (payload.costUsd as number), 0)
    expect(result.usage).toEqual({ promptTokens: 107, completionTokens: 20, totalTokens: tokens, costUsd: cost })
    expect(h.log.filter((entry) => entry.port === "record")).toEqual([{ port: "record", totalTokens: 120 }])
  })

  test("context overflow ends budget_exhausted with context_budget", async () => {
    const overflow: ModelAttemptError = {
      isRetryable: false,
      category: "invalid_request",
      message: "prompt is too long",
    }
    const h = await createHarness({ script: [errorResponse(overflow)] })
    const result = await h.step.execute(h.input())
    expect(result.outcome).toEqual({ type: "budget_exhausted", reason: "context_budget_exhausted" })
  })

  test("retry off: one 503 is a terminal provider failure after exactly one attempt", async () => {
    const h = await createHarness({ script: [errorResponse(http(503))], flags: { enableInfraRetry: false } })
    const result = await h.step.execute(h.input())
    expect(result.outcome).toMatchObject({ type: "failed", reason: "provider_transient_primary" })
    expect(h.gateway.callCount).toBe(1)
  })

  test("cancel while waiting: no further attempt and the step reports cancellation", async () => {
    const h = await createHarness({ script: [errorResponse(http(429)), readVault()] })
    // Poll 1 follows prepare; poll 2 is the retry policy's, after the backoff wait.
    h.cancellation.requestOnPoll(2)
    const result = await h.step.execute(h.input())
    expect(result.cancelledAt).toBe("before_provider_call")
    expect(result.outcome).toMatchObject({ type: "failed", reason: "cancelled_by_user" })
    expect(h.gateway.callCount).toBe(1)
  })

  test("a backoff longer than the remaining wall clock ends with wall_clock_timeout instead of retrying", async () => {
    const script = [errorResponse(http(503)), readVault()]
    const h = await createHarness({ script, limits: { wallClockTimeoutMs: 1_500 } })
    const result = await h.step.execute(h.input())
    expect(result.outcome).toEqual({ type: "budget_exhausted", reason: "wall_clock_timeout" })
    expect(h.gateway.callCount).toBe(1)
  })

  test("stop conditions are evaluated before a retry with the cost the failed attempt incurred", async () => {
    const script = [errorResponse(http(503), { usage: usageOf(10, 0, 0.5) }), readVault()]
    const h = await createHarness({ script, limits: { costCeilingUsd: 0.5 } })
    const result = await h.step.execute(h.input())
    expect(result.outcome).toEqual({ type: "budget_exhausted", reason: "cost_budget_exhausted" })
    expect(result.observedLimits).toEqual(["cost_budget_exhausted"])
    expect(h.gateway.callCount).toBe(1)
  })
})

describe("JudgeStep: never throws", () => {
  test("a store fault becomes a failed outcome with persistence_failure", async () => {
    const h = await createHarness({ script: [textResponse(json(invalidVerdict))] })
    h.store.failNext("appendEvent")
    const result = await h.step.execute(h.input())
    expect(result.outcome).toMatchObject({ type: "failed", reason: "persistence_failure" })
  })

  test("the step appends events but never changes run state", async () => {
    const h = await createHarness({ script: [readVault()] })
    const before = await h.store.loadRun("run-1")
    await h.step.execute(h.input())
    expect(await h.store.loadRun("run-1")).toEqual(before)
  })
})
