import { describe, expect, test } from "bun:test"
import {
  ConfigValidationError,
  DefaultMaxOutputTokens,
  DefaultModelTimeoutMs,
  MaxAllowedOutputTokens,
  MaxModelTimeoutMs,
  MinAllowedOutputTokens,
  MinModelTimeoutMs,
  loadRuntimeConfig,
} from "../src/config"

describe("loadRuntimeConfig", () => {
  const validEnv: NodeJS.ProcessEnv = {
    DATABASE_URL: "postgresql://postgres:secret@localhost:5432/harness",
    PROVIDER_NAME: "openai",
    MODEL_NAME: "gpt-4o-mini",
    MODEL_API_KEY: "sk-test-key-1234567890abcdef",
    MODEL_TIMEOUT_MS: "45000",
    MODEL_MAX_OUTPUT_TOKENS: "2048",
    MODEL_MAX_CONTEXT_TOKENS: "32768",
  }

  test("successfully loads valid environment configuration", () => {
    const config = loadRuntimeConfig(validEnv)
    expect(config.databaseUrl).toBe("postgresql://postgres:secret@localhost:5432/harness")
    expect(config.providerName).toBe("openai")
    expect(config.modelName).toBe("gpt-4o-mini")
    expect(config.modelApiKey).toBe("sk-test-key-1234567890abcdef")
    expect(config.modelTimeoutMs).toBe(45000)
    expect(config.modelMaxOutputTokens).toBe(2048)
    expect(config.modelMaxContextTokens).toBe(32768)
  })

  test("maps invalid model context cap errors to its environment key", () => {
    expect(() => loadRuntimeConfig({ ...validEnv, MODEL_MAX_CONTEXT_TOKENS: "0" })).toThrow(
      /MODEL_MAX_CONTEXT_TOKENS/,
    )
  })

  test("uses default values for optional timeout and output tokens when missing or empty", () => {
    const minimalEnv: NodeJS.ProcessEnv = {
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/harness",
      PROVIDER_NAME: "anthropic",
      MODEL_NAME: "claude-3-5-sonnet",
      MODEL_API_KEY: "sk-ant-1234567890abcdef",
    }
    const config = loadRuntimeConfig(minimalEnv)
    expect(config.modelTimeoutMs).toBe(DefaultModelTimeoutMs)
    expect(config.modelMaxOutputTokens).toBe(DefaultMaxOutputTokens)
    expect(config.modelOutputTokensField).toBe("max_tokens")
    expect(config.snapshotDir).toContain("data")
    expect(config.runLimits).toEqual({})
  })

  test("fails fast when DATABASE_URL is missing or empty", () => {
    const env = { ...validEnv, DATABASE_URL: "" }
    expect(() => loadRuntimeConfig(env)).toThrow(ConfigValidationError)
    try {
      loadRuntimeConfig(env)
    } catch (err) {
      const configErr = err as ConfigValidationError
      expect(configErr.missingKeys).toContain("DATABASE_URL")
    }
  })

  test("fails fast when MODEL_API_KEY is missing", () => {
    const env = { ...validEnv }
    delete env.MODEL_API_KEY
    expect(() => loadRuntimeConfig(env)).toThrow(ConfigValidationError)
    try {
      loadRuntimeConfig(env)
    } catch (err) {
      const configErr = err as ConfigValidationError
      expect(configErr.missingKeys).toContain("MODEL_API_KEY")
    }
  })

  test("fails when timeout is below minimum or exceeds maximum bounds", () => {
    expect(() => loadRuntimeConfig({ ...validEnv, MODEL_TIMEOUT_MS: String(MinModelTimeoutMs - 1) })).toThrow(
      ConfigValidationError,
    )
    expect(() => loadRuntimeConfig({ ...validEnv, MODEL_TIMEOUT_MS: String(MaxModelTimeoutMs + 1) })).toThrow(
      ConfigValidationError,
    )
  })

  test("fails when max output tokens is out of allowable range", () => {
    expect(() => loadRuntimeConfig({ ...validEnv, MODEL_MAX_OUTPUT_TOKENS: String(MinAllowedOutputTokens - 1) })).toThrow(
      ConfigValidationError,
    )
    expect(() => loadRuntimeConfig({ ...validEnv, MODEL_MAX_OUTPUT_TOKENS: String(MaxAllowedOutputTokens + 1) })).toThrow(
      ConfigValidationError,
    )
  })

  test("invalid output-token field fails fast with the setting name", () => {
    expect(() => loadRuntimeConfig({ ...validEnv, MODEL_OUTPUT_TOKENS_FIELD: "max_output" })).toThrow(
      /MODEL_OUTPUT_TOKENS_FIELD/,
    )
  })

  test("half-specified model pricing is rejected with the missing setting name", () => {
    try {
      loadRuntimeConfig({ ...validEnv, MODEL_INPUT_COST_PER_MTOK: "1.5" })
      throw new Error("expected configuration validation to fail")
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError)
      expect((err as Error).message).toContain("MODEL_OUTPUT_COST_PER_MTOK")
    }
  })

  test("loads provider prices, snapshot directory and run limits", () => {
    const config = loadRuntimeConfig({
      ...validEnv,
      MODEL_OUTPUT_TOKENS_FIELD: "max_completion_tokens",
      MODEL_INPUT_COST_PER_MTOK: "2.5",
      MODEL_OUTPUT_COST_PER_MTOK: "10",
      HARNESS_SNAPSHOT_DIR: "D:/audit/snapshots",
      HARNESS_MAX_STEPS: "5",
      HARNESS_MAX_TOOL_CALLS: "20",
      HARNESS_MAX_TOTAL_TOKENS: "50000",
    })

    expect(config.modelOutputTokensField).toBe("max_completion_tokens")
    expect(config.modelInputCostPerMTok).toBe(2.5)
    expect(config.modelOutputCostPerMTok).toBe(10)
    expect(config.snapshotDir).toBe("D:/audit/snapshots")
    expect(config.runLimits).toEqual({ maxSteps: 5, maxToolCalls: 20, totalTokenBudget: 50_000 })
  })

  test("ignores the removed cost ceiling environment variable", () => {
    const config = loadRuntimeConfig({ ...validEnv, HARNESS_MAX_COST_USD: "0.25" })
    expect(config.runLimits).toEqual({})
  })

})

describe("applyEnvFile", () => {
  test("loads unset keys, strips quotes and comments, and never overrides existing values", async () => {
    const { applyEnvFile } = await import("../src/config")
    const target: Record<string, string | undefined> = { MODEL_NAME: "from-process" }
    applyEnvFile(
      ['# comment', 'MODEL_NAME=from-file', 'MODEL_BASE_URL="http://127.0.0.1:20128/v1"', "export PROVIDER_NAME=openai # note", "not a line"].join("\r\n"),
      target,
    )
    expect(target).toEqual({
      MODEL_NAME: "from-process",
      MODEL_BASE_URL: "http://127.0.0.1:20128/v1",
      PROVIDER_NAME: "openai",
    })
  })
})
