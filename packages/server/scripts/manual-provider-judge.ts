import { randomUUID } from "node:crypto"
import { createKeychainCredentialProvider } from "../src/keychain-credential"
import { startProductionLocalServer } from "../src/production-runtime"
import { loadRuntimeConfig } from "../../cli/src/config"
import { manualProviderResultSummary } from "./manual-provider-result-summary"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const env = process.env
const rootEnv = `${process.cwd()}/.env`
if (await Bun.file(rootEnv).exists()) {
  const { applyEnvFile } = await import("../../cli/src/config")
  applyEnvFile(await Bun.file(rootEnv).text(), env)
}
const config = loadRuntimeConfig(env)
const manualDatabaseUrl = env.HARNESS_MANUAL_JUDGE_DATABASE_URL
assert(manualDatabaseUrl, "HARNESS_MANUAL_JUDGE_DATABASE_URL must name the disposable database")
const selectedDatabase = new URL(manualDatabaseUrl)
const configuredDatabase = new URL(config.databaseUrl)
assert(`${selectedDatabase.hostname}:${selectedDatabase.port || "5432"}${selectedDatabase.pathname}` !== `${configuredDatabase.hostname}:${configuredDatabase.port || "5432"}${configuredDatabase.pathname}`, "Manual database must differ from DATABASE_URL")
const snapshotId = env.HARNESS_MANUAL_JUDGE_SNAPSHOT_ID
assert(snapshotId, "HARNESS_MANUAL_JUDGE_SNAPSHOT_ID is required")
assert(env.HARNESS_MANUAL_JUDGE_DEDICATED === "1", "Set HARNESS_MANUAL_JUDGE_DEDICATED=1 for a disposable database")
assert(config.providerName === "9router", "Manual provider test requires 9router")
const database = selectedDatabase
assert(["localhost", "127.0.0.1", "::1"].includes(database.hostname), "Manual test database must be loopback")
assert(database.pathname.length > 1 && /manual|e2e|test|disposable/i.test(database.pathname), "Database name must identify a disposable test database")
if (env.HARNESS_PRODUCTION_DATABASE_URL) {
  const production = new URL(env.HARNESS_PRODUCTION_DATABASE_URL)
  assert(`${production.hostname}:${production.port || "5432"}${production.pathname}` !== `${database.hostname}:${database.port || "5432"}${database.pathname}`, "Refusing a production database identity")
}

const started = await startProductionLocalServer({
  databaseUrl: manualDatabaseUrl,
  modelApiKey: config.modelApiKey,
  modelName: config.modelName,
  providerName: config.providerName,
  modelBaseUrl: config.modelBaseUrl,
  modelTimeoutMs: 60_000,
  modelMaxOutputTokens: 512,
  maxSteps: 8,
  totalTokenBudget: 64_000,
  wallClockTimeoutMs: 360_000,
  snapshotDir: config.snapshotDir,
  hostname: "127.0.0.1",
  port: 0,
})

const credential = await createKeychainCredentialProvider().getOrCreate()
const headers = { authorization: `Bearer ${credential}` }
const api = `http://127.0.0.1:${started.server.port}`
let runId = ""
try {
  const response = await fetch(`${api}/v1/judge/runs`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "idempotency-key": `manual-provider-${randomUUID()}` },
    body: JSON.stringify({
      finding: {
        findingId: `manual-${randomUUID()}`,
        reportMarkdown: "Target: Vault.withdraw\nRoot cause: withdraw checks and subtracts the caller balance before sending assets.\nAttack scenario: a caller withdraws no more than their recorded balance.\nImpact: the report claims an unauthorized loss of vault assets.\nState: balances[msg.sender] and the vault asset balance.",
      },
      snapshotId,
    }),
  })
  assert(response.status === 202, `Submission rejected with HTTP ${response.status}`)
  runId = (await response.json() as { runId: string }).runId
  let status: { state: string; terminalReason?: string; errorCategory?: string; errorMessage?: string; verdict?: { validity?: string; verificationStatus?: string } } | undefined
  const deadline = Date.now() + 380_000
  do {
    const result = await fetch(`${api}/v1/judge/runs/${encodeURIComponent(runId)}`, { headers })
    assert(result.ok, `Status polling returned HTTP ${result.status}`)
    status = await result.json() as typeof status
    if (status?.state === "completed" || status?.state === "failed") break
    await Bun.sleep(250)
  } while (Date.now() < deadline)
  const eventsResponse = await fetch(`${api}/v1/judge/runs/${encodeURIComponent(runId)}/events`, { headers })
  assert(eventsResponse.ok, `Event query returned HTTP ${eventsResponse.status}`)
  const events: Array<{ type: string; payload: Record<string, unknown> }> = (await eventsResponse.json() as { events: typeof events }).events
  const summary = manualProviderResultSummary(status ?? { state: "unknown" }, events)
  console.log(JSON.stringify({ providerStatus: "observed", runId, ...summary }))
  assert(status?.state === "completed", `Run did not complete (state: ${status?.state ?? "unknown"})`)
  assert(status.verdict?.validity === "unverified" && status.verdict.verificationStatus === "UNVERIFIED", "Run did not terminate UNVERIFIED")
  const attempts = events.filter((event) => event.type === "provider.attempted")
  assert(attempts.length > 0, "No provider attempts were recorded")
  const usage = attempts.reduce((sum, event) => {
    const tokenUsage = event.payload.usage as { promptTokens?: number; completionTokens?: number } | null
    return { input: sum.input + (tokenUsage?.promptTokens ?? 0), output: sum.output + (tokenUsage?.completionTokens ?? 0) }
  }, { input: 0, output: 0 })
  const endpoint = new URL(config.modelBaseUrl ?? "https://api.openai.com/v1").hostname
  console.log(JSON.stringify({ providerStatus: "live-success", endpoint, attempts: attempts.length, tokenUsage: usage, verdict: "UNVERIFIED" }))
} catch (error) {
  const message = error instanceof Error ? error.message : ""
  if (runId) {
    try {
      const errRes = await fetch(`${api}/v1/judge/runs/${encodeURIComponent(runId)}`, { headers })
      const errJson = await errRes.json() as Record<string, unknown>
      if (errJson.errorMessage) console.log("Run errorMessage:", errJson.errorMessage)
    } catch {}
  }
  const category = /authentication|unauthorized|401|403/i.test(message) ? "authentication"
    : /rate.?limit|429/i.test(message) ? "rate_limit"
    : /timeout|network|fetch|url|connect/i.test(message) ? "transport"
    : "execution"
  console.log(JSON.stringify({ providerStatus: "failed", category, runId: runId || undefined }))
  process.exitCode = 1
} finally {
  await started.stop()
}
