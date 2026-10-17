import { describe, expect, test } from "bun:test"
import { InMemorySnapshot } from "../../src/source/in-memory-snapshot"
import { handleGlob } from "../../src/tool/handlers/glob"

describe("handleGlob with SourceSnapshotPort", () => {
  const snapshot = new InMemorySnapshot({
    snapshotId: "snap-gb",
    files: {
      "src/A.sol": "contract A {}\n",
      "src/nested/B.sol": "contract B {}\n",
      "test/A.t.sol": "contract AT is Test {}\n",
      "package.json": "{}\n",
    },
    deniedPrefixes: [],
  })

  test("matches glob pattern recursively", async () => {
    const res = await handleGlob({ pattern: "**/*.sol" }, { snapshot, snapshotId: "snap-gb", deniedPrefixes: [] })
    expect(res.isError).toBe(false)
    expect(res.content.split("\n")).toEqual(["src/A.sol", "src/nested/B.sol", "test/A.t.sol"])
  })

  test("returns message when no files match", async () => {
    const res = await handleGlob({ pattern: "**/*.rs" }, { snapshot, snapshotId: "snap-gb", deniedPrefixes: [] })
    expect(res.isError).toBe(false)
    expect(res.content).toBe('No files match "**/*.rs".')
  })
})
