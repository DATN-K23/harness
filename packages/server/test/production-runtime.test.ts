import { describe, expect, test } from "bun:test"
import { assertProductionJudgeConfig, createProductionHealthHandler } from "../src/production-runtime"
import { startCheckedLocalServer } from "../src/production-startup"

describe("production runtime safety", () => {
  test("rejects PoC execution regardless of caller-provided config", () => {
    expect(() => assertProductionJudgeConfig({ enablePocExecution: true })).toThrow("PoC execution is disabled")
  })

  test("forces PoC execution off", () => {
    expect(assertProductionJudgeConfig({ enablePocExecution: false }).enablePocExecution).toBe(false)
    expect(assertProductionJudgeConfig({}).enablePocExecution).toBe(false)
  })

  test("image inspection failure prevents listening", async () => {
    const state = setup()
    state.image = async () => { throw new Error("image inspect failed") }
    await expect(startCheckedLocalServer(state.options, state.ops)).rejects.toThrow("image inspect failed")
    expect(state.listens).toBe(0)
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
    expect(await response.json()).toMatchObject({ apiVersion: 1, judgeExecution: "unavailable", enablePocExecution: false })
    expect(await fetch(new Request("http://localhost/v1/judge/runs", { method: "POST" })).then((r) => r.status)).toBe(401)
  })
})

function setup() {
  let listens = 0
  let image: () => Promise<void> = async () => {}
  let ping: () => Promise<void> = async () => {}
  let keychain: () => Promise<string> = async () => "keychain-secret"
  const options = { databaseUrl: "postgres://db", modelApiKey: "model-secret", modelName: "model", providerName: "openai", snapshotDir: "/snapshots", hostname: "127.0.0.1", port: 1234 }
  const ops = {
    checkSnapshot: async () => {},
    inspectImage: () => image(),
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
    set image(value: () => Promise<void>) { image = value },
    set ping(value: () => Promise<void>) { ping = value },
    set keychain(value: () => Promise<string>) { keychain = value },
  }
}
