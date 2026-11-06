import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { DiskSourceSnapshot } from "../../src/source/disk-source-snapshot"
import { SnapshotManager } from "../../src/source/snapshot-manager"

describe("Adversarial security & edge cases for DiskSourceSnapshot and SnapshotManager", () => {
  let tmpDir: string
  let sourceDir: string
  let storageDir: string
  let outsideDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-adv-snap-test-"))
    sourceDir = path.join(tmpDir, "source-repo")
    storageDir = path.join(tmpDir, "snapshots")
    outsideDir = path.join(tmpDir, "outside")

    await fs.mkdir(sourceDir, { recursive: true })
    await fs.mkdir(storageDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })

    // Outside secret file
    await fs.writeFile(path.join(outsideDir, "secret_host_key.pem"), "PRIVATE_KEY_DATA\n")
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  it("blocks symlink escaping outside repository boundary during ingestion", async () => {
    // Legitimate file
    await fs.writeFile(path.join(sourceDir, "Main.sol"), "contract Main {}\n")

    // Evil symlink pointing outside source repo
    await fs.symlink(path.join(outsideDir, "secret_host_key.pem"), path.join(sourceDir, "evil_symlink.sol"))

    // Ingest
    const result = await SnapshotManager.ingestRepository({
      sourceDir,
      storageDir,
      snapshotId: "snap-symlink-test",
    })

    // The symlink to outside should be excluded from manifest
    expect(result.manifest.files["evil_symlink.sol"]).toBeUndefined()
    expect(result.manifest.files["Main.sol"]).toBeDefined()

    // And file must not exist in snapshotDir
    const escapedExists = await fs.stat(path.join(result.snapshotDir, "evil_symlink.sol")).catch(() => null)
    expect(escapedExists).toBeNull()
  })

  it("handles empty files and single-line files without trailing newline", async () => {
    await fs.writeFile(path.join(sourceDir, "Empty.sol"), "")
    await fs.writeFile(path.join(sourceDir, "NoNewline.sol"), "contract NoNewline {}")

    const result = await SnapshotManager.ingestRepository({
      sourceDir,
      storageDir,
      snapshotId: "snap-edge-files",
    })

    expect(result.manifest.files["Empty.sol"]?.lineCount).toBe(0)
    expect(result.manifest.files["NoNewline.sol"]?.lineCount).toBe(1)

    const snapshot = new DiskSourceSnapshot({
      storageDir,
      snapshotId: "snap-edge-files",
    })

    // Reading empty file
    const readEmpty = await snapshot.readLines({
      snapshotId: "snap-edge-files",
      path: "Empty.sol",
      startLine: 1,
      endLine: 1,
    })
    expect(readEmpty.kind).toBe("out_of_range")

    // Reading single line without trailing newline
    const readNoNewline = await snapshot.readLines({
      snapshotId: "snap-edge-files",
      path: "NoNewline.sol",
      startLine: 1,
      endLine: 1,
    })
    expect(readNoNewline).toEqual({
      kind: "ok",
      lines: ["contract NoNewline {}"],
    })
  })

  it("handles CRLF line endings correctly preserving exact content per line", async () => {
    await fs.writeFile(path.join(sourceDir, "Windows.sol"), "line 1\r\nline 2\r\nline 3\r\n")

    await SnapshotManager.ingestRepository({
      sourceDir,
      storageDir,
      snapshotId: "snap-crlf-test",
    })

    const snapshot = new DiskSourceSnapshot({
      storageDir,
      snapshotId: "snap-crlf-test",
    })

    const read = await snapshot.readLines({
      snapshotId: "snap-crlf-test",
      path: "Windows.sol",
      startLine: 1,
      endLine: 2,
    })

    expect(read.kind).toBe("ok")
    if (read.kind === "ok") {
      expect(read.lines[0]).toBe("line 1\r")
      expect(read.lines[1]).toBe("line 2\r")
    }
  })

  it("survives process restart / fresh instance reload using only snapshotId and storageDir", async () => {
    await fs.writeFile(path.join(sourceDir, "Vault.sol"), "contract Vault {}\n")

    await SnapshotManager.ingestRepository({
      sourceDir,
      storageDir,
      snapshotId: "snap-restart-test",
    })

    // Simulate new process without cached manifest in memory
    const freshInstance = new DiskSourceSnapshot({
      storageDir,
      snapshotId: "snap-restart-test",
    })

    const files = await freshInstance.listFiles({ snapshotId: "snap-restart-test" })
    expect(files).toEqual(["Vault.sol"])

    const content = await freshInstance.readLines({
      snapshotId: "snap-restart-test",
      path: "Vault.sol",
      startLine: 1,
      endLine: 1,
    })
    expect(content).toEqual({
      kind: "ok",
      lines: ["contract Vault {}"],
    })
  })

  it("honors AbortSignal on readLines and listFiles", async () => {
    await fs.writeFile(path.join(sourceDir, "Vault.sol"), "contract Vault {}\n")

    await SnapshotManager.ingestRepository({
      sourceDir,
      storageDir,
      snapshotId: "snap-abort-test",
    })

    const snapshot = new DiskSourceSnapshot({
      storageDir,
      snapshotId: "snap-abort-test",
    })

    const controller = new AbortController()
    controller.abort()

    await expect(
      snapshot.readLines(
        {
          snapshotId: "snap-abort-test",
          path: "Vault.sol",
          startLine: 1,
          endLine: 1,
        },
        controller.signal,
      ),
    ).rejects.toThrow()

    await expect(
      snapshot.listFiles(
        {
          snapshotId: "snap-abort-test",
        },
        controller.signal,
      ),
    ).rejects.toThrow()
  })

  it("refuses mismatched snapshotId", async () => {
    await fs.writeFile(path.join(sourceDir, "Vault.sol"), "contract Vault {}\n")

    await SnapshotManager.ingestRepository({
      sourceDir,
      storageDir,
      snapshotId: "snap-actual",
    })

    const snapshot = new DiskSourceSnapshot({
      storageDir,
      snapshotId: "snap-actual",
    })

    const read = await snapshot.readLines({
      snapshotId: "snap-different",
      path: "Vault.sol",
      startLine: 1,
      endLine: 1,
    })
    expect(read.kind).toBe("not_found")

    const files = await snapshot.listFiles({
      snapshotId: "snap-different",
    })
    expect(files).toEqual([])
  })
})
