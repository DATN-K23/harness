import { describe, expect, test } from "bun:test"
import { InMemorySnapshot } from "../../src/source/in-memory-snapshot"
import { handleReadFile } from "../../src/tool/handlers/read-file"

describe("handleReadFile with SourceSnapshotPort", () => {
  const snapshot = new InMemorySnapshot({
    snapshotId: "snap-rf",
    files: {
      "contracts/Simple.sol": "line1\nline2\nline3\nline4\nline5\n",
    },
    deniedPrefixes: ["secrets"],
  })

  test("reads valid line range", async () => {
    const res = await handleReadFile(
      { path: "contracts/Simple.sol", startLine: 2, endLine: 4 },
      { snapshot, snapshotId: "snap-rf", deniedPrefixes: [] },
    )
    expect(res.isError).toBe(false)
    expect(res.content).toBe("line2\nline3\nline4")
    expect(res.lineRange).toEqual([2, 4])
  })

  test("rejects invalid arguments (non-integer, out of order)", async () => {
    const res1 = await handleReadFile(
      { path: "contracts/Simple.sol", startLine: "2" },
      { snapshot, snapshotId: "snap-rf", deniedPrefixes: [] },
    )
    expect(res1.isError).toBe(true)
    expect(res1.content).toContain("Invalid arguments")

    const res2 = await handleReadFile(
      { path: "contracts/Simple.sol", startLine: 5, endLine: 2 },
      { snapshot, snapshotId: "snap-rf", deniedPrefixes: [] },
    )
    expect(res2.isError).toBe(true)
    expect(res2.content).toContain("endLine must not be before startLine")
  })

  test("rejects path outside allowed snapshot", async () => {
    const res = await handleReadFile(
      { path: "../outside.txt" },
      { snapshot, snapshotId: "snap-rf", deniedPrefixes: [] },
    )
    expect(res.isError).toBe(true)
    expect(res.content).toContain("Access denied")
  })

  test("returns file not found for non-existent path", async () => {
    const res = await handleReadFile(
      { path: "missing.sol" },
      { snapshot, snapshotId: "snap-rf", deniedPrefixes: [] },
    )
    expect(res.isError).toBe(true)
    expect(res.content).toContain("File not found")
  })
})
