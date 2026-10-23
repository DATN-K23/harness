import type { ModelGatewayPort, RunStorePort } from "@harness/protocol"
import { SingleTurnRunner } from "@harness/core"
import { RealModelGateway } from "@harness/llm"
import { ConfigValidationError, type RuntimeConfig } from "../config"
import { redactSecrets } from "../redaction"

export interface RunCommandOptions {
  prompt?: string
  model?: string
  timeout?: string
  maxOutputTokens?: number
  help?: boolean
}

export interface RunExecutionResult {
  runId: string
  state: "completed" | "failed"
  content?: string
  error?: string
  errorCategory?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costUsd: number
    pricing?: "priced" | "unpriced"
  }
  latencyMs: number
}

export interface RunCommandDeps {
  config?: RuntimeConfig
  store?: RunStorePort
  gateway?: ModelGatewayPort
  secrets?: string[]
  pricing?: "priced" | "unpriced"
}

/** Executes the direct, single-turn baseline without substituting fake dependencies. */
export async function executeRunCommand(
  options: RunCommandOptions,
  deps: RunCommandDeps = {},
): Promise<{ exitCode: number; result?: RunExecutionResult; output: string }> {
  const prompt = options.prompt?.trim()
  if (!prompt) return { exitCode: 1, output: "Error: --prompt is required and cannot be empty." }

  if (!deps.store) throw new ConfigValidationError("Invalid runtime configuration:\n  DATABASE_URL: required")
  if (!deps.gateway && !deps.config?.modelApiKey) {
    throw new ConfigValidationError("Invalid runtime configuration:\n  MODEL_API_KEY: required", ["MODEL_API_KEY"])
  }

  const secrets = deps.secrets ?? (deps.config?.modelApiKey ? [deps.config.modelApiKey] : [])
  const store = deps.store
  const gateway = deps.gateway ??
    new RealModelGateway({
      apiKey: deps.config?.modelApiKey,
      model: deps.config?.modelName,
      baseURL: deps.config?.modelBaseUrl ?? process.env.MODEL_BASE_URL ?? process.env.OPENAI_BASE_URL,
      timeoutMs: deps.config?.modelTimeoutMs,
      outputTokensField: deps.config?.modelOutputTokensField,
      inputCostPerMTok: deps.config?.modelInputCostPerMTok,
      outputCostPerMTok: deps.config?.modelOutputCostPerMTok,
      secrets,
    })
  const runner = new SingleTurnRunner({ store, gateway, secrets })
  const profileId = options.model ?? deps.config?.modelName ?? "mock-model"
  const timeoutMs = options.timeout ? Number(options.timeout) : (deps.config?.modelTimeoutMs ?? 30_000)
  const runResult = await runner.execute({
    prompt,
    profileId,
    timeoutMs,
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
  })

  if (runResult.state === "completed") {
    const usage = runResult.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
    const pricing = (usage as typeof usage & { pricing?: "priced" | "unpriced" }).pricing ?? deps.pricing ?? "priced"
    const content = runResult.content ?? ""
    const outputLines = [
      "========================================",
      "Run Execution Summary",
      "========================================",
      `Run ID:       ${runResult.runId}`,
      "State:        completed",
      `Model:        ${profileId}`,
      `Latency:      ${runResult.latencyMs} ms`,
      `Tokens:       ${usage.totalTokens} (Prompt: ${usage.promptTokens}, Completion: ${usage.completionTokens})`,
      `Cost:         ${pricing === "unpriced" ? "unknown" : `$${usage.costUsd.toFixed(6)} USD`}`,
      "----------------------------------------",
      "Model Output:",
      redactSecrets(content, secrets),
      "========================================",
    ]
    return {
      exitCode: 0,
      result: {
        runId: runResult.runId,
        state: "completed",
        content,
        usage: { ...usage, pricing },
        latencyMs: runResult.latencyMs,
      },
      output: outputLines.join("\n"),
    }
  }

  const errorMsg = redactSecrets(runResult.error ?? "Unknown error", secrets)
  const errorCategory = runResult.errorCategory ?? "internal_error"
  return {
    exitCode: 1,
    result: {
      runId: runResult.runId,
      state: "failed",
      error: errorMsg,
      errorCategory,
      latencyMs: runResult.latencyMs,
    },
    output: [
      "========================================",
      "Run Execution Summary",
      "========================================",
      `Run ID:       ${runResult.runId}`,
      "State:        failed",
      `Category:     ${errorCategory}`,
      `Latency:      ${runResult.latencyMs} ms`,
      "----------------------------------------",
      "Error Message:",
      errorMsg,
      "========================================",
    ].join("\n"),
  }
}
