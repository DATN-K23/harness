import { describe, expect, test } from "bun:test"
import type { ToolCall } from "@harness/protocol"
import { InMemorySnapshot } from "../../src/source/in-memory-snapshot"
import { ToolRegistry } from "../../src/tool/registry"

const call = (toolName: string, args: Record<string, unknown>): ToolCall => ({
  runId: "run-test",
  callId: "call-1",
  toolName,
  arguments: args,
})

describe("ToolRegistry with SourceSnapshotPort", () => {
  const snapshot = new InMemorySnapshot({
    snapshotId: "snap-abc",
    files: {
      "src/Token.sol": "contract Token {\n  uint256 public totalSupply;\n}\n",
      "src/Vault.sol": "contract Vault {\n  function deposit() external {}\n}\n",
      "secrets/secret.key": "supersecretpassword\n",
    },
    deniedPrefixes: ["secrets"],
  })

  const registry = new ToolRegistry({
    snapshot,
    snapshotId: "snap-abc",
    deniedPrefixes: ["secrets"],
    secrets: ["supersecretpassword"],
  })

  test("definitions exposes standard 4 tools", () => {
    const defs = registry.definitions()
    expect(defs.map((d) => d.name)).toEqual(["read_file", "grep", "glob", "list_dir"])
  })

  test("read_file reads from snapshot correctly", async () => {
    const result = await registry.execute(call("read_file", { path: "src/Token.sol", startLine: 1, endLine: 2 }))
    expect(result.isError).toBe(false)
    expect(result.filePath).toBe("src/Token.sol")
    expect(result.lineRange).toEqual([1, 2])
    expect(result.content).toBe("contract Token {\n  uint256 public totalSupply;")
  })

  test("read_file on denied path is blocked", async () => {
    const result = await registry.execute(call("read_file", { path: "secrets/secret.key" }))
    expect(result.isError).toBe(true)
    expect(result.content).toContain("Access denied")
  })

  test("list_dir lists entries from snapshot", async () => {
    const result = await registry.execute(call("list_dir", { path: "src" }))
    expect(result.isError).toBe(false)
    expect(result.content).toContain("Token.sol")
    expect(result.content).toContain("Vault.sol")
  })

  test("glob matches files from snapshot", async () => {
    const result = await registry.execute(call("glob", { pattern: "**/*.sol" }))
    expect(result.isError).toBe(false)
    expect(result.content).toContain("src/Token.sol")
    expect(result.content).toContain("src/Vault.sol")
    expect(result.content).not.toContain("secrets")
  })

  test("grep searches across snapshot files", async () => {
    const result = await registry.execute(call("grep", { pattern: "totalSupply" }))
    expect(result.isError).toBe(false)
    expect(result.content).toContain("src/Token.sol:2:   uint256 public totalSupply;")
  })

  test("secret redaction works when secret appears in output", async () => {
    const customSnapshot = new InMemorySnapshot({
      snapshotId: "snap-leak",
      files: {
        "src/Leak.sol": "string secret = 'supersecretpassword';\n",
      },
    })
    const leakRegistry = new ToolRegistry({
      snapshot: customSnapshot,
      snapshotId: "snap-leak",
      secrets: ["supersecretpassword"],
    })

    const res = await leakRegistry.execute(call("read_file", { path: "src/Leak.sol" }))
    expect(res.content).not.toContain("supersecretpassword")
    expect(res.content).toContain("[REDACTED]")
  })
})
