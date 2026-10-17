import { describe, expect, test } from "bun:test"
import type { ToolCall } from "@harness/protocol"
import { InMemorySnapshot } from "../../src/source/in-memory-snapshot"
import { ToolRegistry } from "../../src/tool/registry"

const call = (toolName: string, args: Record<string, unknown>): ToolCall => ({
  runId: "run-err",
  callId: "call-1",
  toolName,
  arguments: args,
})

describe("Tool Non-Throwing Error Normalization", () => {
  const snapshot = new InMemorySnapshot({
    snapshotId: "snap-err",
    files: {
      "src/Test.sol": "contract Test {}\n",
    },
    deniedPrefixes: ["secrets"],
  })

  const registry = new ToolRegistry({
    snapshot,
    snapshotId: "snap-err",
    deniedPrefixes: ["secrets"],
  })

  test("unknown tool returns structured isError: true without throwing", async () => {
    const res = await registry.execute(call("non_existent_tool", {}))
    expect(res.isError).toBe(true)
    expect(res.content).toContain('Unknown tool "non_existent_tool"')
  })

  test("path traversal returns structured isError: true without throwing", async () => {
    const res = await registry.execute(call("read_file", { path: "../../etc/passwd" }))
    expect(res.isError).toBe(true)
    expect(res.content).toContain("Access denied")
  })

  test("invalid grep regex returns structured isError: true without throwing", async () => {
    const res = await registry.execute(call("grep", { pattern: "[a-z" }))
    expect(res.isError).toBe(true)
    expect(res.content).toContain("Invalid regular expression")
  })

  test("missing file returns structured isError: true without throwing", async () => {
    const res = await registry.execute(call("read_file", { path: "src/Missing.sol" }))
    expect(res.isError).toBe(true)
    expect(res.content).toContain("File not found")
  })
})
