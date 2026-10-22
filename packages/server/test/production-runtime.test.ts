import { describe, expect, test } from "bun:test"
import { assertProductionJudgeConfig } from "../src/production-runtime"

describe("production runtime safety", () => {
  test("rejects PoC execution regardless of caller-provided config", () => {
    expect(() => assertProductionJudgeConfig({ enablePocExecution: true })).toThrow("PoC execution is disabled")
  })

  test("forces PoC execution off", () => {
    expect(assertProductionJudgeConfig({ enablePocExecution: false }).enablePocExecution).toBe(false)
    expect(assertProductionJudgeConfig({}).enablePocExecution).toBe(false)
  })
})
