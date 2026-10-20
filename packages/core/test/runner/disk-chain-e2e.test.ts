import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { ModelAttemptRequest, ModelAttemptResponse, ModelGatewayPort } from "@harness/protocol"
import { DiskSourceSnapshot } from "../../src/source/disk-source-snapshot"
import { SnapshotManager } from "../../src/source/snapshot-manager"
import { ToolRegistry } from "../../src/tool/registry"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { MultiTurnRunner } from "../../src/runner/multi-turn-runner"
import { PassThroughContextEngine } from "../../src/context"

class DiskChainGateway implements ModelGatewayPort {
  readonly requests: ModelAttemptRequest[] = []

  constructor(private readonly responses: ModelAttemptResponse[]) {}

  async executeAttempt(request: ModelAttemptRequest): Promise<ModelAttemptResponse> {
    this.requests.push(structuredClone(request))
    const response = this.responses.shift()
    if (response === undefined) throw new Error("The scripted gateway has no response for this turn")
    return response
  }
}

const usage = { promptTokens: 12, completionTokens: 4, totalTokens: 16, costUsd: 0.001 }

describe("disk snapshot to multi-turn runner", () => {
  test("keeps disk source content and history path-free through a complete tool cycle", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "harness-disk-chain-"))
    const sourceDir = path.join(tempRoot, "repository")
    const storageDir = path.join(tempRoot, "snapshots")
    const gitSecret = "DISALLOWED_GIT_CONFIG_CONTENT"

    try {
      await fs.mkdir(path.join(sourceDir, "contracts"), { recursive: true })
      await fs.mkdir(path.join(sourceDir, "lib", "x", ".git"), { recursive: true })
      await fs.writeFile(
        path.join(sourceDir, "contracts", "Vault.sol"),
        "// see /docs/spec.md\npragma solidity ^0.8.0;\ncontract Vault {}\n",
        "utf8",
      )
      await fs.writeFile(path.join(sourceDir, "lib", "x", ".git", "config"), gitSecret, "utf8")

      const ingested = await SnapshotManager.ingestRepository({ sourceDir, storageDir })
      const snapshot = new DiskSourceSnapshot({ storageDir, snapshotId: ingested.snapshotId })
      const registry = new ToolRegistry({ snapshot, snapshotId: ingested.snapshotId })
      const gateway = new DiskChainGateway([
        {
          attemptId: "disk-chain-tool-turn",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "read-vault",
              name: "read_file",
              arguments: { path: "contracts/Vault.sol", startLine: 1, endLine: 3 },
            },
          ],
          usage,
          latencyMs: 1,
        },
        {
          attemptId: "disk-chain-final-turn",
          finishReason: "stop",
          content: "Audit complete",
          usage,
          latencyMs: 1,
        },
      ])
      const store = new InMemoryRunStore({ clock: { nowMs: () => Date.now() } })
      const runner = new MultiTurnRunner({ store, gateway, registry, snapshot, contextEngine: new PassThroughContextEngine() })

      const result = await runner.execute({ prompt: "Audit the source", snapshotId: ingested.snapshotId })
      const events = await store.loadEvents({ runId: result.runId })
      const serializedEvents = JSON.stringify(events)
      const serializedRequests = JSON.stringify(gateway.requests)
      const captured = serializedEvents + serializedRequests
      const forwardTempRoot = tempRoot.replace(/\\/g, "/")
      const historyOrder = events.flatMap((event) => {
        if (event.type === "model.responded") {
          const payload = event.payload as { stepIndex: number }
          return [`model_turn_${payload.stepIndex}`]
        }
        if (event.type === "context.item_added") {
          const payload = event.payload as { item: { type: string } }
          if (payload.item.type === "tool_request" || payload.item.type === "tool_result") {
            return [payload.item.type]
          }
        }
        return []
      })
      const receivedToolResult = gateway.requests[1]?.items.find((item) => item.type === "tool_result")?.content

      expect(registry.snapshotId).toBe(ingested.snapshotId)
      expect(result.state).toBe("completed")
      expect(result.output).toBe("Audit complete")
      expect(historyOrder).toEqual(["model_turn_1", "tool_request", "tool_result", "model_turn_2"])
      expect(receivedToolResult).toContain("// see /docs/spec.md")
      expect(await snapshot.listFiles({ snapshotId: ingested.snapshotId })).not.toContain("lib/x/.git/config")
      expect(captured).not.toContain(gitSecret)
      expect(captured).not.toContain(tempRoot)
      expect(captured).not.toContain(forwardTempRoot)
      // A drive letter must stand alone (\b) so JSON-escaped text such as "snapshot:\n" is not a false positive;
      // a real Windows path is JSON-escaped to C:\\ (two backslashes).
      expect(captured).not.toMatch(/\b[A-Za-z]:(?:\\\\|\/)/)
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })
})
