import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdGenerator, createO200kTokenizer, DiskSourceSnapshot, ProductionContextEngine, ProductionSecurityFilter, SnapshotIngestion, SnapshotManager, ToolRegistry } from "@harness/core"
import type { ModelAttemptRequest, ModelAttemptResponse, ModelGatewayPort } from "@harness/protocol"
import { PostgresCancellation, PostgresRunStore, runMigrations } from "@harness/schema"
import { ConservativePocPolicy } from "../src/poc-policy"
import { DockerFoundrySandbox, spawnDocker } from "../src/docker-foundry-sandbox"
import { createJudgeRuntime } from "../src/judge-runtime"
import { makeProductionJudgeConfig, startProductionLocalServerWithOperations } from "../src/production-runtime"

// Never fall back to DATABASE_URL: this test changes schema state and requires an explicitly dedicated database.
const testDatabaseUrl = process.env.HARNESS_POSTGRES_E2E_DATABASE_URL
const enabled = process.env.HARNESS_POSTGRES_E2E === "1"

const checkPostgresReachable = async (
  url: string,
  createStore: (url: string) => PostgresRunStore = (url) => new PostgresRunStore({ url }),
): Promise<boolean> => {
  let store: PostgresRunStore | undefined
  try {
    store = createStore(url)
    await store.client.sql`SELECT 1`
    return true
  } catch {
    return false
  } finally {
    await store?.close().catch(() => {})
  }
}

test("PostgreSQL E2E rejects a shared target even when disposable-database acknowledgement is present", () => {
  const env = {
    HARNESS_POSTGRES_E2E: "1",
    HARNESS_POSTGRES_E2E_DEDICATED: "1",
    HARNESS_POSTGRES_E2E_DATABASE_URL: "postgres://shared/db",
    DATABASE_URL: "postgres://shared/db",
  }
  expect(() => assertDedicatedPostgresTarget(env)).toThrow("must not equal DATABASE_URL")
})

test.each([
  ["postgres://user:one@db.example.test/app", "postgresql://user:two@db.example.test:5432/app?sslmode=require"],
  ["postgres://user:one@db.example.test/app", "postgres://user:two@DB.EXAMPLE.TEST:5432/app?application_name=other"],
])("PostgreSQL E2E rejects equivalent target identities (%s vs %s)", (runtimeUrl, e2eUrl) => {
  expect(() => assertDedicatedPostgresTarget({
    HARNESS_POSTGRES_E2E: "1",
    HARNESS_POSTGRES_E2E_DEDICATED: "1",
    HARNESS_POSTGRES_E2E_DATABASE_URL: e2eUrl,
    DATABASE_URL: runtimeUrl,
  })).toThrow("must not equal DATABASE_URL")
})

test("PostgreSQL E2E opt-in requires dedicated disposable database acknowledgement", () => {
  expect(() => assertDedicatedPostgresTarget({ HARNESS_POSTGRES_E2E: "1", HARNESS_POSTGRES_E2E_DATABASE_URL: "postgres://dedicated/db" }))
    .toThrow("HARNESS_POSTGRES_E2E_DEDICATED=1")
})

test("PostgreSQL reachability probe closes its store when the query fails", async () => {
  let closed = false
  const store = {
    client: { sql: async () => { throw new Error("query failed") } },
    close: async () => { closed = true },
  } as unknown as PostgresRunStore

  expect(await checkPostgresReachable("postgres://unused", () => store)).toBe(false)
  expect(closed).toBe(true)
})

export function assertDedicatedPostgresTarget(env: Record<string, string | undefined>) {
  if (env.HARNESS_POSTGRES_E2E !== "1") return
  if (!env.HARNESS_POSTGRES_E2E_DATABASE_URL) throw new Error("HARNESS_POSTGRES_E2E_DATABASE_URL is required when HARNESS_POSTGRES_E2E=1; DATABASE_URL is never used")
  if (env.DATABASE_URL && samePostgresTarget(env.HARNESS_POSTGRES_E2E_DATABASE_URL, env.DATABASE_URL)) {
    throw new Error("HARNESS_POSTGRES_E2E_DATABASE_URL must not equal DATABASE_URL target identity")
  }
  if (env.HARNESS_POSTGRES_E2E_DEDICATED !== "1") {
    throw new Error("HARNESS_POSTGRES_E2E_DEDICATED=1 is required; the operator must confirm this is a dedicated disposable database (software cannot prove disposability)")
  }
}

function samePostgresTarget(left: string, right: string): boolean {
  const identity = (value: string) => {
    try {
      const url = new URL(value)
      if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return undefined
      return JSON.stringify([
        url.hostname.toLowerCase(),
        url.port || "5432",
        decodeURIComponent(url.pathname.slice(1)),
        decodeURIComponent(url.username),
      ])
    } catch {
      return undefined
    }
  }
  const leftIdentity = identity(left)
  return leftIdentity !== undefined && leftIdentity === identity(right)
}

assertDedicatedPostgresTarget(process.env)

if (enabled && !await checkPostgresReachable(testDatabaseUrl!)) {
  throw new Error("HARNESS_POSTGRES_E2E_DATABASE_URL is unreachable while HARNESS_POSTGRES_E2E=1")
}

if (enabled) {
  describe("Judge runtime PostgreSQL composition", () => {
    test("serves a persisted UNVERIFIED run through the production listener without provider calls", async () => {
      await runMigrations({ url: testDatabaseUrl })
      const sourceRoot = await mkdtemp(join(tmpdir(), "harness-listener-source-"))
      const snapshotRoot = await mkdtemp(join(tmpdir(), "harness-listener-snapshots-"))
      const credential = "test-only-listener-credential"
      let providerCalls = 0

      try {
        await mkdir(join(sourceRoot, "src"))
        await writeFile(join(sourceRoot, "src", "Vault.sol"), "pragma solidity ^0.8.20; contract Vault {}\n")
        const ingested = await SnapshotManager.ingestRepository({ sourceDir: sourceRoot, storageDir: snapshotRoot, snapshotId: `listener-e2e-${crypto.randomUUID()}` })
        const server = await startProductionLocalServerWithOperations({
          databaseUrl: testDatabaseUrl!, modelApiKey: "test-only-model-secret", modelName: "test-model", providerName: "openai",
          modelBaseUrl: "https://api.openai.com/v1", snapshotDir: snapshotRoot, hostname: "127.0.0.1", port: 0,
        }, {
          createStore: (url) => new PostgresRunStore({ url }),
          resolveSnapshotRoot: async (dir) => dir,
          startCheckedLocalServer: (await import("../src/production-startup")).startCheckedLocalServer,
          getCredential: async () => credential,
          createGateway: () => ({ async executeAttempt(_request: ModelAttemptRequest): Promise<ModelAttemptResponse> { providerCalls++; throw new Error("provider must not be called for an unsupported report") } }),
        })
        try {
          const baseUrl = `http://${server.server.hostname}:${server.server.port}`
          const auth = { authorization: `Bearer ${credential}` }
          expect((await fetch(`${baseUrl}/v1/health`, { headers: auth })).status).toBe(200)
          expect((await fetch(`${baseUrl}/v1/judge/runs`, { method: "POST" })).status).toBe(401)
          const submit = await fetch(`${baseUrl}/v1/judge/runs`, { method: "POST", headers: { ...auth, "content-type": "application/json", "idempotency-key": `listener-e2e-${crypto.randomUUID()}` }, body: JSON.stringify({ finding: { findingId: "finding-listener-e2e", reportMarkdown: "Unsupported narrative." }, snapshotId: ingested.snapshotId }) })
          expect(submit.status).toBe(202)
          const { runId } = await submit.json() as { runId: string }
          let result: Response | undefined
          for (let attempt = 0; attempt < 40; attempt++) {
            result = await fetch(`${baseUrl}/v1/judge/runs/${runId}`, { headers: auth })
            if ((await result.clone().json() as { state: string }).state === "completed") break
            await Bun.sleep(50)
          }
          expect(result?.status).toBe(200)
          expect(await result?.json()).toMatchObject({ runId, state: "completed", verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" } })
          expect((await fetch(`${baseUrl}/v1/judge/runs/${runId}/events`, { headers: auth })).status).toBe(200)
          expect((await fetch(`${baseUrl}/v1/judge/runs/${runId}/cancel`, { method: "POST", headers: auth })).status).toBe(409)
          expect(providerCalls).toBe(0)
        } finally { await server.stop() }
      } finally {
        await rm(sourceRoot, { recursive: true, force: true })
        await rm(snapshotRoot, { recursive: true, force: true })
      }
    })

    test("completes an invalid report as UNVERIFIED without a provider request", async () => {
      await runMigrations({ url: testDatabaseUrl })
      const sourceRoot = await mkdtemp(join(tmpdir(), "harness-judge-source-"))
      const snapshotRoot = await mkdtemp(join(tmpdir(), "harness-judge-snapshots-"))
      const store = new PostgresRunStore({ url: testDatabaseUrl })
      let providerCalls = 0
      const gateway: ModelGatewayPort = {
        async executeAttempt(_request: ModelAttemptRequest): Promise<ModelAttemptResponse> {
          providerCalls++
          throw new Error("provider must not be called for an invalid report")
        },
      }

      try {
        await mkdir(join(sourceRoot, "src"))
        await writeFile(join(sourceRoot, "src", "Vault.sol"), "pragma solidity ^0.8.20; contract Vault {}\n")
        const ingested = await SnapshotManager.ingestRepository({
          sourceDir: sourceRoot,
          storageDir: snapshotRoot,
          snapshotId: `runtime-e2e-${crypto.randomUUID()}`,
        })
        const snapshots = new DiskSourceSnapshot({ storageDir: snapshotRoot, snapshotId: ingested.snapshotId, manifest: ingested.manifest })
        const ids = createIdGenerator({ clock: () => Date.now(), random: (size) => crypto.getRandomValues(new Uint8Array(size)) })
        const runtime = createJudgeRuntime({
          store: store as never,
          snapshots,
          ids,
          workerId: ids.next("worker_"),
          config: makeProductionJudgeConfig({ providerName: "openai", modelName: "test-model", modelBaseUrl: "https://api.openai.com/v1" }),
          cursorSecret: "postgres-e2e-cursor-secret",
          credential: "postgres-e2e-credential",
          async runnerDeps(_claim, runId) {
            const run = await store.loadRun(runId)
            if (!run?.snapshotId) throw new Error("admitted Judge snapshot is missing")
            return {
              gateway,
              contextEngine: new ProductionContextEngine(createO200kTokenizer()),
              snapshot: snapshots,
              tools: new ToolRegistry({ snapshot: snapshots, snapshotId: run.snapshotId }),
              security: new ProductionSecurityFilter(),
              ingestion: new SnapshotIngestion({ source: snapshots }),
              sanitizer: new ConservativePocPolicy({ compilerAvailable: false }),
              sandbox: new DockerFoundrySandbox(spawnDocker, snapshots, { root: "/nonexistent" }, { enabled: false }),
              cancellation: new PostgresCancellation(store.client),
              clock: { nowMs: () => Date.now() },
              random: { next: () => Math.random() },
              sleep: { sleep: async () => {} },
              ids,
            }
          },
        })

        const submit = await runtime.api.fetch(new Request("http://localhost/v1/judge/runs", {
          method: "POST",
          headers: { authorization: "Bearer postgres-e2e-credential", "content-type": "application/json", "idempotency-key": `postgres-e2e-${crypto.randomUUID()}` },
          body: JSON.stringify({ finding: { findingId: "finding-postgres-e2e", reportMarkdown: "This narrative has no supported report fields." }, snapshotId: ingested.snapshotId }),
        }))
        expect(submit.status).toBe(202)
        const { runId } = await submit.json() as { runId: string }
        expect(await runtime.worker.runOnce()).toBe(1)

        const result = await runtime.api.fetch(new Request(`http://localhost/v1/judge/runs/${runId}`, {
          headers: { authorization: "Bearer postgres-e2e-credential" },
        }))
        expect(result.status).toBe(200)
        expect(await result.json()).toMatchObject({
          runId,
          state: "completed",
          verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED" },
        })
        expect(providerCalls).toBe(0)
        expect((await store.loadRun(runId))?.state).toBe("completed")
      } finally {
        await store.close()
        await rm(sourceRoot, { recursive: true, force: true })
        await rm(snapshotRoot, { recursive: true, force: true })
      }
    })
  })
} else {
  describe.skip("Judge runtime PostgreSQL composition (HARNESS_POSTGRES_E2E=1 required)", () => {
    test("skipped unless HARNESS_POSTGRES_E2E=1", () => {})
  })
}
