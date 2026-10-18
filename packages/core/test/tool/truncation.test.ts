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

  test("marks the default 2,000-line bound and reports the returned range", async () => {
    const content = Array.from({ length: 3000 }, (_, index) => "line " + (index + 1)).join("\n")
    const registry = new ToolRegistry({ files: { "src/long.txt": content } })

    const result = await registry.execute(call("read_file", { path: "src/long.txt" }))

    expect(result.isError).toBe(false)
    expect(result.lineRange).toEqual([1, 2000])
    expect(result.isTruncated).toBe(true)
    expect(result.content).toContain("[Output truncated.")
    expect(result.content.split("\n").filter((line) => line.startsWith("line ")).length).toBe(2000)
  })

  test("reports the actual line range after the byte bound cuts later lines", async () => {
    const registry = new ToolRegistry({
      files: { "src/bytes.txt": "one\ntwo-two\nthree\n" },
      maxReadBytes: 6,
    })

    const result = await registry.execute(call("read_file", { path: "src/bytes.txt" }))

    expect(result.isTruncated).toBe(true)
    expect(result.lineRange).toEqual([1, 1])
    expect(result.content).toBe("one\n[Output truncated. File has more lines or exceeds size limit. Specify a narrower line range.]")
  })

  test("uses separate glob and grep match limits", async () => {
    const registry = new ToolRegistry({
      files: {
        "a.txt": "match one",
        "b.txt": "match two",
        "c.txt": "match three",
      },
      maxGlobMatches: 1,
      maxGrepMatches: 2,
    })

    const glob = await registry.execute(call("glob", { pattern: "*.txt" }))
    const grep = await registry.execute(call("grep", { pattern: "match" }))

    expect(glob.content).toContain("[Output truncated. Showing first 1 matches")
    expect(grep.content).toContain("[Output truncated. Showing first 2 matches.")
    expect(grep.content.split("\n").filter((line) => /\.txt:\d+:/.test(line))).toHaveLength(2)
  })

  test("marks grep scan-byte and matched-line bounds as truncation", async () => {
    const scanRegistry = new ToolRegistry({
      files: { "src/large.txt": "a line that is too long to scan" },
      maxGrepScanBytes: 2,
    })
    const scanResult = await scanRegistry.execute(call("grep", { pattern: "missing" }))
    expect(scanResult.isTruncated).toBe(true)

    const lineRegistry = new ToolRegistry({
      files: { "src/line.txt": "matched line content" },
      maxGrepLineChars: 15,
    })
    const lineResult = await lineRegistry.execute(call("grep", { pattern: "matched" }))
    expect(lineResult.isTruncated).toBe(true)
    expect(lineResult.content).toContain("... [cut]")
  })

  test("times out catastrophic grep patterns in the worker", async () => {
    const snapshot = new InMemorySnapshot({
      snapshotId: "snap-redos",
      files: { "src/redos.txt": Array.from({ length: 40 }, () => "a").join("") + "!" },
    })
    // JavaScriptCore aborts this pattern quickly on its own, so a 1 ms limit forces the worker timeout path.
    const registry = new ToolRegistry({ snapshot, snapshotId: "snap-redos", grepTimeoutMs: 1 })
    const startedAt = Date.now()

    const result = await registry.execute(call("grep", { pattern: "^(a+)+$" }))

    expect(Date.now() - startedAt).toBeLessThanOrEqual(3000)
    expect(result.isError).toBe(true)
    expect(result.content).toBe("grep timed out after 1 ms; use a more specific pattern or path.")
  })
})
