import { describe, expect, test } from "bun:test"
import {
  EventPayloadSchemas,
  JudgeVerdictSchema,
  type CandidateFinding,
  type ContextItem,
  type ContextPolicy,
  type RunClaim,
} from "@harness/protocol"
import { type JudgeRunConfig, type JudgeRunInput, type JudgeRunResult } from "../../src/runner/judge-runner"
import { ScriptedContextEngine } from "../../src/testing/fake-context-engines"
import { errorResponse, textResponse, toolCallResponse, usageOf } from "../../src/testing/scripted-model-gateway"
import {
  RunId,
  createWorld,
  expectContiguous,
  finding,
  okIngestion,
  okSanitizer,
  readVault,
  runInput,
  verdictText,
  type World,
  type Worker,
} from "../helpers/runner-world"
import { flags, limits, policy } from "./judge-step-harness"

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
  test("legacy missing_poc remains a compatibility fast-reject", async () => {
    const world = createWorld()
    const w = world.worker({ ingestion: { kind: "missing_poc" } })
    await expectFastReject(world, w, await w.start(), "MISSING_POC")
  })

  test("malformed report deconstruction is inconclusive, not an invalid verdict", async () => {
    const world = createWorld()
    const w = world.worker({ ingestion: { kind: "invalid_report" } })
    expect(await w.start()).toMatchObject({ kind: "committed", state: "failed", terminalReason: "worker_interrupted" })
    expect(w.gateway.callCount).toBe(0)
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
  test("Tier 2 probe dispatch and result are committed with terminal outcome via CAS", async () => {
    const world = createWorld()
    const claim = { targetContracts: ["Vault"], targetFunctions: ["withdraw"], rootCause: "bad auth", attackScenario: "attacker calls", callerAssumptions: [], claimedImpact: "totalSupply changes", claimedState: "totalSupply" }
    const w = world.worker({
      ingestion: { kind: "ok", pocCode: "contract Test {}", claim, bceSlices: [] },
      sanitizerResult: { kind: "ok", stitchedTestFile: "contract Test {}", hasSubmitterAssertions: false, antiCheatReport: { rulesChecked: [], findings: [] } },
      stateProbe: { exitCode: 0, trace: "probe completed", stateDeltas: [{ variable: "totalSupply", before: "1", after: "2" }] },
      script: [
        textResponse("acknowledged"),
        textResponse('{"reachability":"incomplete","explanation":"insufficient evidence"}'),
        textResponse('{"reconstruction":"incomplete","explanation":"insufficient evidence"}'),
        textResponse("Bidirectional consensus: disputed"),
        toolCallResponse([{ id: "probe-1", name: "run_state_probe", arguments: { stateVariables: ["totalSupply"] } }]),
        textResponse(JSON.stringify({ validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED", confidence: "LOW", summary: "The probe does not resolve the claim.", reasoning: "The measured total supply changed, but the available evidence does not connect that change to the claimed unauthorized impact.", citesEvidence: [] })),
      ],
    })
    const result = await w.start("worker-a", runInput({ maxProbeRuns: 1 }))
    expect(result).toMatchObject({ kind: "committed", state: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
    expect(w.sandbox.stateProbeCalls).toHaveLength(1)
    expect(w.sanitizer.probeCalls).toHaveLength(1)
    expect((await world.events("tool.requested")).some((event) => event.payload.toolName === "run_state_probe")).toBe(true)
    expect(await world.state()).toBe("completed")
    await expectContiguous(world)
  })

  test("disputed witness typed evidence can resolve through normative snapshot citation synthesis", async () => {
    const world = createWorld()
    const claim = { targetContracts: ["Vault"], targetFunctions: ["withdraw"], rootCause: "external call before balance update", attackScenario: "re-enter withdraw", callerAssumptions: [], claimedImpact: "attacker balance exceeds deposit", claimedState: "balanceOf(attacker) grows" }
    const w = world.worker({
      ingestion: { kind: "ok", pocCode: "contract Test {}", claim, bceSlices: [] },
      sanitizerResult: { kind: "ok", stitchedTestFile: "contract Test {}", hasSubmitterAssertions: false, antiCheatReport: { rulesChecked: [], findings: [] } },
      stateProbe: { exitCode: 0, trace: "probe completed", stateDeltas: [{ variable: "balanceOf(attacker)", before: "0", after: "3 ether" }] },
      script: [
        textResponse("acknowledged"),
        textResponse('{"reachability":"incomplete","explanation":"The disputed payout magnitude requires measurement."}'),
        textResponse('{"reconstruction":"reconstructed","explanation":"The call ordering allows re-entry before the balance update."}'),
        textResponse("Bidirectional consensus: disputed"),
        toolCallResponse([{ id: "probe-valid", name: "run_state_probe", arguments: { stateVariables: ["balanceOf(attacker)"] } }]),
        textResponse(JSON.stringify({
          validity: "valid", verificationStatus: "PASS", reasonCode: "EXPLOIT_CONFIRMED", severity: "HIGH", confidence: "HIGH",
          summary: "The bounded witness measured the attacker balance growing during re-entry.",
          reasoning: "The exact targeted witness measured the attacker balance increasing from zero to three ether. The immutable source snapshot shows withdraw transfers to the caller before decrementing that caller's balance, permitting another withdrawal during the callback.",
          targetedCondition: "balanceOf(attacker)", observedBefore: "0", observedAfter: "3 ether",
          deltaExplanation: "The bounded probe measured a three-ether increase while the source performs the external transfer before reducing the caller balance, permitting repeated withdrawals.",
          citesEvidence: [{ filePath: "src/Vault.sol", startLine: 21, endLine: 25, explanation: "withdraw transfers before decrementing the caller balance" }],
        })),
      ],
    })
    const result = await w.start("worker-a", runInput({ maxProbeRuns: 1 }))
    expect(result).toMatchObject({ kind: "committed", state: "completed", verdict: { validity: "valid", verificationStatus: "PASS", citesEvidence: [{ filePath: "src/Vault.sol", startLine: 21, endLine: 25 }] } })
    expect(w.sandbox.stateProbeCalls).toHaveLength(1)
    expect((await world.events("tool.requested")).some((event) => event.payload.toolName === "run_state_probe")).toBe(true)
    expect(await world.state()).toBe("completed")
    await expectContiguous(world)
  })

  test("does not probe a target absent from the claim", async () => {
    const world = createWorld()
    const claim = { targetContracts: ["Vault"], targetFunctions: ["withdraw"], rootCause: "external call before balance update", attackScenario: "re-enter withdraw", callerAssumptions: [], claimedImpact: "attacker balance exceeds deposit", claimedState: "balanceOf(attacker) grows" }
    const w = world.worker({
      ingestion: { kind: "ok", pocCode: "contract Test {}", claim, bceSlices: [] },
      sanitizerResult: { kind: "ok", stitchedTestFile: "contract Test {}", hasSubmitterAssertions: false, antiCheatReport: { rulesChecked: [], findings: [] } },
      script: [textResponse("acknowledged"), textResponse('{"reachability":"incomplete","explanation":"insufficient evidence"}'), textResponse('{"reconstruction":"incomplete","explanation":"insufficient evidence"}'), textResponse("Bidirectional consensus: disputed"), toolCallResponse([{ id: "probe-unclaimed", name: "run_state_probe", arguments: { stateVariables: ["totalSupply"] } }]), textResponse('{"validity":"unverified","verificationStatus":"UNVERIFIED","reasonCode":"UNRESOLVED","confidence":"LOW","summary":"The claim remains unresolved.","reasoning":"The model requested a state expression that is absent from the claim, so no bounded witness was run.","citesEvidence":[]}')],
    })
    const result = await w.start()
    expect(result).toMatchObject({ kind: "committed", state: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
    expect(w.sandbox.stateProbeCalls).toHaveLength(0)
    expect(w.sanitizer.probeCalls).toHaveLength(0)
  })

  test("narrative-only claims missing targets fail closed without ordinary verdict", async () => {
    const world = createWorld()
    const claim = { targetContracts: [], targetFunctions: [], rootCause: "", attackScenario: "", callerAssumptions: [], claimedImpact: "", claimedState: "" }
    const w = world.worker({ ingestion: { kind: "narrative_only", claim, bceSlices: [] }, script: [verdictText] })
    const result = await w.start()
    expect(result).toMatchObject({ kind: "committed", state: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
    expect(w.gateway.callCount).toBe(0)
  })

  test("Task 3 inconclusive narrative claim commits UNVERIFIED through terminal CAS", async () => {
    const world = createWorld()
    const claim = { targetContracts: ["Vault"], targetFunctions: ["withdraw"], rootCause: "bad auth", attackScenario: "attacker calls", callerAssumptions: [], claimedImpact: "fund loss", claimedState: "balance reduced" }
    const w = world.worker({ ingestion: { kind: "narrative_only", claim, bceSlices: [] }, script: [
      textResponse("acknowledged"),
      textResponse('{"reachability":"incomplete","explanation":"insufficient evidence"}'),
      textResponse('{"reconstruction":"incomplete","explanation":"insufficient evidence"}'),
      textResponse('{"validity":"unverified","verificationStatus":"UNVERIFIED","reasonCode":"UNRESOLVED","confidence":"LOW","summary":"The disputed claim remains unresolved by the bounded evidence.","reasoning":"The available source and exploration do not establish reachability or reconstruct the claimed impact, so no semantic conclusion is supported.","citesEvidence":[]}'),
    ] })
    const result = await w.start()
    expect(result).toMatchObject({ kind: "committed", state: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
    expect(await world.events("run.completed")).toHaveLength(1)
    expect(await world.state()).toBe("completed")
    await expectContiguous(world)
  })

  test("Task 3 agreed-invalid narrative claim without BCE source is terminally UNVERIFIED", async () => {
    const world = createWorld()
    const claim = { targetContracts: ["Vault"], targetFunctions: ["withdraw"], rootCause: "bad auth", attackScenario: "attacker calls", callerAssumptions: [], claimedImpact: "fund loss", claimedState: "balance reduced" }
    const w = world.worker({ ingestion: { kind: "narrative_only", claim, bceSlices: [] }, script: [
      textResponse("acknowledged"),
      textResponse('{"reachability":"blocked","explanation":"guard"}'),
      textResponse('{"reconstruction":"blocked","explanation":"sink unreachable"}'),
    ] })
    const result = await w.start()
    expect(result).toMatchObject({ kind: "committed", state: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
    expect(await world.events("run.completed")).toHaveLength(1)
    expect(await world.state()).toBe("completed")
    await expectContiguous(world)
  })

  test("narrative-only report reaches semantic verification without PoC sanitation", async () => {
    const world = createWorld()
    const claim = { targetContracts: ["Vault"], targetFunctions: ["withdraw"], rootCause: "bad auth", attackScenario: "attacker calls", callerAssumptions: [], claimedImpact: "fund loss", claimedState: "balance reduced" }
    const w = world.worker({ ingestion: { kind: "narrative_only", claim, bceSlices: [] }, script: [verdictText] })
    await w.start()
    expect(w.gateway.callCount).toBeGreaterThan(0)
    expect(w.sanitizer.sanitizeCalls).toHaveLength(0)
    expect(w.gateway.calls[0].items.some((item) => item.content.includes("Claim decomposition"))).toBe(true)
  })

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

  /** Step 1 calls a tool; step 2 first compacts (one summary attempt), then gives the verdict. */
  const runCompacted = async () => {
    const world = createWorld()
    const engine = new ScriptedContextEngine([
      (input) => ({ status: "ready", preparedItems: input.items }),
      summarizeUnpinned,
    ])
    const summary = textResponse("Step 1 read Vault.sol lines 1-5: withdraw sends ether first.", {
      usage: usageOf(50, 10, 0.005),
    })
    const w = world.worker({ engine, script: [readVault("call-1", 1, 5), summary, verdictText] })
    return { world, w, result: await w.start() }
  }

  test("compaction succeeds: context.compacted persisted, its attempt counted in the totals, run continues", async () => {
    const { world, w, result } = await runCompacted()

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

  test("attempt identity: compaction and reasoning attempts of one step have distinct (step, purpose, attempt)", async () => {
    const { world, result } = await runCompacted()
    const attempts = (await world.events("provider.attempted")).map((event) =>
      EventPayloadSchemas["provider.attempted"].parse(event.payload),
    )
    const identities = attempts.map((attempt) => `${attempt.stepIndex}/${attempt.purpose}/${attempt.attemptIndex}`)
    expect(identities).toEqual(["1/reasoning/1", "2/compaction/1", "2/reasoning/1"])
    expect(attempts.reduce((sum, attempt) => sum + (attempt.usage?.totalTokens ?? 0), 0)).toBe(result.usage.totalTokens)
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

  test("partial initial context (no trace, no allocation): failed with persistence_failure and no model call", async () => {
    const world = createWorld({ leaseMs: 1_000 })
    const a = world.worker({ script: [verdictText] })
    world.store.failWhen(
      (event) =>
        event.type === "context.item_added" &&
        EventPayloadSchemas["context.item_added"].parse(event.payload).item.type === "candidate_finding",
      { sticky: true },
    )
    expect((await a.start("worker-a")).kind).toBe("error")
    world.store.heal()
    world.clock.advance(2_000)

    const b = world.worker({ script: [verdictText] })
    const result = await b.start("worker-b")
    expect(result).toMatchObject({ kind: "committed", state: "failed", terminalReason: "persistence_failure" })
    expect(a.gateway.callCount + b.gateway.callCount).toBe(0)
    expect(b.ingestion.calls).toHaveLength(0)
    expect(await world.events("run.failed")).toHaveLength(1)
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
  test("a durable cancellation request is observed before the next provider boundary", async () => {
    const world = createWorld()
    const w = world.worker({ script: [verdictText] })
    const result = await w.start()
    expect(result).toMatchObject({ kind: "committed", state: "completed" })

    const cancelledWorld = createWorld()
    const cancellation = cancelledWorld.cancellation
    const original = cancellation.isRequested.bind(cancellation)
    let polls = 0
    cancellation.isRequested = async (runId, signal) => {
      polls++
      return polls >= 4 || await original(runId, signal)
    }
    const cancelledWorker = cancelledWorld.worker({ script: [verdictText] })
    const cancelled = await cancelledWorker.start()
    expect(cancelled).toMatchObject({ kind: "committed", state: "cancelled" })
    expect(cancelledWorker.gateway.callCount).toBe(0)
    expect(await cancelledWorld.events("run.cancelled")).toHaveLength(1)
  })

  // Polls: 1 before ingestion, 2 before the sandbox, 3 before step 1's prepare, 4 after it, 5 before its tools,
  // 6 before step 2's prepare.
  test("cancel before the provider call of step 2: no attempt for step 2, cancelled, earlier events kept", async () => {
    const world = createWorld()
    world.cancellation.requestOnPoll(6)
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
    world.cancellation.requestOnPoll(5)
    const w = world.worker({ script: [readVault("call-1", 1, 5), verdictText] })
    const result = await w.start()

    expect(result).toMatchObject({ kind: "committed", state: "cancelled" })
    expect(w.registry.calls).toHaveLength(0)
    expect(await world.events("tool.requested")).toHaveLength(0)
    const [cancelled] = await world.events("run.cancelled")
    expect(cancelled.payload.boundary).toBe("before_tool_dispatch")
  })

  test("cancel requested while the engine prepares: no provider attempt for that step", async () => {
    const world = createWorld()
    // The poll before prepare has already passed when the request arrives.
    const engine = new ScriptedContextEngine([
      (input) => {
        world.cancellation.request(RunId)
        return { status: "ready", preparedItems: input.items }
      },
    ])
    const w = world.worker({ engine, script: [verdictText] })
    const result = await w.start()

    expect(result).toMatchObject({ kind: "committed", state: "cancelled" })
    expect(w.gateway.callCount).toBe(0)
    expect(await world.events("step.started")).toHaveLength(0)
    const [cancelled] = await world.events("run.cancelled")
    expect(cancelled.payload.boundary).toBe("before_provider_call")
  })
})

describe("JudgeRunner: never crashes the worker", () => {
  test("a stage port rejected by the wall-clock abort ends budget_exhausted(wall_clock), not failed", async () => {
    const world = createWorld()
    const deadlines: Array<() => void> = []
    const w = world.worker({
      setTimer: (_ms, fire) => {
        deadlines.push(fire)
        return () => {}
      },
      // The deadline passes while the sandbox runs; the scripted sandbox then rejects on the aborted signal.
      wrapSandbox: (sandbox) => ({
        runSingleShot: (input, signal) => {
          deadlines.forEach((fire) => fire())
          return sandbox.runSingleShot(input, signal)
        },
        runStateProbe: (input, signal) => sandbox.runStateProbe(input, signal),
      }),
    })
    const result = await w.start()

    expect(result).toMatchObject({ kind: "committed", state: "budget_exhausted", terminalReason: "wall_clock" })
    expect(await world.events("run.failed")).toHaveLength(0)
  })

  test("a gateway that rejects on its second attempt: the first attempt stays persisted and charged", async () => {
    const world = createWorld()
    const rateLimited = errorResponse(
      { isRetryable: true, category: "rate_limit", message: "HTTP 429", statusCode: 429 },
      { usage: usageOf(30, 0, 0.003) },
    )
    const w = world.worker({
      script: [rateLimited],
      wrapGateway: (gateway) => ({
        executeAttempt: (request, signal) =>
          request.attemptIndex === 1
            ? gateway.executeAttempt(request, signal)
            : Promise.reject(new Error("gateway adapter crashed")),
      }),
    })
    const result = await w.start()

    expect(result).toMatchObject({ kind: "committed", state: "failed", terminalReason: "worker_interrupted" })
    const attempts = await world.events("provider.attempted")
    expect(attempts.map((event) => event.payload.retryDecision)).toEqual(["retry"])
    expect(result.usage.totalTokens).toBe(30)
  })

  test("a tool registry exception becomes a fixed model-visible error and the run completes", async () => {
    const world = createWorld()
    const w = world.worker({ script: [readVault("call-1", 1, 5), verdictText] })
    w.registry.throwOn("read_file", "adapter exploded")
    const result = await w.start()

    expect(result).toMatchObject({ kind: "committed", state: "completed" })
    const toolResult = w.gateway.calls[1].items.find((item) => item.type === "tool_result")
    expect(toolResult?.toolMeta?.isError).toBe(true)
    expect(toolResult?.content).toContain("Tool execution failed (internal error). Retry or use a different path.")
  })

  test("a malformed claim makes construction fail: run resolves with an error result instead of throwing", async () => {
    const world = createWorld()
    const w = world.worker()
    const malformed = null as unknown as RunClaim
    const result = await w.runner.run(malformed, runInput())
    expect(result).toMatchObject({ kind: "error", runId: "unknown", lastStepIndex: 0 })
    expect(await world.state()).toBe("queued")
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
