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

  test("always denies ground-truth content and filters it from files-map listings", async () => {
    const policyRegistry = new ToolRegistry({
      files: {
        "test/ground-truth/label.json": "secret label",
        "src/ground-truth/label.json": "nested secret label",
        "lib/node_modules/package.json": "dependency",
        "contracts/.ENV": "private environment",
        ".git/config": "git credentials",
        "src/Token.sol": "contract Token {}",
      },
    })

    const deniedRead = await policyRegistry.execute(call("read_file", { path: "test/ground-truth/label.json" }))
    expect(deniedRead.isError).toBe(true)
    expect(deniedRead.content).toContain("Access denied")
    expect(deniedRead.content).not.toContain("secret label")

    const listed = await policyRegistry.execute(call("list_dir", {}))
    expect(listed.content).toContain("src/")
    expect(listed.content).not.toContain(".git")
    expect(listed.content).not.toContain("ground-truth")

    const globbed = await policyRegistry.execute(call("glob", { pattern: "**/*" }))
    expect(globbed.content).toContain("src/Token.sol")
    expect(globbed.content).not.toContain("ground-truth")
    expect(globbed.content).not.toContain(".git")

    const searched = await policyRegistry.execute(call("grep", { pattern: "secret|credentials" }))
    expect(searched.content).not.toContain("secret label")
    expect(searched.content).not.toContain("credentials")

    const snapshot = new InMemorySnapshot({
      snapshotId: "snap-policy",
      deniedPrefixes: [],
      files: {
        "test/ground-truth/label.json": "snapshot label",
        "lib/node_modules/package.json": "snapshot dependency",
        "contracts/.ENV": "snapshot environment",
        "src/Token.sol": "contract Token {}",
      },
    })
    const snapshotRegistry = new ToolRegistry({ snapshot, snapshotId: "snap-policy" })
    const snapshotDenied = await snapshotRegistry.execute(call("read_file", { path: "test/ground-truth/label.json" }))
    const snapshotListed = await snapshotRegistry.execute(call("list_dir", {}))
    const snapshotGlobbed = await snapshotRegistry.execute(call("glob", { pattern: "**/*" }))
    const snapshotSearched = await snapshotRegistry.execute(call("grep", { pattern: "snapshot" }))

    expect(snapshotDenied.isError).toBe(true)
    expect(snapshotListed.content).not.toContain("ground-truth")
    expect(snapshotListed.content).not.toContain("node_modules")
    expect(snapshotGlobbed.content).toBe("src/Token.sol")
    expect(snapshotSearched.content).toBe('No matches for "snapshot".')
  })

  test("exposes read-only snapshot identity and effective tool limits", () => {
    const configuredRegistry = new ToolRegistry({
      files: {},
      snapshotId: "snap-limits",
      maxReadLines: 12,
      maxReadBytes: 34,
      grepTimeoutMs: 56,
      maxGrepScanBytes: 78,
      maxGrepLineChars: 90,
      maxGrepMatches: 2,
      maxGlobMatches: 3,
      maxListEntries: 4,
    })

    expect(configuredRegistry.snapshotId).toBe("snap-limits")
    expect(configuredRegistry.limits()).toEqual({
      readFile: { maxLines: 12, maxBytes: 34 },
      grep: { timeoutMs: 56, maxScanBytes: 78, maxLineChars: 90, maxMatches: 2 },
      glob: { maxMatches: 3 },
      listDir: { maxEntries: 4 },
    })
  })
})
