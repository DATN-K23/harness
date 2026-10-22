import { describe, expect, test } from "bun:test"
import { assertProductionJudgeConfig, createProductionHealthHandler, startProductionLocalServer } from "../src/production-runtime"

describe("production runtime safety", () => {
  test("rejects PoC execution regardless of caller-provided config", () => {
    expect(() => assertProductionJudgeConfig({ enablePocExecution: true })).toThrow("PoC execution is disabled")
  })

  test("forces PoC execution off", () => {
    expect(assertProductionJudgeConfig({ enablePocExecution: false }).enablePocExecution).toBe(false)
    expect(assertProductionJudgeConfig({}).enablePocExecution).toBe(false)
  })

  test("fails each readiness prerequisite before starting a listener", async () => {
    const base = { databaseUrl: "postgres://db", modelApiKey: "secret", modelName: "model", providerName: "openai", modelBaseUrl: undefined as string | undefined, snapshotDir: "/missing", hostname: "127.0.0.1", port: 0 }
    let listened = false
    const failures: Array<[typeof base, string]> = [
      [{ ...base, hostname: "0.0.0.0" }, "loopback"],
      [{ ...base, databaseUrl: "" }, "configuration"],
      [{ ...base, modelApiKey: "" }, "configuration"],
      [{ ...base, providerName: "unsupported" }, "Unsupported"],
      [{ ...base, modelBaseUrl: "https://user:pass@example.invalid" }, "credentials"],
      [base, "ENOENT"],
    ]
    for (const [options, expectedError] of failures) {
      await expect(startProductionLocalServer(options)).rejects.toThrow(expectedError)
      expect(listened).toBe(false)
    }
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
