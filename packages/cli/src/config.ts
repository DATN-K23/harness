// Adapted from OpenCode packages/core/src/config.ts @ 3f393d78bf (MIT License). See NOTICE.
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { z } from "zod"

export function findRootEnvFile(startDir: string = process.cwd()): string | undefined {
  let curr = resolve(startDir)
  while (true) {
    const candidate = resolve(curr, ".env")
    if (existsSync(candidate)) return candidate
    const parent = dirname(curr)
    if (parent === curr) break
    curr = parent
  }
  return undefined
}

let envLoaded = false

export function ensureRootEnvLoaded(): void {
  if (envLoaded || process.env.NODE_ENV === "test") return
  envLoaded = true
  const envPath = findRootEnvFile(process.cwd()) ?? findRootEnvFile(import.meta.dir)
  const processWithEnvFileLoader = process as typeof process & { loadEnvFile?: (path: string) => void }
  if (envPath && typeof processWithEnvFileLoader.loadEnvFile === "function") {
    try {
      processWithEnvFileLoader.loadEnvFile(envPath)
    } catch {
      // Ignore error loading env file
    }
  }
}

export const SupportedProviders = ["openai", "anthropic", "google", "openrouter"] as const
export type SupportedProvider = (typeof SupportedProviders)[number]

export const DefaultModelTimeoutMs = 30_000
export const DefaultMaxOutputTokens = 4_096
export const MaxModelTimeoutMs = 300_000
export const MinModelTimeoutMs = 1_000
export const MaxAllowedOutputTokens = 32_768
export const MinAllowedOutputTokens = 1

export const RuntimeConfigSchema = z.object({
  databaseUrl: z.string().min(1, "DATABASE_URL cannot be empty"),
  providerName: z.string().min(1, "PROVIDER_NAME cannot be empty"),
  modelName: z.string().min(1, "MODEL_NAME cannot be empty"),
  modelApiKey: z.string().min(1, "MODEL_API_KEY cannot be empty"),
  modelBaseUrl: z.string().optional(),
  modelTimeoutMs: z
    .preprocess((val) => {
      if (val === undefined || val === null || val === "") return DefaultModelTimeoutMs
      const num = Number(val)
      return Number.isNaN(num) ? val : num
    }, z.number().int().min(MinModelTimeoutMs).max(MaxModelTimeoutMs))
    .default(DefaultModelTimeoutMs),
  modelMaxOutputTokens: z
    .preprocess((val) => {
      if (val === undefined || val === null || val === "") return DefaultMaxOutputTokens
      const num = Number(val)
      return Number.isNaN(num) ? val : num
    }, z.number().int().min(MinAllowedOutputTokens).max(MaxAllowedOutputTokens))
    .default(DefaultMaxOutputTokens),
})

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>

export class ConfigValidationError extends Error {
  public readonly missingKeys: string[]

  constructor(message: string, missingKeys: string[] = []) {
    super(message)
    this.name = "ConfigValidationError"
    this.missingKeys = missingKeys
  }
}

const FIELD_TO_ENV_KEY: Record<string, string> = {
  databaseUrl: "DATABASE_URL",
  providerName: "PROVIDER_NAME",
  modelName: "MODEL_NAME",
  modelApiKey: "MODEL_API_KEY",
  modelBaseUrl: "MODEL_BASE_URL",
  modelTimeoutMs: "MODEL_TIMEOUT_MS",
  modelMaxOutputTokens: "MODEL_MAX_OUTPUT_TOKENS",
}

/**
 * Loads and validates runtime configuration from environment variables.
 * Fails fast with ConfigValidationError if required keys are missing or invalid.
 */
export function loadRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  if (env === process.env) {
    ensureRootEnvLoaded()
  }
  const rawInput = {
    databaseUrl: env.DATABASE_URL,
    providerName: env.PROVIDER_NAME,
    modelName: env.MODEL_NAME,
    modelApiKey: env.MODEL_API_KEY,
    modelBaseUrl: env.MODEL_BASE_URL ?? env.OPENAI_BASE_URL,
    modelTimeoutMs: env.MODEL_TIMEOUT_MS,
    modelMaxOutputTokens: env.MODEL_MAX_OUTPUT_TOKENS,
  }

  const result = RuntimeConfigSchema.safeParse(rawInput)

  if (!result.success) {
    const missingKeysRecord: Record<string, true> = {}
    const issues = result.error.issues.map((issue) => {
      const field = issue.path[0] as string
      const envKey = FIELD_TO_ENV_KEY[field] ?? field
      const val = rawInput[field as keyof typeof rawInput]

      if (val === undefined || val === "") {
        missingKeysRecord[envKey] = true
      }
      return `${envKey}: ${issue.message}`
    })

    const message = `Invalid runtime configuration:\n  ${issues.join("\n  ")}`
    throw new ConfigValidationError(message, Object.keys(missingKeysRecord))
  }

  return result.data
}
