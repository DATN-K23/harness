import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { DiskSourceSnapshot } from "../../src/source/disk-source-snapshot"
import {
  InvalidSnapshotIdError,
  SnapshotExistsError,
  SnapshotInUseError,
  SnapshotIntegrityError,
} from "../../src/source/snapshot-errors"
import { SnapshotManager } from "../../src/source/snapshot-manager"
import { snapshotInUse } from "../../src/source/snapshot-usage"

describe("Track A snapshot hardening", () => {
  let tempDir: string
  let sourceDir: string
  let storageDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-snapshot-track-a-"))
    sourceDir = path.join(tempDir, "source")
    storageDir = path.join(tempDir, "storage")
    await fs.mkdir(sourceDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  it("rejects traversal, slash, and empty IDs before touching snapshot storage", async () => {
    const absentSource = path.join(tempDir, "missing-source")
    for (const snapshotId of ["..", "a/b", ""]) {
      await expect(
        SnapshotManager.ingestRepository({ sourceDir: absentSource, storageDir, snapshotId }),
      ).rejects.toBeInstanceOf(InvalidSnapshotIdError)
      await expect(SnapshotManager.loadSnapshotManifest(storageDir, snapshotId)).rejects.toBeInstanceOf(
        InvalidSnapshotIdError,
      )
      await expect(
        SnapshotManager.deleteSnapshot(storageDir, snapshotId, { isInUse: async () => false }),
      ).rejects.toBeInstanceOf(InvalidSnapshotIdError)
      expect(() => new DiskSourceSnapshot({ storageDir, snapshotId })).toThrow(InvalidSnapshotIdError)
    }

    expect(await fs.stat(storageDir).catch(() => null)).toBeNull()
    const error = await SnapshotManager.loadSnapshotManifest(storageDir, "..").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(InvalidSnapshotIdError)
    expect((error as Error).message).not.toContain(tempDir)
  })

  it("uses a content-derived ID and returns an unchanged snapshot on identical re-ingestion", async () => {
    await fs.mkdir(path.join(sourceDir, "src"), { recursive: true })
    await fs.writeFile(path.join(sourceDir, "src", "Vault.sol"), "contract Vault {}\n")

    const first = await SnapshotManager.ingestRepository({ sourceDir, storageDir })
    const second = await SnapshotManager.ingestRepository({ sourceDir, storageDir })

    expect(first.snapshotId).toMatch(/^snap_[a-f0-9]{12}$/)
    expect(second.snapshotId).toBe(first.snapshotId)
    expect(second.manifest).toEqual(first.manifest)
    expect(await fs.readFile(path.join(first.snapshotDir, "manifest.json"), "utf8")).toContain(
      first.manifest.treeDigest,
    )
  })

  it("gives changed content a new ID and keeps the original snapshot readable", async () => {
    await fs.writeFile(path.join(sourceDir, "Vault.sol"), "contract Vault {}\n")
    const first = await SnapshotManager.ingestRepository({ sourceDir, storageDir })

    await fs.writeFile(path.join(sourceDir, "Vault.sol"), "contract VaultV2 {}\n")
    const second = await SnapshotManager.ingestRepository({ sourceDir, storageDir })

    expect(second.snapshotId).not.toBe(first.snapshotId)
    const oldRead = await new DiskSourceSnapshot({ storageDir, snapshotId: first.snapshotId }).readLines({
      snapshotId: first.snapshotId,
      path: "Vault.sol",
      startLine: 1,
      endLine: 1,
    })
    expect(oldRead).toEqual({ kind: "ok", lines: ["contract Vault {}"] })
  })

  it("refuses changed content under an explicit ID without modifying the existing snapshot", async () => {
    await fs.writeFile(path.join(sourceDir, "Vault.sol"), "contract Vault {}\n")
    const first = await SnapshotManager.ingestRepository({ sourceDir, storageDir, snapshotId: "fixture-1" })
    const originalManifest = await fs.readFile(path.join(first.snapshotDir, "manifest.json"), "utf8")
    const originalFile = await fs.readFile(path.join(first.snapshotDir, "Vault.sol"), "utf8")

    await fs.writeFile(path.join(sourceDir, "Vault.sol"), "contract VaultV2 {}\n")
    await expect(
      SnapshotManager.ingestRepository({ sourceDir, storageDir, snapshotId: "fixture-1" }),
    ).rejects.toBeInstanceOf(SnapshotExistsError)

    expect(await fs.readFile(path.join(first.snapshotDir, "manifest.json"), "utf8")).toBe(originalManifest)
    expect(await fs.readFile(path.join(first.snapshotDir, "Vault.sol"), "utf8")).toBe(originalFile)
  })

  it("detects tampered snapshot files and keeps old manifests readable", async () => {
    await fs.writeFile(path.join(sourceDir, "Vault.sol"), "contract Vault {}\n")
    const created = await SnapshotManager.ingestRepository({ sourceDir, storageDir, snapshotId: "legacy-random-id" })
    const snapshotDir = created.snapshotDir
    const diskSnapshot = new DiskSourceSnapshot({ storageDir, snapshotId: created.snapshotId })
    const legacyRead = await diskSnapshot.readLines({
      snapshotId: created.snapshotId,
      path: "Vault.sol",
      startLine: 1,
      endLine: 1,
    })
    expect(legacyRead).toEqual({ kind: "ok", lines: ["contract Vault {}"] })
    await fs.writeFile(path.join(snapshotDir, "Vault.sol"), "contract Altered {}\n")

    let thrown: unknown
    try {
      await diskSnapshot.readLines({
        snapshotId: created.snapshotId,
        path: "Vault.sol",
        startLine: 1,
        endLine: 1,
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SnapshotIntegrityError)
    expect((thrown as Error).message).toContain("Vault.sol")
    expect((thrown as Error).message).not.toContain(tempDir)

    const parsedLegacy = await SnapshotManager.loadSnapshotManifest(storageDir, created.snapshotId)
    expect(parsedLegacy.snapshotId).toBe("legacy-random-id")
    expect(parsedLegacy.skipped).toBeUndefined()
    expect(parsedLegacy.warnings).toBeUndefined()
  })

  it("blocks deletion while a non-terminal run references the snapshot", async () => {
    await fs.writeFile(path.join(sourceDir, "Vault.sol"), "contract Vault {}\n")
    await SnapshotManager.ingestRepository({ sourceDir, storageDir, snapshotId: "in-use-snapshot" })
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1 } })
    store.seedRun("active-run", "running", "", "in-use-snapshot")
    store.seedRun("completed-run", "completed", "", "in-use-snapshot")

    expect(await store.findActiveRunsBySnapshot?.("in-use-snapshot")).toEqual(["active-run"])
    const isInUse = snapshotInUse(store)
    await expect(SnapshotManager.deleteSnapshot(storageDir, "in-use-snapshot", { isInUse })).rejects.toBeInstanceOf(
      SnapshotInUseError,
    )
    expect(await new DiskSourceSnapshot({ storageDir, snapshotId: "in-use-snapshot" }).listFiles({
      snapshotId: "in-use-snapshot",
    })).toEqual(["Vault.sol"])
  })

  it("cleans interrupted staging directories and leaves completed snapshots in place", async () => {
    await fs.writeFile(path.join(sourceDir, "Vault.sol"), "contract Vault {}\n")
    const completed = await SnapshotManager.ingestRepository({
      sourceDir,
      storageDir,
      snapshotId: "completed-snapshot",
    })
    const interrupted = path.join(storageDir, ".tmp-interrupted")
    await fs.mkdir(interrupted, { recursive: true })
    await fs.writeFile(path.join(interrupted, "partial"), "partial")

    await SnapshotManager.cleanupStaging(storageDir)

    expect(await fs.stat(interrupted).catch(() => null)).toBeNull()
    expect(await fs.stat(completed.snapshotDir).then((stat) => stat.isDirectory())).toBe(true)
    await expect(SnapshotManager.loadSnapshotManifest(storageDir, "interrupted")).rejects.toThrow("Snapshot not found")
  })

  it("excludes nested denied directories and case-insensitive secret filenames", async () => {
    await fs.mkdir(path.join(sourceDir, "lib", "forge-std", ".git"), { recursive: true })
    await fs.mkdir(path.join(sourceDir, "lib", "dep", "node_modules", "x"), { recursive: true })
    await fs.mkdir(path.join(sourceDir, "contracts"), { recursive: true })
    await fs.writeFile(path.join(sourceDir, "lib", "forge-std", ".git", "config"), "git")
    await fs.writeFile(path.join(sourceDir, "lib", "dep", "node_modules", "x", "index.js"), "module")
    await fs.writeFile(path.join(sourceDir, "contracts", ".ENV"), "SECRET=value")

    const created = await SnapshotManager.ingestRepository({ sourceDir, storageDir })
    expect(Object.keys(created.manifest.files)).toEqual([])
    expect(created.manifest.skipped).toContainEqual({ path: "lib/forge-std/.git", reason: "denied" })
    expect(created.manifest.skipped).toContainEqual({ path: "lib/forge-std/.git/config", reason: "denied" })
    expect(created.manifest.skipped).toContainEqual({ path: "lib/dep/node_modules", reason: "denied" })
    expect(created.manifest.skipped).toContainEqual({ path: "lib/dep/node_modules/x/index.js", reason: "denied" })
    expect(created.manifest.skipped).toContainEqual({ path: "contracts/.ENV", reason: "denied" })
  })

  it("restricts ingestion to include roots and flags ingested report-like names", async () => {
    await fs.mkdir(path.join(sourceDir, "src", "docs"), { recursive: true })
    await fs.mkdir(path.join(sourceDir, "audit"), { recursive: true })
    await fs.writeFile(path.join(sourceDir, "src", "Vault.sol"), "contract Vault {}\n")
    await fs.writeFile(path.join(sourceDir, "audit", "findings-report.md"), "outside")
    await fs.writeFile(path.join(sourceDir, "src", "docs", "report.md"), "inside")

    const created = await SnapshotManager.ingestRepository({ sourceDir, storageDir, includeRoots: ["src"] })
    expect(Object.keys(created.manifest.files).toSorted()).toEqual(["src/Vault.sol", "src/docs/report.md"])
    expect(created.manifest.warnings).toEqual([{ path: "src/docs/report.md", reason: "report_like_name" }])
    expect(created.manifest.skipped).toContainEqual({ path: "audit", reason: "denied" })
  })

  it("skips symlinks, oversized files, and binary files with reasons", async () => {
    await fs.writeFile(path.join(sourceDir, "plain.txt"), "plain")
    await fs.writeFile(path.join(sourceDir, "large.sol"), Buffer.alloc(2 * 1024 * 1024, 65))
    await fs.writeFile(path.join(sourceDir, "binary.bin"), Buffer.from([65, 0, 66]))
    await fs.symlink(path.join(sourceDir, "plain.txt"), path.join(sourceDir, "linked.txt"))

    const created = await SnapshotManager.ingestRepository({ sourceDir, storageDir })
    expect(created.manifest.files["large.sol"]).toBeUndefined()
    expect(created.manifest.files["binary.bin"]).toBeUndefined()
    expect(created.manifest.skipped).toContainEqual({ path: "large.sol", reason: "too_large" })
    expect(created.manifest.skipped).toContainEqual({ path: "binary.bin", reason: "binary" })
    expect(created.manifest.files["linked.txt"]).toBeUndefined()
    expect(created.manifest.skipped).toContainEqual({ path: "linked.txt", reason: "symlink" })

    const raisedFileLimit = await SnapshotManager.ingestRepository({
      sourceDir,
      storageDir,
      snapshotId: "large-file-allowed",
      maxFileBytes: 3 * 1024 * 1024,
    })
    expect(raisedFileLimit.manifest.files["large.sol"]).toBeDefined()
  })

  it("fails ingestion when configured file-count or total-byte limits are exceeded", async () => {
    await fs.writeFile(path.join(sourceDir, "a.txt"), "aa")
    await fs.writeFile(path.join(sourceDir, "b.txt"), "bb")
    await expect(SnapshotManager.ingestRepository({ sourceDir, storageDir, maxFiles: 1 })).rejects.toThrow(
      "maximum file count",
    )
    await expect(SnapshotManager.ingestRepository({ sourceDir, storageDir, maxTotalBytes: 3 })).rejects.toThrow(
      "maximum total size",
    )
  })
})
