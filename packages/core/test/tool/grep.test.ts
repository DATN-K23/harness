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
})
