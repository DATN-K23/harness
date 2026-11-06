import { describe, expect, test } from "bun:test"
import { InMemorySnapshot } from "../../src/testing/in-memory-snapshot"

const files = {
  "src/Vault.sol": "line 1\nline 2\nline 3\nline 4\n",
  "src/lib/Math.sol": "library Math {}\n",
  "README.md": "# readme",
  "vendor/secret.txt": "hidden\n",
  "empty.txt": "",
}

const snapshot = () => new InMemorySnapshot({ snapshotId: "snap-1", files, deniedPrefixes: ["vendor"] })
const read = (path: string, startLine = 1, endLine = 1, snapshotId = "snap-1") =>
  snapshot().readLines({ snapshotId, path, startLine, endLine })

describe("InMemorySnapshot.readLines", () => {
  test("returns an inclusive 1-based span", async () => {
    expect(await read("src/Vault.sol", 2, 3)).toEqual({ kind: "ok", lines: ["line 2", "line 3"] })
    expect(await read("src/Vault.sol", 1, 4)).toEqual({ kind: "ok", lines: ["line 1", "line 2", "line 3", "line 4"] })
    expect(await read("README.md", 1, 1)).toEqual({ kind: "ok", lines: ["# readme"] })
  })

  test("a trailing newline does not make a phantom last line", async () => {
    expect(await read("src/Vault.sol", 5, 5)).toEqual({ kind: "out_of_range", lineCount: 4 })
  })

  test.each([
    ["past the end", 3, 9],
    ["starts past the end", 6, 7],
    ["starts at zero", 0, 2],
    ["negative start", -1, 2],
    ["reversed", 3, 2],
    ["fractional", 1.5, 2],
  ])("a span that is %s is out_of_range with the real line count", async (_name, startLine, endLine) => {
    expect(await read("src/Vault.sol", startLine, endLine)).toEqual({ kind: "out_of_range", lineCount: 4 })
  })

  test("an empty file has no readable line", async () => {
    expect(await read("empty.txt", 1, 1)).toEqual({ kind: "out_of_range", lineCount: 0 })
  })

  test.each([
    ["a missing file", "src/Nope.sol"],
    ["an absolute path", "/etc/passwd"],
    ["a windows path", "C:\\Windows\\win.ini"],
    ["a parent segment", "src/../README.md"],
    ["a leading parent segment", "../README.md"],
    ["a denied prefix", "vendor/secret.txt"],
    ["a denied prefix spelled with ./", "./vendor/secret.txt"],
    ["a directory", "src"],
  ])("%s resolves as not_found", async (_name, path) => {
    expect(await read(path)).toEqual({ kind: "not_found" })
  })

  test("an unknown snapshot id is not_found", async () => {
    expect(await read("README.md", 1, 1, "other")).toEqual({ kind: "not_found" })
  })

  test("a path that only shares text with a denied prefix is allowed", async () => {
    const tricky = new InMemorySnapshot({
      snapshotId: "s",
      files: { "vendors/a.txt": "x" },
      deniedPrefixes: ["vendor"],
    })
    expect(await tricky.readLines({ snapshotId: "s", path: "vendors/a.txt", startLine: 1, endLine: 1 })).toEqual({
      kind: "ok",
      lines: ["x"],
    })
  })

  test("normalizes ./ and repeated slashes", async () => {
    expect(await read("./src//lib/Math.sol")).toEqual({ kind: "ok", lines: ["library Math {}"] })
  })

  test("records every read, including refused ones", async () => {
    const reading = snapshot()
    await reading.readLines({ snapshotId: "snap-1", path: "../x", startLine: 1, endLine: 2 })
    await reading.readLines({ snapshotId: "snap-1", path: "README.md", startLine: 1, endLine: 1 })
    expect(reading.reads.map((entry) => entry.path)).toEqual(["../x", "README.md"])
  })
})

describe("InMemorySnapshot.listFiles", () => {
  test("lists every allowed file in a stable order, hiding denied prefixes", async () => {
    expect(await snapshot().listFiles({ snapshotId: "snap-1" })).toEqual([
      "README.md",
      "empty.txt",
      "src/Vault.sol",
      "src/lib/Math.sol",
    ])
  })

  test("limits the listing to a directory and refuses escapes", async () => {
    const listing = snapshot()
    expect(await listing.listFiles({ snapshotId: "snap-1", directory: "src" })).toEqual([
      "src/Vault.sol",
      "src/lib/Math.sol",
    ])
    expect(await listing.listFiles({ snapshotId: "snap-1", directory: "vendor" })).toEqual([])
    expect(await listing.listFiles({ snapshotId: "snap-1", directory: ".." })).toEqual([])
    expect(await listing.listFiles({ snapshotId: "snap-1", directory: "/" })).toEqual([])
    expect(await listing.listFiles({ snapshotId: "other" })).toEqual([])
  })
})

describe("InMemorySnapshot is read-only by construction", () => {
  test("its only methods are readLines and listFiles", () => {
    const methods = Object.getOwnPropertyNames(InMemorySnapshot.prototype).filter((name) => name !== "constructor")
    expect(methods.toSorted()).toEqual(["listFiles", "readLines"])
  })

  test("rejects fixture paths that are not snapshot-relative", () => {
    expect(() => new InMemorySnapshot({ snapshotId: "s", files: { "../escape.txt": "" } })).toThrow("must be relative")
  })
})
