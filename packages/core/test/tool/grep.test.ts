import { describe, expect, test } from "bun:test"
import { InMemorySnapshot } from "../../src/source/in-memory-snapshot"
import { handleGrep } from "../../src/tool/handlers/grep"

describe("handleGrep with SourceSnapshotPort", () => {
  const snapshot = new InMemorySnapshot({
    snapshotId: "snap-gp",
    files: {
      "src/A.sol": "contract A {\n  uint256 x;\n}\n",
      "src/B.sol": "contract B {\n  uint256 y;\n}\n",
    },
    deniedPrefixes: [],
  })

  test("finds matching lines across snapshot", async () => {
    const res = await handleGrep({ pattern: "uint256" }, { snapshot, snapshotId: "snap-gp", deniedPrefixes: [] })
    expect(res.isError).toBe(false)
    expect(res.content.split("\n")).toEqual([
      "src/A.sol:2:   uint256 x;",
      "src/B.sol:2:   uint256 y;",
    ])
  })

  test("returns error for invalid regex", async () => {
    const res = await handleGrep({ pattern: "[unclosed" }, { snapshot, snapshotId: "snap-gp", deniedPrefixes: [] })
    expect(res.isError).toBe(true)
    expect(res.content).toContain("Invalid regular expression")
  })

  test("returns a bounded error when the worker exceeds its timeout", async () => {
    const res = await handleGrep(
      { pattern: "uint256" },
      { snapshot, snapshotId: "snap-gp", deniedPrefixes: [], timeoutMs: 1 },
    )
    expect(res.isError).toBe(true)
    expect(res.content).toContain("grep timed out")
  })

  test("rejects with the caller abort reason when aborted during worker execution", async () => {
    const controller = new AbortController()
    const execution = handleGrep(
      { pattern: "uint256" },
      { snapshot, snapshotId: "snap-gp", deniedPrefixes: [], timeoutMs: 1000 },
      controller.signal,
    )
    setTimeout(() => controller.abort(new Error("cancelled by test")), 1)
    await expect(execution).rejects.toThrow("cancelled by test")
  })
})
