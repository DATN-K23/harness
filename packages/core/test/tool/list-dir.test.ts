import { describe, expect, test } from "bun:test"
import { InMemorySnapshot } from "../../src/source/in-memory-snapshot"
import { handleListDir } from "../../src/tool/handlers/list-dir"

describe("handleListDir with SourceSnapshotPort", () => {
  const snapshot = new InMemorySnapshot({
    snapshotId: "snap-ld",
    files: {
      "src/A.sol": "contract A {}\n",
      "src/nested/B.sol": "contract B {}\n",
      "README.md": "# Docs\n",
    },
    deniedPrefixes: [],
  })

  test("lists root directory entries", async () => {
    const res = await handleListDir({}, { snapshot, snapshotId: "snap-ld", deniedPrefixes: [] })
    expect(res.isError).toBe(false)
    expect(res.content.split("\n")).toEqual(["README.md", "src/"])
  })

  test("lists sub-directory entries", async () => {
    const res = await handleListDir({ path: "src" }, { snapshot, snapshotId: "snap-ld", deniedPrefixes: [] })
    expect(res.isError).toBe(false)
    expect(res.content.split("\n")).toEqual(["A.sol", "nested/"])
  })

  test("returns error for non-existent directory", async () => {
    const res = await handleListDir({ path: "unknown" }, { snapshot, snapshotId: "snap-ld", deniedPrefixes: [] })
    expect(res.isError).toBe(true)
    expect(res.content).toContain("Directory not found")
  })
})
