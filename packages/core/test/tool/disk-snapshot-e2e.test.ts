import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { ToolCall } from "@harness/protocol"
import { DiskSourceSnapshot } from "../../src/source/disk-source-snapshot"
import { SnapshotManager } from "../../src/source/snapshot-manager"
import { ToolRegistry } from "../../src/tool/registry"

const call = (toolName: string, args: Record<string, unknown>): ToolCall => ({
  runId: "run-e2e-disk",
  callId: "call-e2e-1",
  toolName,
  arguments: args,
})

describe("End-to-End Tool Execution with DiskSourceSnapshot", () => {
  const tmpRoot = path.join("/private/var/folders/j0/r3cygsgx3mv6s_gwj93k9rth0000gn/T/opencode", `test-tool-disk-${Date.now()}`)
  const sourceRepoDir = path.join(tmpRoot, "source-repo")
  const storageDir = path.join(tmpRoot, "snapshots")
  let snapshotId: string
  let diskSnapshot: DiskSourceSnapshot
  let registry: ToolRegistry

  beforeAll(async () => {
    await fs.mkdir(path.join(sourceRepoDir, "contracts"), { recursive: true })
    await fs.writeFile(
      path.join(sourceRepoDir, "contracts", "Vault.sol"),
      "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Vault {\n  mapping(address => uint256) public balances;\n  function deposit() external payable {}\n}\n",
    )
    await fs.writeFile(path.join(sourceRepoDir, "README.md"), "# Vault Repository\n")

    const created = await SnapshotManager.ingestRepository({ sourceDir: sourceRepoDir, storageDir })
    snapshotId = created.snapshotId
    diskSnapshot = new DiskSourceSnapshot({ storageDir, snapshotId })
    registry = new ToolRegistry({
      snapshot: diskSnapshot,
      snapshotId,
    })
  })

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
  })

  test("read_file reads from real disk snapshot", async () => {
    const res = await registry.execute(call("read_file", { path: "contracts/Vault.sol", startLine: 1, endLine: 3 }))
    expect(res.isError).toBe(false)
    expect(res.lineRange).toEqual([1, 3])
    expect(res.content).toContain("pragma solidity ^0.8.0;")
  })

  test("list_dir lists entries from real disk snapshot", async () => {
    const res = await registry.execute(call("list_dir", {}))
    expect(res.isError).toBe(false)
    expect(res.content).toContain("README.md")
    expect(res.content).toContain("contracts/")
  })

  test("glob finds contracts from real disk snapshot", async () => {
    const res = await registry.execute(call("glob", { pattern: "**/*.sol" }))
    expect(res.isError).toBe(false)
    expect(res.content).toBe("contracts/Vault.sol")
  })

  test("grep locates identifiers across files in real disk snapshot", async () => {
    const res = await registry.execute(call("grep", { pattern: "balances" }))
    expect(res.isError).toBe(false)
    expect(res.content).toContain("contracts/Vault.sol:4:   mapping(address => uint256) public balances;")
  })
})
