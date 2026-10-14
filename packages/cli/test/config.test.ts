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
  }

  test("successfully loads valid environment configuration", () => {
    const config = loadRuntimeConfig(validEnv)
    expect(config.databaseUrl).toBe("postgresql://postgres:secret@localhost:5432/harness")
    expect(config.providerName).toBe("openai")
    expect(config.modelName).toBe("gpt-4o-mini")
    expect(config.modelApiKey).toBe("sk-test-key-1234567890abcdef")
    expect(config.modelTimeoutMs).toBe(45000)
    expect(config.modelMaxOutputTokens).toBe(2048)
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
})
