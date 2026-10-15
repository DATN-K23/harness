// Adapted from OpenCode packages/cli/src/commands/run.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ModelGatewayPort, RunStorePort } from "@harness/protocol"
import { SingleTurnRunner } from "@harness/core"
import { InMemoryRunStore, ScriptedModelGateway, textResponse } from "@harness/core/testing"
import { RealModelGateway } from "@harness/llm"
import type { RuntimeConfig } from "../config"
import { redactSecrets } from "../redaction"

export interface RunCommandOptions {
  prompt?: string
  model?: string
  timeout?: string
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
  }
  latencyMs: number
}

export interface RunCommandDeps {
  config?: RuntimeConfig
  store?: RunStorePort
  gateway?: ModelGatewayPort
  secrets?: string[]
}
/**
 * Executes a single-turn prompt run and outputs formatted results.
 */
export async function executeRunCommand(
  options: RunCommandOptions,
  deps: RunCommandDeps = {},
): Promise<{ exitCode: number; result?: RunExecutionResult; output: string }> {
  const prompt = options.prompt?.trim()

  if (!prompt) {
    const errorMsg = "Error: --prompt is required and cannot be empty."
    return { exitCode: 1, output: errorMsg }
  }

  const secrets = deps.secrets ?? (deps.config?.modelApiKey ? [deps.config.modelApiKey] : [])

  // If a mock or injected store / gateway is not provided, fallback to in-memory fake runner for dev/test mode
  const store = deps.store ?? new InMemoryRunStore({ clock: { nowMs: () => Date.now() } })
  const gateway =
    deps.gateway ??
    (deps.config?.modelApiKey
      ? new RealModelGateway({
          apiKey: deps.config.modelApiKey,
          model: deps.config.modelName,
          timeoutMs: deps.config.modelTimeoutMs,
          secrets,
        })
      : new ScriptedModelGateway([
          textResponse("Hello from Harness CLI mock runner.", {
            usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40, costUsd: 0.0001 },
          }),
        ]))

  const runner = new SingleTurnRunner({
    store,
    gateway,
    secrets,
  })

  const profileId = options.model ?? deps.config?.modelName ?? "mock-model"
  const timeoutMs = options.timeout ? Number(options.timeout) : (deps.config?.modelTimeoutMs ?? 30_000)

  const runResult = await runner.execute({
    prompt,
    profileId,
    timeoutMs,
  })

  if (runResult.state === "completed") {
    const usage = runResult.usage ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    }
    const content = runResult.content ?? ""
    const outputLines = [
      "========================================",
      "Run Execution Summary",
      "========================================",
      `Run ID:       ${runResult.runId}`,
      `State:        completed`,
      `Model:        ${profileId}`,
      `Latency:      ${runResult.latencyMs} ms`,
      `Tokens:       ${usage.totalTokens} (Prompt: ${usage.promptTokens}, Completion: ${usage.completionTokens})`,
      `Cost:         $${usage.costUsd.toFixed(6)} USD`,
      "----------------------------------------",
      "Model Output:",
      redactSecrets(content, secrets),
      "========================================",
    ]

    const executionResult: RunExecutionResult = {
      runId: runResult.runId,
      state: "completed",
      content,
      usage,
      latencyMs: runResult.latencyMs,
    }

    return {
      exitCode: 0,
      result: executionResult,
      output: outputLines.join("\n"),
    }
  } else {
    const errorMsg = redactSecrets(runResult.error ?? "Unknown error", secrets)
    const errorCategory = runResult.errorCategory ?? "internal_error"

    const outputLines = [
      "========================================",
      "Run Execution Summary",
      "========================================",
      `Run ID:       ${runResult.runId}`,
      `State:        failed`,
      `Category:     ${errorCategory}`,
      `Latency:      ${runResult.latencyMs} ms`,
      "----------------------------------------",
      "Error Message:",
      errorMsg,
      "========================================",
    ]

    return {
      exitCode: 1,
      result: {
        runId: runResult.runId,
        state: "failed",
        error: errorMsg,
        errorCategory,
        latencyMs: runResult.latencyMs,
      },
      output: outputLines.join("\n"),
    }
  }
}
