import { describe, expect, test } from "bun:test"
import type { ModelToolCall } from "@harness/protocol"
import { toolCallResponse } from "../../src/testing/scripted-model-gateway"
import { createHarness, files } from "./judge-step-harness"

const call = (id: string, name: string, args: Record<string, unknown>): ModelToolCall => ({ id, name, arguments: args })

describe("JudgeStep: tool branch", () => {
  test("results become tool_request and tool_result items with tool metadata, in call order", async () => {
    const calls = [
      call("c0", "read_file", { path: "src/Vault.sol", startLine: 1, endLine: 2 }),
      call("c1", "list_dir", {}),
    ]
    const h = await createHarness({ script: [toolCallResponse(calls)] })
    const result = await h.step.execute(h.input({ stepIndex: 2 }))
    expect(result.outcome.type === "continue_turn" && result.outcome.toolOutcomes.map((o) => o.callId)).toEqual([
      "c0",
      "c1",
    ])
    expect(result.newItems.map((item) => [item.type, item.toolMeta?.callId])).toEqual([
      ["tool_request", "c0"],
      ["tool_request", "c1"],
      ["tool_result", "c0"],
      ["tool_result", "c1"],
    ])
    const vault = result.newItems[2]
    expect(vault).toMatchObject({
      turn: 2,
      toolMeta: { toolName: "read_file", filePath: "src/Vault.sol", lineRange: [1, 2], isError: false },
    })
    const completed = await h.events("tool.completed")
    expect(completed.map((event) => event.payload.itemId)).toEqual([result.newItems[2].id, result.newItems[3].id])
  })

  test("missing file: an error result names the path, suggests how to search, and the run continues", async () => {
    const h = await createHarness({
      script: [toolCallResponse([call("c0", "read_file", { path: "src/Gone.sol" })]), toolCallResponse([])],
    })
    const result = await h.step.execute(h.input())
    expect(result.outcome.type).toBe("continue_turn")
    const error = result.newItems.find((item) => item.type === "tool_result")
    expect(error?.toolMeta?.isError).toBe(true)
    expect(error?.content).toContain("src/Gone.sol")
    expect(error?.content).toMatch(/list_dir|glob/)
    expect(await h.events("tool.failed")).toHaveLength(1)
  })

  test("denied path: security.blocked with a rule id and a refusal without the prohibited content", async () => {
    const script = [toolCallResponse([call("c0", "read_file", { path: "secrets/key.txt" })])]
    const h = await createHarness({ script })
    const result = await h.step.execute(h.input())
    const [blocked] = await h.events("security.blocked")
    expect(blocked.payload).toMatchObject({ ruleId: "snapshot.path_denied", input: "secrets/key.txt" })
    const refusal = result.newItems.find((item) => item.type === "tool_result")
    expect(refusal?.content).toContain("Access denied")
    expect(refusal?.content).not.toContain("hunter2")
  })

  test("filter before shape: a secret in the region shaping would cut never reaches the shaping call or the context", async () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456"
    const long = Array.from({ length: 80 }, (_, index) => (index === 70 ? `key = ${secret}` : `row ${index + 1}`))
    const h = await createHarness({
      script: [toolCallResponse([call("c0", "read_file", { path: "logs/out.txt" })])],
      files: { ...files, "logs/out.txt": `${long.join("\n")}\n` },
    })
    const result = await h.step.execute(h.input())
    const filter = h.log.findIndex((entry) => entry.port === "filter")
    const shape = h.log.findIndex((entry) => entry.port === "shape")
    expect(filter).toBeLessThan(shape)
    expect(h.log[filter]).toMatchObject({ content: expect.stringContaining(secret) })
    expect(h.log[shape]).toMatchObject({ content: expect.not.stringContaining(secret) })
    const item = result.newItems.find((entry) => entry.type === "tool_result")
    expect(item?.content).not.toContain(secret)
    expect(item?.content).toContain("[truncated read_file output")
    expect(JSON.stringify(await h.events())).not.toContain(secret)
  })

  test("a tool error message is filtered before it is stored in tool.failed", async () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456"
    const h = await createHarness({ script: [toolCallResponse([call("c0", "grep", { pattern: "x" })])] })
    h.registry.failTool("grep", `backend refused with key ${secret}`)
    await h.step.execute(h.input())
    const [failed] = await h.events("tool.failed")
    expect(failed.payload.message).not.toContain(secret)
    expect(failed.payload.message).toContain("[REDACTED]")
  })

  test("parallel and sequential dispatch produce identical event payload digests", async () => {
    const calls = [
      call("c0", "read_file", { path: "src/Vault.sol" }),
      call("c1", "read_file", { path: "src/Gone.sol" }),
      call("c2", "grep", { pattern: "line 1" }),
    ]
    const digests = async (enableParallelToolDispatch: boolean) => {
      const h = await createHarness({ script: [toolCallResponse(calls)], flags: { enableParallelToolDispatch } })
      await h.step.execute(h.input())
      return (await h.events()).map((event) => [event.type, event.payloadDigest])
    }
    expect(await digests(true)).toEqual(await digests(false))
  })

  test("a cancel before tool dispatch runs no tool", async () => {
    const h = await createHarness({ script: [toolCallResponse([call("c0", "list_dir", {})])] })
    h.cancellation.requestOnPoll(1)
    const result = await h.step.execute(h.input())
    expect(result.cancelledAt).toBe("before_tool_dispatch")
    expect(h.registry.calls).toHaveLength(0)
    expect(await h.events("tool.requested")).toHaveLength(0)
  })
})
