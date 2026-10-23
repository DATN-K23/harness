import { describe, expect, test } from "bun:test"
import type { ContextItem, ModelAttemptError } from "@harness/protocol"
import { loadPrompt } from "../../src/prompts/index"
import { parseForwardResult } from "../../src/judge/bidirectional-verifier"
import { ScriptedContextEngine } from "../../src/testing/fake-context-engines"
import { errorResponse, textResponse, toolCallResponse, usageOf } from "../../src/testing/scripted-model-gateway"
import { digestOf, textDigest } from "../../src/util/digest"
import { baseItems, createHarness, invalidVerdict, limits, validVerdict, vaultLines } from "./judge-step-harness"

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
  test("forward verification is validated and queued as a separate backward step", async () => {
    const h = await createHarness({ script: [textResponse('{"reachability":"reachable","explanation":"entry reaches sink"}')] })
    const result = await h.step.execute(h.input({ items: [
      ...baseItems,
      { id: "direction", turn: 0, type: "system_prompt", isPinned: true, content: `Verification direction: forward\n${loadPrompt("forward-verification.v1").text}` },
    ] }))
    expect(result.newItems.some((item) => item.content.startsWith("Bidirectional forward result:"))).toBe(true)
    expect(result.newItems.find((item) => item.content.startsWith("Verification direction: backward"))).toBeDefined()
    expect(parseForwardResult('{"reachability":"reachable","explanation":"entry reaches sink"}').kind).toBe("ok")
  })

  const forwardDirection = (turn = 0): ContextItem => ({
    id: "direction", turn, type: "system_prompt", isPinned: true, content: `Verification direction: forward\n${loadPrompt("forward-verification.v1").text}`,
  })

  const onlySubmission = (call: { tools?: readonly { name: string }[]; toolChoice?: string }) =>
    call.toolChoice === "required" && call.tools?.map((tool) => tool.name).join() === "submit_verification"

  test("a direction that used its step budget keeps only the submission tool; another tool call is refused and asked again", async () => {
    const h = await createHarness({ script: [readVault()] })
    const result = await h.step.execute(h.input({ stepIndex: 3, verificationStepBudget: 3, items: [...baseItems, forwardDirection()] }))
    expect(onlySubmission(h.gateway.calls[0])).toBe(true)
    // The forcing instruction is a harness instruction, which the gateway sends with the user role.
    expect(h.gateway.calls[0].items.at(-1)).toMatchObject({ type: "harness_instruction" })
    expect(h.gateway.calls[0].items.at(-1)?.content).toContain("reading budget for the forward direction")
    expect(h.registry.calls).toHaveLength(0)
    expect(result.outcome.type).toBe("continue_turn")
    expect(result.newItems.some((item) => item.content.startsWith("Bidirectional forward result:"))).toBe(false)
    expect(result.newItems.find((item) => item.type === "tool_result")).toMatchObject({ toolMeta: { isError: true } })
    expect(result.repairsUsed).toBe(1)
  })

  test("a forced direction that keeps calling other tools after the repairs are spent is incomplete", async () => {
    const h = await createHarness({ script: [readVault()] })
    const result = await h.step.execute(h.input({ stepIndex: 3, verificationStepBudget: 3, repairsUsed: 2, items: [...baseItems, forwardDirection()] }))
    expect(result.newItems[0]?.content).toStartWith('Bidirectional forward result: {"reachability":"incomplete"')
    expect(result.newItems[1]?.content).toStartWith("Verification direction: backward")
    expect(result.repairsUsed).toBe(2)
  })

  test("a direction answers early when the run keeps only the steps the later phases need", async () => {
    const h = await createHarness({ script: [textResponse('{"reachability":"reachable","explanation":"entry reaches sink"}')] })
    // Step 8 of 10, direction started at step 5: within its budget of 6, but backward + verdict + repair need 3 steps.
    const result = await h.step.execute(h.input({ stepIndex: 8, items: [...baseItems, forwardDirection(5)] }))
    expect(onlySubmission(h.gateway.calls[0])).toBe(true)
    expect(h.gateway.calls[0].items.at(-1)?.content).toContain("reading budget for the forward direction")
    expect(h.gateway.calls[0].items.some((item) => item.content === maxStepsPrompt)).toBe(false)
    expect(result.newItems[0]?.content).toStartWith('Bidirectional forward result: {"reachability":"reachable"')
  })

  test("with no step limit, a direction reads freely and answers once the tokens left only cover finishing the run", async () => {
    const free = await createHarness({ script: [readVault()] })
    await free.step.execute(free.input({ stepIndex: 40, limits: { ...limits, maxSteps: 10_000 }, items: [...baseItems, forwardDirection()] }))
    expect(onlySubmission(free.gateway.calls[0])).toBe(false)
    expect(free.registry.calls).toHaveLength(1)

    const short = await createHarness({ script: [textResponse('{"reachability":"blocked","explanation":"onlyOwner guards withdraw"}')] })
    // 4 steps (this one + backward + verdict + repair) of about 4.8k tokens each (4k output x 1.2 margin) need ~19k; 15k are left.
    const result = await short.step.execute(short.input({
      stepIndex: 40,
      limits: { ...limits, maxSteps: 10_000, totalTokenBudget: 100_000 },
      budget: { totalTokensUsed: 85_000, totalTokenLimit: 100_000, compactionsCount: 0, costUsd: 0 },
      items: [...baseItems, forwardDirection()],
    }))
    expect(onlySubmission(short.gateway.calls[0])).toBe(true)
    expect(result.newItems[0]?.content).toStartWith('Bidirectional forward result: {"reachability":"blocked"')
  })

  test("a direction whose last three reads found nothing new is forced to answer", async () => {
    const reread = (n: number, startLine: number): ContextItem[] => [
      { id: `req-${n}`, turn: n, type: "tool_request", isPinned: false, content: JSON.stringify({ name: "read_file", arguments: {} }), toolMeta: { callId: `c${n}`, toolName: "read_file" } },
      { id: `res-${n}`, turn: n, type: "tool_result", isPinned: false, content: "same lines", toolMeta: { callId: `c${n}`, toolName: "read_file", filePath: "src/Vault.sol", lineRange: [startLine, startLine + 5] } },
    ]
    const h = await createHarness({ script: [textResponse('{"reachability":"blocked","explanation":"onlyOwner guards withdraw"}')] })
    await h.step.execute(h.input({
      stepIndex: 5,
      items: [...baseItems, forwardDirection(), ...reread(1, 1), ...reread(2, 1), ...reread(3, 1), ...reread(4, 1)],
    }))
    expect(onlySubmission(h.gateway.calls[0])).toBe(true)
  })

  const consensusAt = (turn: number, decision: string): ContextItem => ({ id: `consensus-${turn}`, turn, type: "system_prompt", isPinned: true, content: `Bidirectional consensus: ${decision}` })
  const rereadAt = (n: number): ContextItem[] => [
    { id: `vreq-${n}`, turn: n, type: "tool_request", isPinned: false, content: JSON.stringify({ name: "read_file", arguments: {} }), toolMeta: { callId: `v${n}`, toolName: "read_file" } },
    { id: `vres-${n}`, turn: n, type: "tool_result", isPinned: false, content: "same lines", toolMeta: { callId: `v${n}`, toolName: "read_file", filePath: "src/Vault.sol", lineRange: [1, 5] } },
  ]

  test("the verdict phase after an agreed consensus keeps only submit_verdict once its reads find nothing new", async () => {
    const h = await createHarness({ script: [textResponse(json(validVerdict))] })
    await h.step.execute(h.input({ stepIndex: 7, items: [...baseItems, ...rereadAt(1), consensusAt(2, "agreed-valid"), ...rereadAt(3), ...rereadAt(4), ...rereadAt(5)] }))
    const call = h.gateway.calls[0]
    expect(call.toolChoice).toBe("required")
    expect(call.tools?.map((tool) => tool.name)).toEqual(["submit_verdict"])
    expect(call.items.at(-1)?.content).toContain("Your reading for the verdict is complete")
  })

  test("a forced verdict phase that still gives no valid verdict ends unresolved instead of failing the run", async () => {
    const h = await createHarness({ script: [textResponse("I need to read more code first.")] })
    const result = await h.step.execute(h.input({
      stepIndex: 7,
      repairsUsed: 2,
      items: [...baseItems, ...rereadAt(1), consensusAt(2, "agreed-valid"), ...rereadAt(3), ...rereadAt(4), ...rereadAt(5)],
    }))
    expect(result.outcome).toMatchObject({ type: "completed", verdict: { validity: "unverified", reasonCode: "UNRESOLVED", summary: "No valid verdict was given after the reading was complete." } })
  })

  const blocked = (): ModelAttemptError => ({ isRetryable: false, category: "invalid_request", classification: "content_filter", message: "The provider's safety filter blocked the prompt (blockReason OTHER)." })
  const agreed = (decision: "agreed-valid" | "agreed-invalid"): ContextItem[] => {
    const [forward, backward] = decision === "agreed-valid"
      ? ['{"reachability":"reachable","explanation":"withdraw at src/Vault.sol:21-25 is external"}', '{"reconstruction":"reconstructed","explanation":"the balance update at src/Vault.sol:24 comes after the call"}']
      : ['{"reachability":"blocked","explanation":"src/Vault.sol:1-3 stops it"}', '{"reconstruction":"blocked","explanation":"src/Vault.sol:2 stops it"}']
    return [
      { id: "fwd", turn: 1, type: "system_prompt", isPinned: true, content: `Bidirectional forward result: ${forward}` },
      { id: "bwd", turn: 2, type: "system_prompt", isPinned: true, content: `Bidirectional backward result: ${backward}` },
      consensusAt(2, decision),
    ]
  }
  const reportWithSeverity: ContextItem = { id: "itm-finding", turn: 0, type: "candidate_finding", isPinned: true, content: "# Reentrancy in withdraw\n\nROOT CAUSE: call before update\nSEVERITY: high" }

  test("with static verdicts, a verdict step the provider blocks after agreed-valid is composed by the harness", async () => {
    const h = await createHarness({ script: Array.from({ length: 8 }, () => errorResponse(blocked())) })
    const result = await h.step.execute(h.input({ stepIndex: 3, enableStaticVerdicts: true, items: [baseItems[0]!, reportWithSeverity, ...agreed("agreed-valid")] }))
    expect(result.outcome).toMatchObject({ type: "completed", verdict: { validity: "valid", severity: "HIGH", confidence: "LOW", summary: expect.stringContaining("Composed by the harness") } })
    if (result.outcome.type === "completed")
      expect(result.outcome.verdict.citesEvidence.map((evidence) => `${evidence.filePath}:${evidence.startLine}-${evidence.endLine}`)).toEqual(["src/Vault.sol:21-25", "src/Vault.sol:24-24"])
  })

  test("a composed rejection still needs a guard in the source the directions referred to", async () => {
    const h = await createHarness({ script: Array.from({ length: 8 }, () => errorResponse(blocked())) })
    const result = await h.step.execute(h.input({ stepIndex: 3, enableStaticVerdicts: true, items: [...baseItems, ...agreed("agreed-invalid")] }))
    expect(result.outcome).toMatchObject({ type: "completed", verdict: { validity: "unverified", summary: "No blocking guard was confirmed in the cited source." } })
  })

  test("a forced direction answer the content filter refuses is recorded incomplete and the run goes on", async () => {
    const h = await createHarness({ script: Array.from({ length: 8 }, () => errorResponse(blocked())) })
    // Step 8 of 10: the forward direction must answer now to leave room for backward, verdict and a repair.
    const result = await h.step.execute(h.input({ stepIndex: 8, items: [...baseItems, forwardDirection()] }))
    expect(result.outcome.type).toBe("continue_turn")
    expect(result.newItems[0]?.content).toStartWith('Bidirectional forward result: {"reachability":"incomplete","explanation":"The provider\'s content filter refused')
    expect(result.newItems[1]?.content).toStartWith("Verification direction: backward")
  })

  test("without static verdicts a blocked verdict step still fails the run", async () => {
    const h = await createHarness({ script: Array.from({ length: 8 }, () => errorResponse(blocked())) })
    const result = await h.step.execute(h.input({ stepIndex: 3, items: [baseItems[0]!, reportWithSeverity, ...agreed("agreed-valid")] }))
    expect(result.outcome.type).toBe("failed")
  })

  test("a forced direction answers through submit_verification, the other direction's field null", async () => {
    const h = await createHarness({ script: [toolCallResponse([{ id: "s", name: "submit_verification", arguments: { reachability: "blocked", reconstruction: null, explanation: "onlyOwner guards withdraw" } }])] })
    const result = await h.step.execute(h.input({ stepIndex: 6, items: [...baseItems, forwardDirection()] }))
    expect(h.registry.calls).toHaveLength(0)
    expect(result.newItems[0]?.content).toBe('Bidirectional forward result: {"reachability":"blocked","explanation":"onlyOwner guards withdraw"}')
  })

  test("verification tool calls stay restricted to registered snapshot reads", async () => {
    const h = await createHarness({ script: [readVault()] })
    const result = await h.step.execute(h.input({ items: [
      ...baseItems,
      { id: "direction", turn: 0, type: "system_prompt", isPinned: true, content: `Verification direction: forward\n${loadPrompt("forward-verification.v1").text}` },
    ] }))
    expect(h.registry.calls.map((call) => call.toolName)).toEqual(["read_file"])
    expect(result.outcome.type).toBe("continue_turn")
  })

  test("agreed-invalid consensus without a snapshot-grounded citation is UNVERIFIED", async () => {
    const h = await createHarness({ script: [textResponse(json(invalidVerdict))] })
    const result = await h.step.execute(h.input({ items: [
      ...baseItems,
      { id: "consensus", turn: 2, type: "system_prompt", isPinned: true, content: "Bidirectional consensus: agreed-invalid" },
    ] }))
    expect(result.outcome).toMatchObject({ type: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
    expect(h.gateway.callCount).toBe(0)
    expect(await h.events("verdict.validation_failed")).toHaveLength(0)
  })

  test("disputed consensus without a witness commits UNVERIFIED before any provider call", async () => {
    const h = await createHarness({ script: [textResponse(json(invalidVerdict))] })
    const result = await h.step.execute(h.input({ items: [
      ...baseItems,
      { id: "consensus", turn: 2, type: "system_prompt", isPinned: true, content: "Bidirectional consensus: disputed" },
    ] }))
    expect(result.outcome).toMatchObject({ type: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED" } })
    expect(h.gateway.callCount).toBe(0)
  })

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
  test("passes a canonical model request to production context preparation", async () => {
    let request: import("@harness/protocol").ModelAttemptRequest | undefined
    const engine = new ScriptedContextEngine([(input) => {
      request = input.request
      return { status: "stop", stopReason: "context_budget" }
    }])
    const h = await createHarness({ script: [textResponse(json(invalidVerdict))], engine })
    const result = await h.step.execute(h.input())
    expect(request).toMatchObject({ attemptIndex: 1, runId: "run-1", stepIndex: 1, profileId: "profile-a", items: baseItems })
    expect(result.outcome.type).toBe("budget_exhausted")
  })

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

describe("JudgeStep: malformed tool calls", () => {
  const malformed = errorResponse({ isRetryable: false, category: "invalid_request", classification: "malformed_tool_call", message: "The provider returned a malformed function call." })

  test("a malformed tool call becomes a repair turn instead of failing the run", async () => {
    const h = await createHarness({ script: [malformed] })
    const result = await h.step.execute(h.input())
    expect(result.outcome.type).toBe("continue_turn")
    expect(result.repairsUsed).toBe(1)
    expect(result.newItems.at(-1)?.content).toContain("malformed tool call")
    expect(h.gateway.callCount).toBe(1)
  })

  test("a malformed tool call after the repair budget is spent fails the step", async () => {
    const h = await createHarness({ script: [malformed] })
    const result = await h.step.execute(h.input({ repairsUsed: 2 }))
    expect(result.outcome).toMatchObject({ type: "failed", reason: "provider_permanent" })
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

  test("cost of a failed attempt does not stop retrying", async () => {
    const script = [errorResponse(http(503), { usage: usageOf(10, 0, 0.5) }), readVault()]
    const h = await createHarness({ script })
    const result = await h.step.execute(h.input())
    expect(result.outcome.type).toBe("continue_turn")
    if (result.outcome.type === "continue_turn") expect(result.outcome.toolOutcomes).toHaveLength(1)
    expect(h.gateway.callCount).toBe(2)
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
