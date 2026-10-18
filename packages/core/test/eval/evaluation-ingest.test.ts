import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, test } from "bun:test"
import type { ContestManifestEntry } from "../../src/eval/corpus-loader"
import { checkSnapshotContamination, ingestContestForEvaluation } from "../../src/eval/index"
import { InMemorySnapshot } from "../../src/source/in-memory-snapshot"

const makeEntry = (includeRoots: string[] = ["contracts"]): ContestManifestEntry => ({
  contestId: "contest-a",
  split: "test",
  findingsDir: "finding",
  ingestion: {
    dataRepoCommit: "commit-a",
    contestDir: "contest-a",
    includeRoots,
    ingestionPolicyVersion: "ingest-policy-v2",
  },
})

describe("evaluation ingestion and contamination controls", () => {
  test("refuses missing or empty include roots before accessing the data root", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-evaluation-refusal-"))
    const dataRoot = path.join(tempDir, "missing-data-root")
    const storageDir = path.join(tempDir, "snapshots")

    try {
      const entries: ContestManifestEntry[] = [
        { contestId: "no-ingestion", split: "test" },
        makeEntry([]),
      ]
      for (const entry of entries) {
        await expect(ingestContestForEvaluation({ entry, dataRoot, storageDir })).rejects.toThrow("includeRoots")
      }
      expect(await fs.stat(storageDir).catch(() => null)).toBeNull()
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  test("ingests only profiled paths into separate storage and reproduces the snapshot", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-evaluation-ingest-"))
    const dataRoot = path.join(tempDir, "data")
    const sourceRoot = path.join(dataRoot, "contest-a", "src")
    const storageDir = path.join(tempDir, "snapshot-storage")
    const sourceFile = path.join(sourceRoot, "contracts", "Vault.sol")
    const foundryFile = path.join(sourceRoot, "foundry.toml")
    const remappingsFile = path.join(sourceRoot, "remappings.txt")
    const privateFile = path.join(sourceRoot, "private.md")

    try {
      await fs.mkdir(path.dirname(sourceFile), { recursive: true })
      await fs.writeFile(sourceFile, "contract Vault {}\n")
      await fs.writeFile(foundryFile, "[profile.default]\n")
      await fs.writeFile(remappingsFile, "forge-std/=lib/forge-std/src/\n")
      await fs.writeFile(privateFile, "outside profile")

      const entry = makeEntry()
      const before = await fs.readFile(sourceFile, "utf8")
      const rootEntriesBefore = (await fs.readdir(dataRoot)).toSorted()
      const sourceEntriesBefore = (await fs.readdir(sourceRoot)).toSorted()
      const first = await ingestContestForEvaluation({ entry, dataRoot, storageDir })
      const second = await ingestContestForEvaluation({ entry, dataRoot, storageDir })

      expect(Object.keys(first.manifest.files).toSorted()).toEqual([
        "contracts/Vault.sol",
        "foundry.toml",
        "remappings.txt",
      ])
      expect(first.manifest.ingestionPolicyVersion).toBe("ingest-policy-v2")
      expect(second.snapshotId).toBe(first.snapshotId)
      expect(second.manifest.treeDigest).toBe(first.manifest.treeDigest)
      expect(await fs.readFile(sourceFile, "utf8")).toBe(before)
      expect((await fs.readdir(dataRoot)).toSorted()).toEqual(rootEntriesBefore)
      expect((await fs.readdir(sourceRoot)).toSorted()).toEqual(sourceEntriesBefore)
      expect(await fs.stat(path.join(dataRoot, "snapshots")).catch(() => null)).toBeNull()
      expect(await fs.stat(path.join(storageDir, first.snapshotId)).then((stat) => stat.isDirectory())).toBe(true)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  test("reports a finding title leaked into a fixture snapshot file", async () => {
    const snapshot = new InMemorySnapshot({
      snapshotId: "leak-snapshot",
      files: {
        "src/Vault.sol": "// UNAUTHORIZED---VAULT withdrawal drains funds\ncontract Vault {}",
      },
    })

    const result = await checkSnapshotContamination({
      snapshot,
      snapshotId: "leak-snapshot",
      findings: [{ findingId: "M-01", title: "Unauthorized vault withdrawal drains funds" }],
    })

    expect(result).toEqual({
      clean: false,
      leaks: [{ findingId: "M-01", paths: ["src/Vault.sol"] }],
    })
  })

  test("reports a clean fixture snapshot and ignores titles shorter than twelve characters", async () => {
    const snapshot = new InMemorySnapshot({
      snapshotId: "clean-snapshot",
      files: { "src/Vault.sol": "contract Vault { function deposit() external {} }" },
    })

    const result = await checkSnapshotContamination({
      snapshot,
      snapshotId: "clean-snapshot",
      findings: [
        { findingId: "M-02", title: "A long finding title not in this source" },
        { findingId: "M-03", title: "short title" },
      ],
    })

    expect(result).toEqual({ clean: true, leaks: [] })
  })
})
