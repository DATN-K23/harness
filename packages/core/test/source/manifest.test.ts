import { describe, expect, it } from "bun:test"
import { parseManifest, serializeManifest, type SnapshotManifest } from "../../src/source/manifest"

describe("manifest serialization & schema parsing", () => {
  const validManifest: SnapshotManifest = {
    snapshotId: "snap_12345",
    createdAt: "2026-10-17T06:00:00.000Z",
    treeDigest: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    files: {
      "src/Contract.sol": {
        digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        lineCount: 42,
        byteSize: 1024,
      },
      "README.md": {
        digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        lineCount: 10,
        byteSize: 250,
      },
    },
  }

  it("serializes deterministically and parses successfully", () => {
    const serialized = serializeManifest(validManifest)
    const parsed = parseManifest(serialized)
    expect(parsed).toEqual(validManifest)
  })

  it("rejects invalid digest formats", () => {
    const invalid = {
      ...validManifest,
      treeDigest: "invalid_hash",
    }
    expect(() => parseManifest(JSON.stringify(invalid))).toThrow()
  })
})
