import { describe, expect, test } from "bun:test"
import { textResponse, toolCallResponse } from "../../src/testing/scripted-model-gateway"
import { invalidVerdict } from "./judge-step-harness"
import { baseItems, createHarness } from "./judge-step-harness"

describe("JudgeStep bounded witness resolution", () => {
  test("dispatches one registered bounded state probe for disputed consensus", async () => {
    const h = await createHarness({ script: [toolCallResponse([{ id: "probe", name: "run_state_probe", arguments: { stateVariables: ["totalSupply"] } }])] })
    let probeCalls = 0
    const tools = {
      definitions: () => [{ name: "run_state_probe", description: "existing bounded probe", parameters: {} }],
      execute: async () => {
        probeCalls += 1
        return { content: "State probe run 1 of 1 (exit code 0): totalSupply | 100 | 100", isError: false }
      },
    }
    const result = await h.step.execute(h.input({
      items: [...baseItems, { id: "consensus", turn: 2, type: "assistant_reasoning", isPinned: false, content: "Bidirectional consensus: disputed" }],
      tools,
    }))
    expect(result.outcome.type).toBe("continue_turn")
    expect(probeCalls).toBe(1)
    expect(result.newItems.some((item) => item.type === "tool_result" && item.content.includes("totalSupply | 100 | 100"))).toBe(true)
  })

  test("does not dispatch a second probe after a prior request/result", async () => {
    const h = await createHarness({ script: [textResponse(JSON.stringify(invalidVerdict))] })
    let probeCalls = 0
    const tools = {
      definitions: () => [{ name: "run_state_probe", description: "bounded", parameters: {} }],
      execute: async () => { probeCalls += 1; return { content: "unused", isError: false } },
    }
    const result = await h.step.execute(h.input({
      items: [
        ...baseItems,
        { id: "consensus", turn: 2, type: "assistant_reasoning", isPinned: false, content: "Bidirectional consensus: disputed" },
        { id: "probe-request", turn: 2, type: "tool_request", isPinned: false, content: JSON.stringify({ name: "run_state_probe", arguments: { stateVariables: ["totalSupply"] } }), toolMeta: { callId: "prior", toolName: "run_state_probe" } },
        { id: "probe-result", turn: 2, type: "tool_result", isPinned: false, content: "State probe run 1 of 1 (exit code 0): totalSupply | 1 | 1", toolMeta: { callId: "prior", toolName: "run_state_probe", isError: false } },
      ],
      tools,
    }))
    expect(probeCalls).toBe(0)
    expect(result.outcome.type).toBe("completed")
  })

  test("probe invocation bound exhaustion terminates UNVERIFIED", async () => {
    const h = await createHarness({ script: [toolCallResponse([{ id: "probe", name: "run_state_probe", arguments: { stateVariables: ["totalSupply"] } }]), textResponse(JSON.stringify(invalidVerdict))] })
    let probeCalls = 0
    const tools = {
      definitions: () => [{ name: "run_state_probe", description: "bounded", parameters: {} }],
      execute: async () => { probeCalls += 1; return { content: "run_state_probe was not run: the limit of 1 state probe runs for this adjudication is reached.", isError: true } },
    }
    const result = await h.step.execute(h.input({
      items: [
        ...baseItems,
        { id: "consensus", turn: 2, type: "assistant_reasoning", isPinned: false, content: "Bidirectional consensus: disputed" },
      ],
      tools,
    }))
    expect(result.outcome.type).toBe("continue_turn")
    expect(probeCalls).toBe(1)
    const terminal = await h.step.execute(h.input({ items: [
      ...baseItems,
      { id: "consensus", turn: 2, type: "assistant_reasoning", isPinned: false, content: "Bidirectional consensus: disputed" },
      ...result.newItems,
    ], tools }))
    expect(terminal.outcome).toMatchObject({ type: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
    expect(probeCalls).toBe(1)
  })

  test("probe execution error terminates UNVERIFIED", async () => {
    const h = await createHarness({ script: [toolCallResponse([{ id: "probe", name: "run_state_probe", arguments: { stateVariables: ["totalSupply"] } }]), textResponse(JSON.stringify(invalidVerdict))] })
    const tools = {
      definitions: () => [{ name: "run_state_probe", description: "bounded", parameters: {} }],
      execute: async () => ({ content: "compile failed", isError: true }),
    }
    const result = await h.step.execute(h.input({
      items: [...baseItems, { id: "consensus", turn: 2, type: "assistant_reasoning", isPinned: false, content: "Bidirectional consensus: disputed" }],
      tools,
    }))
    expect(result.outcome.type).toBe("continue_turn")
    const persistedProbe = result.newItems.find((item) => item.type === "tool_result")
    expect(persistedProbe?.toolMeta?.isError).toBe(true)
    const next = await h.step.execute(h.input({ items: [...baseItems, ...result.newItems, { id: "consensus", turn: 2, type: "assistant_reasoning", isPinned: false, content: "Bidirectional consensus: disputed" }] }))
    expect(next.outcome).toMatchObject({ type: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
  })

  test("successful process exit without targeted condition resolution is UNRESOLVED", async () => {
    const h = await createHarness({ script: [textResponse(JSON.stringify(invalidVerdict))] })
    const tools = {
      definitions: () => [{ name: "run_state_probe", description: "bounded", parameters: {} }],
      execute: async () => ({ content: "unused", isError: false }),
    }
    const result = await h.step.execute(h.input({
      items: [
        ...baseItems,
        { id: "consensus", turn: 2, type: "assistant_reasoning", isPinned: false, content: "Bidirectional consensus: disputed" },
        { id: "probe-request", turn: 2, type: "tool_request", isPinned: false, content: JSON.stringify({ name: "run_state_probe", arguments: { stateVariables: ["totalSupply"] } }), toolMeta: { callId: "prior", toolName: "run_state_probe" } },
        { id: "probe-result", turn: 2, type: "tool_result", isPinned: false, content: "State probe run 1 of 1 (exit code 0): totalSupply | 100 | 100", toolMeta: { callId: "prior", toolName: "run_state_probe", isError: false } },
      ],
      tools,
    }))
    expect(result.outcome).toMatchObject({ type: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
  })

  test("probe target and condition without an exact observed delta terminate UNRESOLVED", async () => {
    const h = await createHarness({ script: [textResponse(JSON.stringify({
      ...invalidVerdict,
      targetedCondition: "totalSupply",
      observedBefore: "1",
      observedAfter: "2",
      deltaExplanation: "The value remained constant.",
    }))] })
    const result = await h.step.execute(h.input({ items: [
      ...baseItems,
      { id: "consensus", turn: 2, type: "assistant_reasoning", isPinned: false, content: "Bidirectional consensus: disputed" },
      { id: "probe-request", turn: 2, type: "tool_request", isPinned: false, content: JSON.stringify({ name: "run_state_probe", arguments: { stateVariables: ["totalSupply"] } }), toolMeta: { callId: "prior", toolName: "run_state_probe" } },
      { id: "probe-result", turn: 2, type: "tool_result", isPinned: false, content: "State probe run 1 of 1 (exit code 0). State delta, post minus pre:\n| variable | before | after |\n| --- | --- | --- |\n| totalSupply | 1 | 2 |", toolMeta: { callId: "prior", toolName: "run_state_probe", isError: false } },
    ], probeEvidence: new Map([["totalSupply", { before: "1", after: "3" }]]) }))
    expect(result.outcome).toMatchObject({ type: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
  })

  test("a matching typed witness and snapshot citation can complete a valid disputed verdict", async () => {
    const h = await createHarness({ script: [textResponse(JSON.stringify({
      validity: "valid", verificationStatus: "PASS", reasonCode: "EXPLOIT_CONFIRMED", severity: "HIGH", confidence: "HIGH",
      summary: "The witness confirms the attacker balance increased during re-entry.",
      reasoning: "The typed witness measured the named balance rising while the source performs the external call before the balance update.",
      targetedCondition: "totalSupply", observedBefore: "1", observedAfter: "2",
      deltaExplanation: "The value increased by one during the bounded probe, matching the claimed state change in this scenario.",
      citesEvidence: [{ filePath: "src/Vault.sol", startLine: 1, endLine: 2, explanation: "the source lines establish the relevant state behavior" }],
    }))] })
    const result = await h.step.execute(h.input({ items: [
      ...baseItems.map((item) => item.id === "itm-finding"
        ? { ...item, content: `Claim decomposition\n${JSON.stringify({ claimedState: "totalSupply changes", claimedImpact: "attacker balance increases" })}` }
        : item),
      { id: "consensus", turn: 2, type: "assistant_reasoning", isPinned: false, content: "Bidirectional consensus: disputed" },
      { id: "probe-request", turn: 2, type: "tool_request", isPinned: false, content: JSON.stringify({ name: "run_state_probe", arguments: { stateVariables: ["totalSupply"] } }), toolMeta: { callId: "prior", toolName: "run_state_probe" } },
      { id: "probe-result", turn: 2, type: "tool_result", isPinned: false, content: "State probe run 1 of 1 (exit code 0). State delta, post minus pre:\n| variable | before | after |\n| --- | --- | --- |\n| totalSupply | 1 | 2 |", toolMeta: { callId: "prior", toolName: "run_state_probe", isError: false } },
    ], probeEvidence: new Map([["totalSupply", { before: "1", after: "2" }]]) }))
    expect(result.outcome).toMatchObject({ type: "completed", verdict: { validity: "valid", verificationStatus: "PASS", citesEvidence: [{ filePath: "src/Vault.sol", startLine: 1, endLine: 2 }] } })
  })

  test("unrelated BCE slice cannot synthesize an agreed-invalid verdict", async () => {
    const h = await createHarness({ script: [textResponse(JSON.stringify({
      validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED", confidence: "LOW",
      summary: "The unrelated source slice cannot resolve this blocker.",
      reasoning: "No cited statement in this source slice demonstrates the alleged blocker or disproves the specific claimed impact, so the result remains unverified.",
      citesEvidence: [],
    }))] })
    const unrelated = { id: "unrelated-bce", turn: 0, type: "bce_sliced_ast" as const, isPinned: true, content: "src/Vault.sol (lines 1-2)\ncontract Vault {}\n// unrelated" }
    const result = await h.step.execute(h.input({ items: [
      ...baseItems,
      unrelated,
      { id: "consensus", turn: 2, type: "assistant_reasoning", isPinned: false, content: "Bidirectional consensus: agreed-invalid" },
    ] }))
    expect(result.outcome).toMatchObject({ type: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
  })
})
