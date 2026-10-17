import { describe, expect, test } from "bun:test"
import type { ToolCall } from "@harness/protocol"
import { InMemorySnapshot } from "../../src/source/in-memory-snapshot"
import { ToolRegistry } from "../../src/tool/registry"

const call = (toolName: string, args: Record<string, unknown>): ToolCall => ({
  runId: "run-trunc",
  callId: "call-1",
  toolName,
  arguments: args,
})

describe("Tool Output Truncation", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`)
  const snapshot = new InMemorySnapshot({
    snapshotId: "snap-tr",
    files: {
      "src/Big.txt": `${lines.join("\n")}\n`,
    },
    deniedPrefixes: [],
  })

  test("read_file truncates when exceeding maxReadLines", async () => {
    const registry = new ToolRegistry({
      snapshot,
      snapshotId: "snap-tr",
      maxReadLines: 10,
    })
    const res = await registry.execute(call("read_file", { path: "src/Big.txt", startLine: 1, endLine: 30 }))
    expect(res.isError).toBe(false)
    expect(res.content).toContain("[Output truncated.")
    expect(res.lineRange).toEqual([1, 10])
  })

  test("grep truncates when exceeding maxGrepMatches", async () => {
    const registry = new ToolRegistry({
      snapshot,
      snapshotId: "snap-tr",
      maxGrepMatches: 5,
    })
    const res = await registry.execute(call("grep", { pattern: "line" }))
    expect(res.isError).toBe(false)
    expect(res.content).toContain("[Output truncated. Showing first 5 matches.")
    const matchLines = res.content.split("\n").filter((l) => l.startsWith("src/Big.txt"))
    expect(matchLines.length).toBe(5)
  })
})
