// Adapted from OpenCode packages/core/src/config.ts @ 3f393d78bf (MIT License). See NOTICE.
import { existsSync, readFileSync } from "node:fs"
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

export const findRepositoryRoot = (startDir: string = process.cwd()): string => {
  let curr = resolve(startDir)
  while (true) {
    if (existsSync(resolve(curr, "turbo.json"))) return curr
    const parent = dirname(curr)
    if (parent === curr) break
    curr = parent
  }
  return resolve(import.meta.dir, "../../..")
}

let envLoaded = false

export function ensureRootEnvLoaded(): void {
  if (envLoaded || process.env.NODE_ENV === "test") return
  envLoaded = true
  const envPath = findRootEnvFile(process.cwd()) ?? findRootEnvFile(import.meta.dir)
  if (!envPath) return
  const processWithEnvFileLoader = process as typeof process & { loadEnvFile?: (path: string) => void }
  try {
    if (typeof processWithEnvFileLoader.loadEnvFile === "function") processWithEnvFileLoader.loadEnvFile(envPath)
    // Bun has no process.loadEnvFile and only auto-loads .env from the working directory.
    else applyEnvFile(readFileSync(envPath, "utf8"), process.env)
  } catch {
    // Ignore error loading env file
  }
}

/** Applies `KEY=value` lines to `target` without overriding variables that are already set. */
export function applyEnvFile(content: string, target: Record<string, string | undefined>): void {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === "" || line.startsWith("#")) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (target[key!] !== undefined) continue
    const quoted = rawValue!.match(/^(["'])(.*)\1$/)
    target[key!] = quoted ? quoted[2]! : rawValue!.replace(/\s+#.*$/, "")
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
export const ModelOutputTokensFields = ["max_tokens", "max_completion_tokens"] as const

const optionalNumber = (schema: z.ZodType<number>) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined
    const number = Number(value)
    return Number.isNaN(number) ? value : number
  }, schema.optional())

const optionalPositiveInteger = optionalNumber(z.number().int().positive())
const optionalNonNegativeNumber = optionalNumber(z.number().nonnegative())

export const RuntimeConfigSchema = z
  .object({
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
    modelMaxContextTokens: optionalPositiveInteger,
    modelOutputTokensField: z
      .preprocess((value) => (value === undefined || value === null || value === "" ? "max_tokens" : value),
        z.enum(ModelOutputTokensFields))
      .default("max_tokens"),
    modelInputCostPerMTok: optionalNonNegativeNumber,
    modelOutputCostPerMTok: optionalNonNegativeNumber,
    snapshotDir: z.string().min(1),
    maxSteps: optionalPositiveInteger,
    maxToolCalls: optionalPositiveInteger,
    maxTotalTokens: optionalPositiveInteger,
    maxCostUsd: optionalNonNegativeNumber,
  })
  .superRefine((config, ctx) => {
    if (config.modelInputCostPerMTok !== undefined && config.modelOutputCostPerMTok === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["modelOutputCostPerMTok"],
        message: "must be set together with MODEL_INPUT_COST_PER_MTOK",
      })
    }
    if (config.modelOutputCostPerMTok !== undefined && config.modelInputCostPerMTok === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["modelInputCostPerMTok"],
        message: "must be set together with MODEL_OUTPUT_COST_PER_MTOK",
      })
    }
  })
  .transform(({ maxSteps, maxToolCalls, maxTotalTokens, maxCostUsd, ...config }) => ({
    ...config,
    runLimits: {
      ...(maxSteps !== undefined ? { maxSteps } : {}),
      ...(maxToolCalls !== undefined ? { maxToolCalls } : {}),
      ...(maxTotalTokens !== undefined ? { totalTokenBudget: maxTotalTokens } : {}),
      ...(maxCostUsd !== undefined ? { costCeilingUsd: maxCostUsd } : {}),
    },
  }))

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
  modelMaxContextTokens: "MODEL_MAX_CONTEXT_TOKENS",
  modelOutputTokensField: "MODEL_OUTPUT_TOKENS_FIELD",
  modelInputCostPerMTok: "MODEL_INPUT_COST_PER_MTOK",
  modelOutputCostPerMTok: "MODEL_OUTPUT_COST_PER_MTOK",
  snapshotDir: "HARNESS_SNAPSHOT_DIR",
  maxSteps: "HARNESS_MAX_STEPS",
  maxToolCalls: "HARNESS_MAX_TOOL_CALLS",
  maxTotalTokens: "HARNESS_MAX_TOTAL_TOKENS",
  maxCostUsd: "HARNESS_MAX_COST_USD",
}

/**
 * Loads and validates runtime configuration from environment variables.
 * Fails fast with ConfigValidationError if required keys are missing or invalid.
 */
export function loadRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  if (env === process.env) {
    ensureRootEnvLoaded()
  }
  const repoRoot = findRepositoryRoot(process.cwd())
  const rawInput = {
    databaseUrl: env.DATABASE_URL,
    providerName: env.PROVIDER_NAME,
    modelName: env.MODEL_NAME,
    modelApiKey: env.MODEL_API_KEY,
    modelBaseUrl: env.MODEL_BASE_URL ?? env.OPENAI_BASE_URL,
    modelTimeoutMs: env.MODEL_TIMEOUT_MS,
    modelMaxOutputTokens: env.MODEL_MAX_OUTPUT_TOKENS,
    modelMaxContextTokens: env.MODEL_MAX_CONTEXT_TOKENS,
    modelOutputTokensField: env.MODEL_OUTPUT_TOKENS_FIELD,
    modelInputCostPerMTok: env.MODEL_INPUT_COST_PER_MTOK,
    modelOutputCostPerMTok: env.MODEL_OUTPUT_COST_PER_MTOK,
    snapshotDir: env.HARNESS_SNAPSHOT_DIR?.trim() || resolve(repoRoot, "data", "snapshots"),
    maxSteps: env.HARNESS_MAX_STEPS,
    maxToolCalls: env.HARNESS_MAX_TOOL_CALLS,
    maxTotalTokens: env.HARNESS_MAX_TOTAL_TOKENS,
    maxCostUsd: env.HARNESS_MAX_COST_USD,
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
