import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { SnapshotManager } from "../../src/source/snapshot-manager"

describe("SnapshotManager.ingestRepository", () => {
  let tmpDir: string
  let sourceDir: string
  let storageDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-snap-test-"))
    sourceDir = path.join(tmpDir, "source-repo")
    storageDir = path.join(tmpDir, "snapshots")

    await fs.mkdir(sourceDir, { recursive: true })
    await fs.mkdir(path.join(sourceDir, "contracts"), { recursive: true })
    await fs.mkdir(path.join(sourceDir, ".git"), { recursive: true })
    await fs.mkdir(path.join(sourceDir, "test", "ground-truth"), { recursive: true })

    await fs.writeFile(path.join(sourceDir, "contracts", "Token.sol"), "contract Token {}\n")
    await fs.writeFile(path.join(sourceDir, "README.md"), "# Test Repo\nLine 2\n")
    await fs.writeFile(path.join(sourceDir, ".env"), "SECRET_KEY=12345\n")
    await fs.writeFile(path.join(sourceDir, ".git", "config"), "git config file\n")
    await fs.writeFile(path.join(sourceDir, "test", "ground-truth", "label.json"), '{"answer": "hack"}\n')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  it("ingests allowed files and excludes .git, secrets, and ground truth", async () => {
    const result = await SnapshotManager.ingestRepository({
      sourceDir,
      storageDir,
      snapshotId: "snap-test-1",
    })

    expect(result.snapshotId).toBe("snap-test-1")
    expect(result.manifest.snapshotId).toBe("snap-test-1")
    expect(result.manifest.treeDigest).toStartWith("sha256:")

    // Allowed files present
    expect(result.manifest.files["contracts/Token.sol"]).toBeDefined()
    expect(result.manifest.files["contracts/Token.sol"]?.lineCount).toBe(1)
    expect(result.manifest.files["README.md"]).toBeDefined()
    expect(result.manifest.files["README.md"]?.lineCount).toBe(2)

    // Excluded files NOT in manifest
    expect(result.manifest.files[".env"]).toBeUndefined()
    expect(result.manifest.files[".git/config"]).toBeUndefined()
    expect(result.manifest.files["test/ground-truth/label.json"]).toBeUndefined()

    // Excluded files NOT on disk in snapshot directory
    const envExists = await fs.stat(path.join(result.snapshotDir, ".env")).catch(() => null)
    expect(envExists).toBeNull()
    const gitExists = await fs.stat(path.join(result.snapshotDir, ".git")).catch(() => null)
    expect(gitExists).toBeNull()
  })

  it("throws clear error when source directory does not exist", async () => {
    await expect(
      SnapshotManager.ingestRepository({
        sourceDir: path.join(tmpDir, "nonexistent"),
        storageDir,
      }),
    ).rejects.toThrow("does not exist")
  })

  it("handles missing snapshot gracefully", async () => {
    await expect(SnapshotManager.loadSnapshotManifest(storageDir, "nonexistent-id")).rejects.toThrow(
      'Snapshot not found: "nonexistent-id"',
    )
  })

  it("handles corrupted manifest gracefully", async () => {
    const corruptDir = path.join(storageDir, "corrupted-id")
    await fs.mkdir(corruptDir, { recursive: true })
    await fs.writeFile(path.join(corruptDir, "manifest.json"), "{ invalid json")

    await expect(SnapshotManager.loadSnapshotManifest(storageDir, "corrupted-id")).rejects.toThrow(
      'Corrupted snapshot manifest for "corrupted-id"',
    )
  })
})
