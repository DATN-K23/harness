import { describe, expect, test } from "bun:test"
import { assertProductionJudgeConfig, createProductionHealthHandler, resolveProductionSnapshot } from "../src/production-runtime"
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
    expect(await response.json()).toMatchObject({ apiVersion: 1, judgeExecution: "unverified-only", enablePocExecution: false })
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
