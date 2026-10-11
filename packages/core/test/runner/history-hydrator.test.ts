import { describe, expect, test } from "bun:test"
import type { ContextItem } from "@harness/protocol"
import {
  InterruptedToolMessage,
  applyCompaction,
  hydrateHistory,
  interruptedToolItems,
  verifyHydration,
} from "../../src/runner/history-hydrator"
import { PassThroughContextEngine } from "../../src/testing/fake-context-engines"
import { textResponse, toolCallResponse, usageOf } from "../../src/testing/scripted-model-gateway"
import { createIdGenerator } from "../../src/util/id"
import { baseItems, createHarness, limits, policy, validVerdict } from "./judge-step-harness"

const readVault = (id: string, costUsd: number) =>
  toolCallResponse([{ id, name: "read_file", arguments: { path: "src/Vault.sol", startLine: 1, endLine: 5 } }], {
    usage: usageOf(120, 30, costUsd),
  })

const summary: ContextItem = {
  id: "itm-summary",
  turn: 1,
  type: "compaction_summary",
  isPinned: false,
  content: "Step 1 read src/Vault.sol lines 1-5: withdraw sends ether before updating balances.",
}

/** Two steps and one compaction, persisted as the runner persists them; `skipStepOneItems` loses step 1's items. */
const runTwoSteps = async (options: { skipStepOneItems?: boolean } = {}) => {
  const h = await createHarness({
    script: [readVault("call-1", 0.01), readVault("call-2", 0.02), textResponse(JSON.stringify(validVerdict))],
  })
  const persist = async (items: readonly ContextItem[]) => {
    for (const item of items) await h.sink.append("context.item_added", { item })
  }
  await persist(baseItems)
  const first = await h.step.execute(h.input({ stepIndex: 1, items: baseItems }))
  if (!options.skipStepOneItems) await persist(first.newItems)
  const replaced = first.newItems.filter((item) => item.type === "tool_request").map((item) => item.id)
  await h.sink.append("context.compacted", { replacedItemIds: replaced, summaryItem: summary, usage: usageOf(0, 0) })
  const beforeStepTwo = applyCompaction([...baseItems, ...first.newItems], replaced, summary)
  const second = await h.step.execute(h.input({ stepIndex: 2, items: beforeStepTwo }))
  await persist(second.newItems)
  return { h, first, second, items: [...beforeStepTwo, ...second.newItems] }
}

const modelLimits = { maxContextTokens: 128_000, maxOutputTokens: 4_000, safetyMarginFactor: 1.1 }

const verify = (history: Parameters<typeof verifyHydration>[0]["history"]) =>
  verifyHydration({ engine: new PassThroughContextEngine(), history, policy, modelLimits, limits })

describe("history hydrator", () => {
  test("round trip: persisted events hydrate to the same items, totals, step and compaction count", async () => {
    const { h, first, second, items } = await runTwoSteps()
    const hydration = hydrateHistory(await h.events())
    if (hydration.kind !== "hydrated") throw new Error(hydration.message)
    const { history } = hydration

    expect(history.items).toEqual(items)
    expect(history.stepIndex).toBe(2)
    expect(history.compactionsCount).toBe(1)
    expect(history.totalsFromAttempts.totalTokens).toBe(first.usage.totalTokens + second.usage.totalTokens)
    expect(history.totalsFromAttempts.costUsd).toBeCloseTo(0.03, 10)
    expect(history.pendingToolCalls).toEqual([])
    expect(history.terminalPending).toBeUndefined()
    expect(await verify(history)).toEqual({ kind: "verified" })
  })

  test("hydration mismatch: a lost item changes the digest: persistence_failure and no model call", async () => {
    const { h } = await runTwoSteps({ skipStepOneItems: true })
    const callsBefore = h.gateway.callCount
    const hydration = hydrateHistory(await h.events())
    if (hydration.kind !== "hydrated") throw new Error(hydration.message)

    const check = await verify(hydration.history)
    expect(check).toMatchObject({ kind: "mismatch", reason: "persistence_failure" })
    if (check.kind === "mismatch") expect(check.actualDigest).not.toBe(check.expectedDigest)
    expect(h.gateway.callCount).toBe(callsBefore)
  })

  test("tool intent survives a crash: a call without a result is reported as interrupted, not re-run", async () => {
    const h = await createHarness({ script: [] })
    for (const item of baseItems) await h.sink.append("context.item_added", { item })
    await h.sink.append("step.started", { stepIndex: 1, toolsDisabled: false })
    const args = { path: "src/Vault.sol" }
    await h.sink.append("tool.requested", { callIndex: 0, callId: "call-1", toolName: "read_file", arguments: args })

    const hydration = hydrateHistory(await h.events())
    if (hydration.kind !== "hydrated") throw new Error(hydration.message)
    const { pendingToolCalls } = hydration.history
    expect(pendingToolCalls).toEqual([
      { stepIndex: 1, callIndex: 0, callId: "call-1", toolName: "read_file", arguments: args, hasRequestItem: false },
    ])

    let tick = 0
    const ids = createIdGenerator({ clock: () => 1_000, random: (size) => new Uint8Array(size).fill(tick++) })
    const added = interruptedToolItems(pendingToolCalls, ids)
    expect(added.map((item) => item.type)).toEqual(["tool_request", "tool_result"])
    expect(added[1].content).toStartWith(InterruptedToolMessage)
    expect(added[1].toolMeta).toMatchObject({ callId: "call-1", toolName: "read_file", isError: true })
    expect(h.registry.calls).toHaveLength(0)
  })

  test("a terminal event without the terminal transition is reported as terminal-pending", async () => {
    const h = await createHarness({ script: [] })
    for (const item of baseItems) await h.sink.append("context.item_added", { item })
    await h.sink.append("run.failed", { reason: "persistence_failure", message: "store write failed" })

    const hydration = hydrateHistory(await h.events())
    if (hydration.kind !== "hydrated") throw new Error(hydration.message)
    expect(hydration.history.terminalPending).toMatchObject({
      type: "run.failed",
      payload: { reason: "persistence_failure" },
    })
  })
})
