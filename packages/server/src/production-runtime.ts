import { lstat, readdir } from "node:fs/promises"
import { PostgresRunStore } from "@harness/schema"
import { FOUNDRY_IMAGE, spawnDocker } from "./docker-foundry-sandbox"
import { ApiCompatibility, isAuthorizedLocalRequest, isLoopbackHost } from "./runtime-security"
import { createKeychainCredentialProvider } from "./keychain-credential"
import { startCheckedLocalServer } from "./production-startup"

export const assertProductionJudgeConfig = <T extends { enablePocExecution?: boolean }>(config: T): T & { enablePocExecution: false } => {
  if (config.enablePocExecution === true) throw new Error("PoC execution is disabled in the production runtime")
  return { ...config, enablePocExecution: false }
}

const productionJudgeConfig = assertProductionJudgeConfig({ enablePocExecution: false })

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
    capabilities: ["health", "api-version", "poc-execution-disabled", "bce-incomplete"],
    judgeExecution: "unavailable",
    enablePocExecution: productionJudgeConfig.enablePocExecution,
  })
  return Response.json({ error: { code: "unavailable", message: "Judge execution is not production-ready" } }, { status: 503 })
}

/** Starts a readiness-checked local health/API-compatibility endpoint; judging remains deliberately unavailable. */
export const startProductionLocalServer = async (options: {
  databaseUrl: string
  modelApiKey: string
  modelName: string
  providerName: string
  modelBaseUrl?: string
  snapshotDir: string
  hostname: string
  port: number
}) => {
  if (!isLoopbackHost(options.hostname)) throw new Error("Server must bind to loopback")
  if (!options.databaseUrl || !options.modelApiKey || !options.modelName || !options.providerName)
    throw new Error("Database and model configuration are required")
  if (!["openai", "anthropic", "google", "openrouter"].includes(options.providerName))
    throw new Error("Unsupported model provider")
  if (options.modelBaseUrl) {
    const baseUrl = new URL(options.modelBaseUrl)
    if (baseUrl.username || baseUrl.password) throw new Error("Model base URL must not contain credentials")
  }
  const store = new PostgresRunStore({ url: options.databaseUrl })
  try {
    const started = await startCheckedLocalServer(options, {
      checkSnapshot: () => assertSnapshotRoot(options.snapshotDir),
      async inspectImage() {
        const image = await spawnDocker(["docker", "image", "inspect", "--format", "{{index .RepoDigests 0}}", FOUNDRY_IMAGE], {
          signal: new AbortController().signal, timeout: 10_000, maxOutputBytes: 4096,
        })
        if (image.exitCode !== 0 || !image.stdout.trim().split("\n").includes(FOUNDRY_IMAGE))
          throw new Error("Pinned Foundry image is unavailable or digest does not match")
      },
      async pingDatabase() { await store.client.sql`select 1` },
      getCredential: () => createKeychainCredentialProvider().getOrCreate(),
      listen(hostname, port, fetch) { return Bun.serve({ hostname, port, fetch }) },
    })
    return { server: started.listener, async stop() { await started.stop(); await store.close() } }
  } catch (error) {
    await store.close()
    throw error
  }
}
