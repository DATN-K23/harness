import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { getMultiTurnExecutionSummary, SnapshotManager } from "@harness/core"
import { InMemoryRunStore } from "@harness/core/testing"
import { RealModelGateway } from "@harness/llm"
import type { RuntimeConfig } from "../src/config"
import { runCli } from "../src/index"
import { RecordingClient, readRecordingFixture } from "../../llm/test/support/recording-client"

const testEnv = (snapshotDir: string, overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  DATABASE_URL: "postgresql://harness:harness@127.0.0.1:5432/harness",
  PROVIDER_NAME: "openai",
  MODEL_NAME: "gpt-4o-mini",
  MODEL_API_KEY: "test-api-key-not-a-real-secret",
  MODEL_MAX_CONTEXT_TOKENS: "131072",
  HARNESS_SNAPSHOT_DIR: snapshotDir,
  ...overrides,
})

const makeGatewayFactory = (modelOverride?: string) => {
  const clients: RecordingClient[] = []
  const gatewayFactory = (config: RuntimeConfig) => {
    const recording = new RecordingClient(readRecordingFixture("tool-call-then-answer"))
    clients.push(recording)
    return new RealModelGateway({
      apiKey: config.modelApiKey,
      model: modelOverride ?? config.modelName,
      outputTokensField: config.modelOutputTokensField,
      inputCostPerMTok: config.modelInputCostPerMTok,
      outputCostPerMTok: config.modelOutputCostPerMTok,
      baseURL: config.modelBaseUrl,
      timeoutMs: config.modelTimeoutMs,
      client: recording.client,
      secrets: [config.modelApiKey],
    })
  }
  return { gatewayFactory, clients }
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "harness-cli-snapshot-"))
}

async function makeSnapshot(sourceRoot: string, storageDir: string, snapshotId = "snap_cli_test") {
  await fs.mkdir(path.join(sourceRoot, "src"), { recursive: true })
  await fs.writeFile(path.join(sourceRoot, "src", "Vault.sol"), "contract Vault { uint256 public value; }\n", "utf8")
  return SnapshotManager.ingestRepository({ sourceDir: sourceRoot, storageDir, snapshotId })
}

async function treeStat(root: string): Promise<Array<{ path: string; mtimeMs: number; size: number }>> {
  const result: Array<{ path: string; mtimeMs: number; size: number }> = []
  const visit = async (directory: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const stat = await fs.stat(absolute)
      const relative = path.relative(root, absolute).replaceAll("\\", "/")
      result.push({ path: relative, mtimeMs: stat.mtimeMs, size: stat.size })
      if (entry.isDirectory()) await visit(absolute)
    }
  }
  await visit(root)
  return result.sort((left, right) => left.path.localeCompare(right.path))
}

describe("snapshot CLI commands", () => {
  test("Register a repository without changing its source tree", async () => {
    const root = await makeTempDir()
    const source = path.join(root, "source")
    const storage = path.join(root, "snapshots")
    try {
      await fs.mkdir(path.join(source, "src"), { recursive: true })
      await fs.writeFile(path.join(source, "src", "Vault.sol"), "contract Vault {}\n", "utf8")
      await fs.writeFile(path.join(source, ".env"), "MODEL_API_KEY=placeholder\n", "utf8")
      const before = await treeStat(source)
      const output: string[] = []
      const errors: string[] = []
      const exitCode = await runCli(["repo", "add", source], {
        snapshotDir: storage,
        stdout: (message) => output.push(message),
        stderr: (message) => errors.push(message),
      })
      const after = await treeStat(source)
      if (exitCode !== 0) throw new Error(`errors=${errors.join("\n")} output=${output.join("\n")}`)
      expect(exitCode).toBe(0)
      expect(errors).toEqual([])
      expect(output.join("\n")).toContain("Snapshot ID: snap_")
      expect(output.join("\n")).toContain("Files: 1")
      expect(output.join("\n")).toContain("denied=1")
      expect(after).toEqual(before)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("refuses snapshot storage inside the source repository", async () => {
    const root = await makeTempDir()
    const source = path.join(root, "source")
    const storage = path.join(source, "data", "snapshots")
    try {
      await fs.mkdir(path.join(source, "src"), { recursive: true })
      await fs.writeFile(path.join(source, "src", "Vault.sol"), "contract Vault {}\n", "utf8")
      const before = await treeStat(source)
      const errors: string[] = []
      const exitCode = await runCli(["repo", "add", source], {
        snapshotDir: storage,
        stderr: (message) => errors.push(message),
      })
      expect(exitCode).toBe(1)
      expect(errors.join("\n")).toContain("snapshot storage must be outside")
      expect(await treeStat(source)).toEqual(before)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("List snapshots with manifest metadata", async () => {
    const root = await makeTempDir()
    try {
      const source = path.join(root, "source")
      const storage = path.join(root, "snapshots")
      await makeSnapshot(source, storage)
      const output: string[] = []
      const exitCode = await runCli(["snapshot", "list"], {
        snapshotDir: storage,
        stdout: (message) => output.push(message),
      })
      expect(exitCode).toBe(0)
      expect(output.join("\n")).toContain("Snapshot ID: snap_cli_test")
      expect(output.join("\n")).toContain("Files: 1")
      expect(output.join("\n")).toContain("Tree digest: sha256:")
      expect(output.join("\n")).toContain("Ingestion policy version: ingest-policy-v2")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe("snapshot-backed CLI runs", () => {
  test("SIGINT aborts a provider request and persists user cancellation", async () => {
    const root = await makeTempDir()
    try {
      const storage = path.join(root, "snapshots")
      await makeSnapshot(path.join(root, "source"), storage)
      const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
      const signals = new EventEmitter()
      const output: string[] = []
      const pending = runCli(["run", "--snapshot", "snap_cli_test", "--prompt", "Summarise Vault"], {
        env: testEnv(storage),
        storeFactory: () => store,
        processSignals: signals,
        gatewayFactory: () => ({
          async executeAttempt(_request, signal) {
            await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }))
            return { attemptId: "aborted", finishReason: "error", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }, latencyMs: 1, error: { category: "transport", message: "aborted", isRetryable: true } }
          },
        }),
        stdout: (message) => output.push(message),
      })
      setTimeout(() => signals.emit("SIGINT"), 0)
      const exitCode = await pending
      const runId = output.join("\n").match(/Run ID:\s+(\S+)/)?.[1]
      const events = runId ? await store.loadEvents({ runId }) : []
      expect(exitCode).toBe(1)
      expect(events.some((event) => event.type === "run.cancelled" && event.payload.reason === "cancelled_by_user")).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("Model reads a file and answers", async () => {
    const root = await makeTempDir()
    try {
      const storage = path.join(root, "snapshots")
      await makeSnapshot(path.join(root, "source"), storage)
      const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
      const { gatewayFactory, clients } = makeGatewayFactory()
      const output: string[] = []
      const errors: string[] = []
      const exitCode = await runCli(["run", "--snapshot", "snap_cli_test", "--prompt", "Summarise Vault"], {
        env: testEnv(storage),
        storeFactory: () => store,
        gatewayFactory,
        stdout: (message) => output.push(message),
        stderr: (message) => errors.push(message),
      })
      expect(exitCode).toBe(0)
      expect(errors).toEqual([])
      expect(output.join("\n")).toContain("State:        completed")
      expect(output.join("\n")).toContain("Tool calls:   1")
      expect(output.join("\n")).toContain("checks-effects-interactions")
      expect(output.join("\n")).toContain("Tokens:")
      expect(clients[0]?.callCount).toBe(2)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("Unknown snapshot is refused before the provider is created", async () => {
    const root = await makeTempDir()
    try {
      const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
      let gatewayCalls = 0
      let storeCalls = 0
      const errors: string[] = []
      const exitCode = await runCli(["run", "--snapshot", "snap_missing", "--prompt", "x"], {
        env: testEnv(path.join(root, "snapshots")),
        storeFactory: () => {
          storeCalls += 1
          return store
        },
        gatewayFactory: () => {
          gatewayCalls += 1
          throw new Error("gateway must not be constructed")
        },
        stderr: (message) => errors.push(message),
      })
      expect(exitCode).toBe(1)
      expect(errors.join("\n")).toContain("Snapshot snap_missing not found")
      expect(gatewayCalls).toBe(0)
      expect(storeCalls).toBe(0)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("Run flags override configured limits and provider settings are persisted", async () => {
    const root = await makeTempDir()
    try {
      const storage = path.join(root, "snapshots")
      await makeSnapshot(path.join(root, "source"), storage)
      const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
      const { gatewayFactory, clients } = makeGatewayFactory()
      const output: string[] = []
      const env = testEnv(storage, {
        HARNESS_MAX_STEPS: "3",
        HARNESS_MAX_TOOL_CALLS: "7",
        HARNESS_MAX_TOTAL_TOKENS: "50000",
      })
      const exitCode = await runCli([
        "run", "--snapshot", "snap_cli_test", "--prompt", "Summarise Vault",
        "--max-steps", "5", "--max-tool-calls", "2", "--max-output-tokens", "77",
        "--max-total-tokens", "60000", "--timeout", "10000",
      ], {
        env,
        storeFactory: () => store,
        gatewayFactory,
        stdout: (message) => output.push(message),
      })
      expect(exitCode).toBe(0)
      expect(clients[0]?.requests[0]?.max_tokens).toBe(77)
      const runId = output.join("\n").match(/Run ID:\s+(\S+)/)?.[1]
      expect(runId).toBeDefined()
      const summary = await getMultiTurnExecutionSummary(runId!, store)
      expect(summary?.limits).toMatchObject({
        wallClockTimeoutMs: 10_000,
        maxSteps: 5,
        maxToolCalls: 2,
        totalTokenBudget: 60_000,
      })
      const started = summary?.events.find((event) => event.type === "run.started")
      expect((started?.payload as { providerProfile?: { outputTokensField?: string; maxContextTokens?: number; maxOutputTokens?: number }; requestOptions?: { maxOutputTokens?: number } }).providerProfile)
        .toMatchObject({ outputTokensField: "max_tokens", maxContextTokens: 131072, maxOutputTokens: 4096 })
      expect((started?.payload as { requestOptions?: { maxOutputTokens?: number } }).requestOptions?.maxOutputTokens).toBe(77)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("unpriced cost is printed as unknown without a cost-ceiling warning", async () => {
    const root = await makeTempDir()
    try {
      const storage = path.join(root, "snapshots")
      await makeSnapshot(path.join(root, "source"), storage)
      const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
      const { gatewayFactory } = makeGatewayFactory()
      const output: string[] = []
      const exitCode = await runCli(["run", "--snapshot", "snap_cli_test", "--prompt", "Summarise Vault"], {
        env: testEnv(storage, { MODEL_NAME: "cx/gpt-6-luna" }),
        storeFactory: () => store,
        gatewayFactory,
        stdout: (message) => output.push(message),
      })
      expect(exitCode).toBe(0)
      expect(output.join("\n")).toContain("Cost:         unknown")
      expect(output.join("\n")).not.toContain("cost budget is not enforced")
      expect(output.join("\n")).not.toContain("$0.000000")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("Missing key does not silently create a mock run", async () => {
    const root = await makeTempDir()
    try {
      const storage = path.join(root, "snapshots")
      await makeSnapshot(path.join(root, "source"), storage)
      const env = testEnv(storage)
      delete env.MODEL_API_KEY
      let storesCreated = 0
      let gatewaysCreated = 0
      const errors: string[] = []
      const exitCode = await runCli(["run", "--snapshot", "snap_cli_test", "--prompt", "x"], {
        env,
        storeFactory: () => {
          storesCreated += 1
          return new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
        },
        gatewayFactory: () => {
          gatewaysCreated += 1
          throw new Error("mock fallback must not run")
        },
        stderr: (message) => errors.push(message),
      })
      expect(exitCode).toBe(1)
      expect(errors.join("\n")).toContain("MODEL_API_KEY")
      expect(storesCreated).toBe(0)
      expect(gatewaysCreated).toBe(0)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("--mock snapshot run calls read_file on the first file", async () => {
    const root = await makeTempDir()
    try {
      const storage = path.join(root, "snapshots")
      await makeSnapshot(path.join(root, "source"), storage)
      const output: string[] = []
      const errors: string[] = []
      const exitCode = await runCli(["run", "--snapshot", "snap_cli_test", "--prompt", "Read the source", "--mock"], {
        snapshotDir: storage,
        stdout: (message) => output.push(message),
        stderr: (message) => errors.push(message),
      })
      expect(exitCode).toBe(0)
      expect(errors).toEqual([])
      expect(output.join("\n")).toContain("Tool calls:   1")
      expect(output.join("\n")).toContain("Mock run read a file")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("View a multi-turn run from a new invocation", async () => {
    const root = await makeTempDir()
    try {
      const storage = path.join(root, "snapshots")
      await makeSnapshot(path.join(root, "source"), storage)
      const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
      const { gatewayFactory } = makeGatewayFactory()
      const deps = {
        env: testEnv(storage),
        storeFactory: () => store,
        gatewayFactory,
      }
      const runOutput: string[] = []
      const runExitCode = await runCli(["run", "--snapshot", "snap_cli_test", "--prompt", "Summarise Vault"], {
        ...deps,
        stdout: (message) => runOutput.push(message),
      })
      const runId = runOutput.join("\n").match(/Run ID:\s+(\S+)/)?.[1]
      expect(runExitCode).toBe(0)
      expect(runId).toBeDefined()

      const viewOutput: string[] = []
      const viewExitCode = await runCli(["view", "--id", runId!], {
        ...deps,
        stdout: (message) => viewOutput.push(message),
      })
      expect(viewExitCode).toBe(0)
      expect(viewOutput.join("\n")).toContain("Snapshot ID:  snap_cli_test")
      expect(viewOutput.join("\n")).toContain("Step 1 attempt 1")
      expect(viewOutput.join("\n")).toContain("Step 2 attempt 1")
      expect(viewOutput.join("\n")).toContain("Tool read_file: completed")
      expect(viewOutput.join("\n")).toContain("contract Vault")

      const jsonOutput: string[] = []
      const jsonExitCode = await runCli(["view", "--id", runId!, "--json"], {
        ...deps,
        stdout: (message) => jsonOutput.push(message),
      })
      expect(jsonExitCode).toBe(0)
      const jsonSummary = JSON.parse(jsonOutput.join("\n"))
      expect(jsonSummary.snapshotId).toBe("snap_cli_test")
      expect(jsonSummary.promptDigest).toMatch(/^sha256:/)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
