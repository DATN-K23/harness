import { lstat, readdir } from "node:fs/promises"
import { realpath } from "node:fs/promises"
import { createIdGenerator, DiskSourceSnapshot, ProductionContextEngine, ProductionSecurityFilter, SnapshotIngestion, SnapshotManager, ToolRegistry, createO200kTokenizer, systemIdSources } from "@harness/core"
import type { JudgeRunConfig } from "@harness/core"
import { DefaultRetryConfig } from "@harness/protocol"
import { RealModelGateway } from "@harness/llm/gateway"
import { PostgresRunStore } from "@harness/schema"
import { spawnDocker } from "./docker-foundry-sandbox"
import { ApiCompatibility, isAuthorizedLocalRequest, isLoopbackHost } from "./runtime-security"
import { createKeychainCredentialProvider } from "./keychain-credential"
import { startCheckedLocalServer } from "./production-startup"
import { createJudgeRuntime } from "./judge-runtime"
import { ConservativePocPolicy } from "./poc-policy"
import { DockerFoundrySandbox } from "./docker-foundry-sandbox"
import { PostgresCancellation } from "@harness/schema"
import type { ClockPort, ModelGatewayPort, RandomPort, SleepPort, SourceSnapshotPort } from "@harness/protocol"
import { startPollingWorker } from "./worker-lifecycle"

export const assertProductionJudgeConfig = <T extends { enablePocExecution?: boolean }>(config: T): T & { enablePocExecution: false } => {
  if (config.enablePocExecution === true) throw new Error("PoC execution is disabled in the production runtime")
  return { ...config, enablePocExecution: false }
}

const productionJudgeConfig = assertProductionJudgeConfig({ enablePocExecution: false })

export const resolveProductionSnapshot = async (storageDir: string, snapshotId: string) => {
  const root = await realpath(storageDir)
  const manifest = await SnapshotManager.loadSnapshotManifest(root, snapshotId)
  const snapshot = new DiskSourceSnapshot({ storageDir: root, snapshotId, manifest })
  if ((await snapshot.listFiles({ snapshotId })).length === 0) throw new Error("Snapshot is empty")
  return snapshot
}

class ProductionSnapshotResolver implements SourceSnapshotPort {
  constructor(private readonly storageDir: string) {}
  async listFiles(input: { snapshotId: string; directory?: string }, signal?: AbortSignal) {
    return (await resolveProductionSnapshot(this.storageDir, input.snapshotId)).listFiles(input, signal)
  }
  async readLines(input: Parameters<SourceSnapshotPort["readLines"]>[0], signal?: AbortSignal) {
    return (await resolveProductionSnapshot(this.storageDir, input.snapshotId)).readLines(input, signal)
  }
}

export const resolveProductionProvider = (input: { providerName: string; apiKey: string; model?: string; baseURL?: string }) => {
  if (input.providerName !== "openai" && !input.baseURL)
    throw new Error(`${input.providerName} requires an explicit OpenAI-compatible base URL`)
  if (input.baseURL) {
    const parsed = new URL(input.baseURL)
    const routerLoopback = input.providerName === "9router" && parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    if (parsed.protocol !== "https:" && !routerLoopback) throw new Error("Model base URL must use HTTPS except for 9router on loopback")
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error("Model base URL must not contain credentials")
    if (input.providerName === "9router" && parsed.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))
      throw new Error("9router HTTP base URL must use loopback only")
    if (input.providerName === "openai" && parsed.hostname !== "api.openai.com")
      throw new Error("OpenAI base URL must use only api.openai.com")
    if (input.providerName !== "openai" && parsed.hostname === "api.openai.com")
      throw new Error("third-party provider configuration requires a provider-specific OpenAI-compatible base URL")
    return { apiKey: input.apiKey, model: input.model ?? "model", baseURL: parsed.toString() }
  }
  return { apiKey: input.apiKey, model: input.model ?? "model", baseURL: "https://api.openai.com/v1" }
}

export const makeProductionJudgeConfig = (runtime: {
  providerName: string; modelName: string; modelBaseUrl?: string; modelTimeoutMs?: number;
  modelInputCostPerMTok?: number
  modelOutputCostPerMTok?: number
  modelMaxOutputTokens?: number
  maxSteps?: number
  totalTokenBudget?: number
  wallClockTimeoutMs?: number
}): JudgeRunConfig => {
  const maxOutputTokens = runtime.modelMaxOutputTokens ?? 4096
  const flags = {
    enableToolTruncation: true, enableObsMasking: true, enableSupersedeReads: true, enableDropEmpty: true,
    enableLlmCompaction: true, enableSessionNote: false, enableSchemaRepair: true, enableMaxStepsForcing: true,
    enableNoProgressDetection: true, enableInfraRetry: true, enableParallelToolDispatch: true,
  }
  const policy = {
    policyVersion: "judge-local-v1", windowLimitTokens: 100_000, outputReserveTokens: maxOutputTokens,
    compactionThreshold: 0.8, safetyMarginFactor: 1.2, recentWindowTokens: 10_000,
    toolOutputMaxTokens: 4_000, toolOutputMaxLines: 50, maxCompactions: 2,
    flags: { enableToolTruncation: true, enableObsMasking: true, enableSupersedeReads: true,
      enableDropEmpty: true, enableLlmCompaction: true, enableSessionNote: false },
  }
  return deepFreeze({ flags, policy, retry: { ...DefaultRetryConfig, retryableStatuses: [...DefaultRetryConfig.retryableStatuses] },
    limits: {
      wallClockTimeoutMs: runtime.wallClockTimeoutMs ?? 300_000,
      totalTokenBudget: runtime.totalTokenBudget ?? 200_000,
      maxSteps: runtime.maxSteps ?? 10,
      noProgressMaxRepeats: 3,
    },
    maxProbeRuns: 0, enablePocExecution: false,
    // Real reports (Sherlock, Code4rena, Hound …) rarely use the harness template; one extraction call locates the
    // claim fields before a finding is declared unresolved.
    enableClaimExtraction: true,
    modelLimits: { maxContextTokens: 128_000, maxOutputTokens, safetyMarginFactor: 1.2 }, profileId: runtime.modelName,
    runtime: { providerName: runtime.providerName, modelName: runtime.modelName, baseURL: runtime.modelBaseUrl,
      timeoutMs: runtime.modelTimeoutMs ?? 30_000, inputCostPerMTok: runtime.modelInputCostPerMTok,
      outputCostPerMTok: runtime.modelOutputCostPerMTok, profileVersion: "judge-local-v1",
      ingestionVersion: "snapshot-ingestion-solc-0.8.30", sandboxMode: "disabled", maxContextTokens: 128_000,
      maxOutputTokens, solidityCompilerVersion: "solc-js-0.8.30", foundryImage: "ghcr.io/foundry-rs/foundry@sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c" } })
}

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

const systemClock: ClockPort = { nowMs: () => Date.now() }
const systemRandom: RandomPort = { next: () => Math.random() }
const systemSleep: SleepPort = { sleep: (ms, signal) => new Promise<void>((resolveSleep) => {
  if (signal?.aborted) return resolveSleep()
  const timer = setTimeout(resolveSleep, ms)
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolveSleep() }, { once: true })
}) }

const assertSnapshotRoot = async (root: string) => {
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Snapshot root must be a real directory")
  await readdir(root)
}

export const createProductionHealthHandler = (credential: string) => async (request: Request) => {
  if (!isAuthorizedLocalRequest(request, credential))
    return Response.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 })
  const url = new URL(request.url)
  if (request.method === "GET" && url.pathname === "/v1/health") return Response.json({
    endpointId: "harness-local-runtime",
    apiVersion: ApiCompatibility.apiVersion,
    buildVersion: String(process.env.HARNESS_BUILD_VERSION ?? "1"),
    capabilities: ["health", "api-version", "judge-submission", "worker", "poc-execution-disabled", "bce-incomplete"],
    judgeExecution: "unverified-only",
    enablePocExecution: productionJudgeConfig.enablePocExecution,
  })
  return Response.json({ error: { code: "unavailable", message: "Judge execution is not production-ready" } }, { status: 503 })
}

interface ProductionStartupOperations {
  createStore(databaseUrl: string): PostgresRunStore
  resolveSnapshotRoot(snapshotDir: string): Promise<string>
  startCheckedLocalServer: typeof startCheckedLocalServer
  getCredential?(): Promise<string>
  createGateway?(): ModelGatewayPort
}

const productionStartupOperations: ProductionStartupOperations = {
  createStore: (databaseUrl) => new PostgresRunStore({ url: databaseUrl }),
  resolveSnapshotRoot: realpath,
  startCheckedLocalServer,
}

/** Starts the loopback API and polling worker over real local adapters; outcomes remain unverified while BCE is incomplete. */
export const startProductionLocalServer = async (options: {
  databaseUrl: string
  modelApiKey: string
  modelName: string
  providerName: string
  modelBaseUrl?: string
  modelTimeoutMs?: number
  modelMaxOutputTokens?: number
  modelInputCostPerMTok?: number
  modelOutputCostPerMTok?: number
  maxSteps?: number
  totalTokenBudget?: number
  wallClockTimeoutMs?: number
  snapshotDir: string
  hostname: string
  port: number
}) => startProductionLocalServerWithOperations(options, productionStartupOperations)

/** Internal startup seam for verifying preflight ordering without infrastructure. */
export const startProductionLocalServerWithOperations = async (options: {
  databaseUrl: string
  modelApiKey: string
  modelName: string
  providerName: string
  modelBaseUrl?: string
  modelTimeoutMs?: number
  modelMaxOutputTokens?: number
  modelInputCostPerMTok?: number
  modelOutputCostPerMTok?: number
  maxSteps?: number
  totalTokenBudget?: number
  wallClockTimeoutMs?: number
  snapshotDir: string
  hostname: string
  port: number
}, operations: ProductionStartupOperations) => {
  if (!isLoopbackHost(options.hostname)) throw new Error("Server must bind to loopback")
  if (!options.databaseUrl || !options.modelApiKey || !options.modelName || !options.providerName)
    throw new Error("Database and model configuration are required")
  if (!["openai", "openrouter", "9router"].includes(options.providerName))
    throw new Error("Unsupported model provider")
  const providerConfig = resolveProductionProvider({ providerName: options.providerName, apiKey: options.modelApiKey,
    model: options.modelName, baseURL: options.modelBaseUrl })
  const validatedOptions = { ...options, modelBaseUrl: providerConfig.baseURL }
  const store = operations.createStore(options.databaseUrl)
  try {
    const snapshotRoot = await operations.resolveSnapshotRoot(options.snapshotDir)
    const started = await operations.startCheckedLocalServer(options, {
      checkSnapshot: () => assertSnapshotRoot(options.snapshotDir),
      async pingDatabase() { await store.client.sql`select 1` },
      getCredential: () => operations.getCredential?.() ?? createKeychainCredentialProvider().getOrCreate(),
      listen(hostname, port, _fetch, credential) {
        const config = makeProductionJudgeConfig(validatedOptions)
        const ids = createIdGenerator(systemIdSources)
        const runtime = createJudgeRuntime({
          store,
          snapshots: new ProductionSnapshotResolver(snapshotRoot),
          ids, workerId: ids.next("worker_"), config,
          cursorSecret: ids.next("cursor_"), credential,
          async runnerDeps(_claim, runId) {
            const run = await store.loadRun(runId)
            if (!run?.snapshotId) throw new Error("admitted Judge snapshot is missing")
            const snapshot: SourceSnapshotPort = new ProductionSnapshotResolver(snapshotRoot)
            const gateway = operations.createGateway?.() ?? new RealModelGateway({ ...providerConfig,
              timeoutMs: options.modelTimeoutMs, secrets: [options.modelApiKey], inputCostPerMTok: options.modelInputCostPerMTok,
              outputCostPerMTok: options.modelOutputCostPerMTok })
            return { gateway, contextEngine: new ProductionContextEngine(createO200kTokenizer()), snapshot,
              tools: new ToolRegistry({ snapshot, snapshotId: run.snapshotId, secrets: [options.modelApiKey] }),
              security: new ProductionSecurityFilter(), ingestion: new SnapshotIngestion({ source: snapshot }),
              sanitizer: new ConservativePocPolicy({ compilerAvailable: false }),
              sandbox: new DockerFoundrySandbox(spawnDocker, snapshot, { root: "" }, { enabled: false }),
              cancellation: new PostgresCancellation(store.client), clock: systemClock, random: systemRandom, sleep: systemSleep, ids,
              }
          },
        })
        const health = createProductionHealthHandler(credential)
        const server = Bun.serve({ hostname, port, fetch: (request) =>
          request.method === "GET" && new URL(request.url).pathname === "/v1/health" ? health(request) : runtime.api.fetch(request) })
        const worker = startPollingWorker(() => runtime.worker.runOnce(), 250, 5_000, () => store.close())
        return { hostname: server.hostname, port: server.port, async stop() { await worker.stop(); server.stop(true) } }
      },
    })
    return { server: started.listener, async stop() { await started.stop() } }
  } catch (error) {
    await store.close()
    throw error
  }
}
