import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, test } from "bun:test"
import type { SourceSnapshotPort, ToolCall } from "@harness/protocol"
import { DiskSourceSnapshot } from "../../src/source/disk-source-snapshot"
import { InvalidSnapshotIdError, SnapshotIntegrityError } from "../../src/source/snapshot-errors"
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
    expect(res.content).not.toContain("../../etc/passwd")
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

  test("missing snapshot errors identify the snapshot without exposing its storage path", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-tool-missing-snapshot-"))
    try {
      const missingSnapshot = new DiskSourceSnapshot({
        storageDir: path.join(tempDir, "storage"),
        snapshotId: "snap-missing",
      })
      const missingRegistry = new ToolRegistry({ snapshot: missingSnapshot, snapshotId: "snap-missing" })
      const result = await missingRegistry.execute(call("read_file", { path: "src/File.sol" }))

      expect(result.isError).toBe(true)
      expect(result.content).toBe('Snapshot "snap-missing" not found.')
      expect(result.content.includes(":\\")).toBe(false)
      expect(result.content.startsWith("/")).toBe(false)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  test("unexpected errors use the fixed path-free generic message", async () => {
    const errorRegistry = new ToolRegistry({ files: { "src/File.sol": "content" } })
    errorRegistry.throwOn("read_file", new Error("failed at C:\\Users\\private\\file"))
    const result = await errorRegistry.execute(call("read_file", { path: "src/File.sol" }))

    expect(result).toEqual({
      content: "Tool execution failed (internal error). Retry or use a different path.",
      isError: true,
    })
  })

  test("snapshot integrity errors expose only the relative file path", async () => {
    const brokenSnapshot: SourceSnapshotPort = {
      readLines: async () => {
        throw new SnapshotIntegrityError("src/Token.sol")
      },
      listFiles: async () => [],
    }
    const integrityRegistry = new ToolRegistry({ snapshot: brokenSnapshot, snapshotId: "snap-integrity" })
    const result = await integrityRegistry.execute(call("read_file", { path: "src/Token.sol" }))

    expect(result.content).toBe('Snapshot integrity check failed for "src/Token.sol".')
    expect(result.content.includes(":\\")).toBe(false)
    expect(result.content.startsWith("/")).toBe(false)
  })

  test("invalid snapshot ID errors expose only the ID", async () => {
    const invalidSnapshot: SourceSnapshotPort = {
      readLines: async () => {
        throw new InvalidSnapshotIdError("bad-id")
      },
      listFiles: async () => [],
    }
    const invalidRegistry = new ToolRegistry({ snapshot: invalidSnapshot, snapshotId: "bad-id" })
    const result = await invalidRegistry.execute(call("read_file", { path: "src/Token.sol" }))

    expect(result.content).toBe('Invalid snapshot ID "bad-id".')
  })
})
