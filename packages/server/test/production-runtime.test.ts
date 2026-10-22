import { describe, expect, test } from "bun:test"
import { assertProductionJudgeConfig, createProductionHealthHandler, makeProductionJudgeConfig, resolveProductionSnapshot, resolveProductionProvider, startProductionLocalServer, startProductionLocalServerWithOperations } from "../src/production-runtime"
import { ProductionSecurityFilter } from "@harness/core"
import { startPollingWorker } from "../src/worker-lifecycle"
import { startCheckedLocalServer } from "../src/production-startup"

describe("production runtime safety", () => {
  test("rejects PoC execution regardless of caller-provided config", () => {
    expect(() => assertProductionJudgeConfig({ enablePocExecution: true })).toThrow("PoC execution is disabled")
  })

  test("forces PoC execution off", () => {
    expect(assertProductionJudgeConfig({ enablePocExecution: false }).enablePocExecution).toBe(false)
    expect(assertProductionJudgeConfig({}).enablePocExecution).toBe(false)
  })

  test("Postgres ping failure prevents listening", async () => {
    const state = setup()
    state.ping = async () => { throw new Error("database ping failed") }
    await expect(startCheckedLocalServer(state.options, state.ops)).rejects.toThrow("database ping failed")
    expect(state.listens).toBe(0)
  })

  test("Keychain failure prevents listening", async () => {
    const state = setup()
    state.keychain = async () => { throw new Error("Keychain failed") }
    await expect(startCheckedLocalServer(state.options, state.ops)).rejects.toThrow("Keychain failed")
    expect(state.listens).toBe(0)
  })

  test("successful readiness listens and serves authenticated health", async () => {
    const state = setup()
    const result = await startCheckedLocalServer(state.options, state.ops)
    expect(state.listens).toBe(1)
    expect(await result.fetch(new Request("http://localhost/v1/health", { headers: { authorization: "Bearer keychain-secret" } })).then((r) => r.status)).toBe(200)
    await result.stop()
  })

  test("health requires Keychain bearer auth and reports actual limited capabilities", async () => {
    const fetch = createProductionHealthHandler("keychain-secret")
    const health = new Request("http://localhost/v1/health", { headers: { authorization: "Bearer keychain-secret" } })
    const denied = await fetch(new Request("http://localhost/v1/health"))
    expect(denied.status).toBe(401)
    const response = await fetch(health)
    expect(response.status).toBe(200)
    const body = await response.json() as { capabilities: string[] }
    expect(body).toMatchObject({ apiVersion: 1, judgeExecution: "unverified-only", enablePocExecution: false })
    expect(body.capabilities).not.toContain("state-probe")
    expect(await fetch(new Request("http://localhost/v1/judge/runs", { method: "POST" })).then((r) => r.status)).toBe(401)
  })

  test("snapshot resolver loads only the exact immutable snapshot ID and checks for files", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => import("node:os").then(({ tmpdir }) => mkdtemp(`${tmpdir()}/judge-resolver-`)))
    try {
      const { SnapshotManager } = await import("@harness/core")
      await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(`${root}/source`, { recursive: true }).then(() => writeFile(`${root}/source/A.sol`, "contract A {}\n")))
      await SnapshotManager.ingestRepository({ sourceDir: `${root}/source`, storageDir: root, snapshotId: "allowed-id" })
      const snapshot = await resolveProductionSnapshot(root, "allowed-id")
      expect(await snapshot.listFiles({ snapshotId: "allowed-id" })).toEqual(["A.sol"])
      expect(await snapshot.listFiles({ snapshotId: "other-id" })).toEqual([])
      await expect(resolveProductionSnapshot(root, "../source")).rejects.toThrow()
      await expect(resolveProductionSnapshot(root, "missing-id")).rejects.toThrow()
    } finally {
      await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }))
    }
  })

  test("provider routing never sends third-party keys to the default OpenAI endpoint", () => {
    expect(() => resolveProductionProvider({ providerName: "anthropic", apiKey: "secret" })).toThrow("requires an explicit OpenAI-compatible base URL")
    expect(resolveProductionProvider({ providerName: "openrouter", apiKey: "secret", baseURL: "https://openrouter.ai/api/v1" })).toEqual({
      apiKey: "secret", model: "model", baseURL: "https://openrouter.ai/api/v1",
    })
    expect(() => resolveProductionProvider({ providerName: "openrouter", apiKey: "secret", baseURL: "https://api.openai.com/v1" })).toThrow("provider-specific")
    expect(resolveProductionProvider({ providerName: "openai", apiKey: "key" })).toEqual({ apiKey: "key", model: "model", baseURL: "https://api.openai.com/v1" })
    expect(resolveProductionProvider({ providerName: "openai", apiKey: "key", baseURL: "https://api.openai.com/v1" }).baseURL).toBe("https://api.openai.com/v1")
    expect(() => resolveProductionProvider({ providerName: "openai", apiKey: "key", baseURL: "https://attacker.example/v1" })).toThrow("only api.openai.com")
  })

  test("provider routing rejects URL query secrets and fragments for every supported provider", () => {
    for (const providerName of ["openai", "openrouter"]) {
      for (const key of ["key", "api_key", "token", "secret", "password", "authorization", "credential"]) {
        expect(() => resolveProductionProvider({ providerName, apiKey: "key", baseURL: `https://${providerName === "openai" ? "api.openai.com" : "openrouter.ai"}/v1?${key}=leak` })).toThrow("must not contain credentials")
      }
      expect(() => resolveProductionProvider({ providerName, apiKey: "key", baseURL: `https://${providerName === "openai" ? "api.openai.com" : "openrouter.ai"}/v1#token=leak` })).toThrow("must not contain credentials")
    }
    expect(() => resolveProductionProvider({ providerName: "openai", apiKey: "key", baseURL: "https://api.openai.com/v1?x=secret" })).toThrow("must not contain credentials")
    expect(() => resolveProductionProvider({ providerName: "openrouter", apiKey: "key", baseURL: "https://openrouter.ai/v1?auth=secret" })).toThrow("must not contain credentials")
  })

  test("provider endpoints require HTTPS before gateway configuration is returned", () => {
    expect(() => resolveProductionProvider({ providerName: "openai", apiKey: "key", baseURL: "http://api.openai.com/v1" })).toThrow("HTTPS")
    expect(() => resolveProductionProvider({ providerName: "openrouter", apiKey: "key", baseURL: "http://openrouter.ai/api/v1" })).toThrow("HTTPS")
  })

  test("invalid provider URL is rejected before startup can initialize dependencies", async () => {
    await expect(startProductionLocalServer({
      databaseUrl: "not-a-database-url", modelApiKey: "key", modelName: "model", providerName: "openai",
      modelBaseUrl: "https://api.openai.com/v1?auth=secret", snapshotDir: "/missing", hostname: "127.0.0.1", port: 0,
    })).rejects.toThrow("must not contain credentials")
  })

  test("invalid provider URLs do not construct Postgres or start snapshot, Keychain, or listener operations", async () => {
    const calls = { postgres: 0, snapshot: 0, keychain: 0, listen: 0 }
    const operations = {
      createStore: () => { calls.postgres++; return undefined as never },
      resolveSnapshotRoot: async () => { calls.snapshot++; return "/snapshots" },
      startCheckedLocalServer: async () => { calls.keychain++; calls.listen++; return undefined as never },
    }
    const base = {
      databaseUrl: "postgres://db", modelApiKey: "key", modelName: "model", providerName: "openai",
      snapshotDir: "/snapshots", hostname: "127.0.0.1", port: 0,
    }

    for (const modelBaseUrl of ["https://api.openai.com/v1?auth=secret", "http://api.openai.com/v1", "https://key:secret@api.openai.com/v1"]) {
      await expect(startProductionLocalServerWithOperations({ ...base, modelBaseUrl }, operations)).rejects.toThrow()
    }

    expect(calls).toEqual({ postgres: 0, snapshot: 0, keychain: 0, listen: 0 })
  })

  test("production run config records non-secret runtime settings and changes with them", () => {
    const first = makeProductionJudgeConfig({ providerName: "openai", modelName: "model", modelBaseUrl: "https://api.openai.com/v1" })
    const second = makeProductionJudgeConfig({ providerName: "openrouter", modelName: "model", modelBaseUrl: "https://router.example/v1" })
    expect(first.runtime).not.toEqual(second.runtime)
    expect(JSON.stringify(first)).not.toContain("ApiKey")
    expect(first.runtime?.baseURL).toBe("https://api.openai.com/v1")
    expect(first.runtime?.baseURL).not.toMatch(/[?#@]/)
    expect(Object.isFrozen(first.runtime)).toBe(true)
    expect(first.maxProbeRuns).toBe(0)
  })

  test("production security filter redacts established secret patterns without importing test helpers", async () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----"
    const result = await new ProductionSecurityFilter().filterSecrets([
      "key sk-12345678901234567890",
      "PRIVATE_KEY=0xdeadbeef",
      pem,
      "AWS AKIAABCDEFGHIJKLMNOP",
      "GitHub ghp_abcdefghijklmnopqrstuvwxyz1234567890",
    ].join("\n"))
    expect(result.content).toBe(["key [REDACTED]", "[REDACTED]", "[REDACTED]", "AWS [REDACTED]", "GitHub [REDACTED]"].join("\n"))
    expect(result.redactionCount).toBe(5)
  })

  test("production security filter honors an already-aborted signal", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new ProductionSecurityFilter().filterSecrets("PRIVATE_KEY=0xdeadbeef", controller.signal)).rejects.toThrow()
  })

  test("worker shutdown returns within its bound but defers database cleanup until active work settles", async () => {
    let finish!: () => void
    let cleaned = false
    const worker = startPollingWorker(() => new Promise<void>((resolve) => { finish = resolve }), 5, 10, () => { cleaned = true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await worker.stop()
    expect(cleaned).toBe(false)
    finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cleaned).toBe(true)
  })

  test("worker stop shares its shutdown promise and clears the timeout after active work settles", async () => {
    let finish!: () => void
    let cleaned = 0
    const originalClearTimeout = globalThis.clearTimeout
    let clears = 0
    globalThis.clearTimeout = (() => {
      clears++
    }) as typeof clearTimeout
    try {
      const worker = startPollingWorker(() => new Promise<void>((resolve) => { finish = resolve }), 100, 100, () => { cleaned++ })
      await new Promise((resolve) => setTimeout(resolve, 0))
      const first = worker.stop()
      const second = worker.stop()
      expect(second).toBe(first)
      finish()
      await first
      expect(cleaned).toBe(1)
      expect(clears).toBeGreaterThanOrEqual(1)
    } finally {
      globalThis.clearTimeout = originalClearTimeout
    }
  })
})

function setup() {
  let listens = 0
  let ping: () => Promise<void> = async () => {}
  let keychain: () => Promise<string> = async () => "keychain-secret"
  const options = { databaseUrl: "postgres://db", modelApiKey: "model-secret", modelName: "model", providerName: "openai", snapshotDir: "/snapshots", hostname: "127.0.0.1", port: 1234 }
  const ops = {
    checkSnapshot: async () => {},
    pingDatabase: () => ping(),
    getCredential: () => keychain(),
    listen: (_hostname: string, _port: number, fetch: (request: Request) => Promise<Response>) => {
      listens++
      return { fetch, stop() {} }
    },
  }
  return {
    options,
    ops,
    get listens() { return listens },
    set ping(value: () => Promise<void>) { ping = value },
    set keychain(value: () => Promise<string>) { keychain = value },
  }
}
