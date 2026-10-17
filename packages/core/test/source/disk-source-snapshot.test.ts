import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { DiskSourceSnapshot } from "../../src/source/disk-source-snapshot"
import { SnapshotManager } from "../../src/source/snapshot-manager"

describe("DiskSourceSnapshot & immutability guarantee", () => {
  let tmpDir: string
  let sourceDir: string
  let storageDir: string
  const snapshotId = "snap-immutable-test"

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-disk-snap-test-"))
    sourceDir = path.join(tmpDir, "source-repo")
    storageDir = path.join(tmpDir, "snapshots")

    await fs.mkdir(sourceDir, { recursive: true })
    await fs.mkdir(path.join(sourceDir, "contracts"), { recursive: true })

    await fs.writeFile(
      path.join(sourceDir, "contracts", "Vault.sol"),
      "// Line 1\ncontract Vault {\n    uint256 public total;\n}\n",
    )
    await fs.writeFile(path.join(sourceDir, "README.md"), "# Vault Docs\nDescription here\n")

    // Ingest into snapshot
    await SnapshotManager.ingestRepository({
      sourceDir,
      storageDir,
      snapshotId,
    })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  it("reads lines and lists files correctly via DiskSourceSnapshot", async () => {
    const snapshot = new DiskSourceSnapshot({
      storageDir,
      snapshotId,
    })

    const files = await snapshot.listFiles({ snapshotId })
    expect(files).toEqual(["README.md", "contracts/Vault.sol"])

    const filtered = await snapshot.listFiles({ snapshotId, directory: "contracts" })
    expect(filtered).toEqual(["contracts/Vault.sol"])

    const read = await snapshot.readLines({
      snapshotId,
      path: "contracts/Vault.sol",
      startLine: 2,
      endLine: 3,
    })

    expect(read).toEqual({
      kind: "ok",
      lines: ["contract Vault {", "    uint256 public total;"],
    })
  })

  it("modifying host source repository after ingestion does NOT affect snapshot", async () => {
    const snapshot = new DiskSourceSnapshot({
      storageDir,
      snapshotId,
    })

    // Modify original file in host repo
    await fs.writeFile(path.join(sourceDir, "contracts", "Vault.sol"), "contract VaultHacked {}\n")
    // Add new file in host repo
    await fs.writeFile(path.join(sourceDir, "contracts", "NewContract.sol"), "contract NewContract {}\n")
    // Delete README in host repo
    await fs.rm(path.join(sourceDir, "README.md"))

    // Verify snapshot reading is 100% unaffected
    const read = await snapshot.readLines({
      snapshotId,
      path: "contracts/Vault.sol",
      startLine: 1,
      endLine: 2,
    })
    expect(read).toEqual({
      kind: "ok",
      lines: ["// Line 1", "contract Vault {"],
    })

    const files = await snapshot.listFiles({ snapshotId })
    expect(files).toEqual(["README.md", "contracts/Vault.sol"])
  })

  it("rejects path traversal, missing paths, and out-of-range lines", async () => {
    const snapshot = new DiskSourceSnapshot({
      storageDir,
      snapshotId,
    })

    const traversal = await snapshot.readLines({
      snapshotId,
      path: "../escape.txt",
      startLine: 1,
      endLine: 1,
    })
    expect(traversal.kind).toBe("not_found")

    const notFound = await snapshot.readLines({
      snapshotId,
      path: "contracts/Missing.sol",
      startLine: 1,
      endLine: 1,
    })
    expect(notFound.kind).toBe("not_found")

    const outOfRange = await snapshot.readLines({
      snapshotId,
      path: "contracts/Vault.sol",
      startLine: 99,
      endLine: 100,
    })
    expect(outOfRange.kind).toBe("out_of_range")
  })
})
