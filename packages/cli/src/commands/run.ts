// Adapted from OpenCode packages/cli/src/commands/run.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ModelGatewayPort, RunStorePort } from "@harness/protocol"
import { createIdGenerator, digestOf, systemIdSources } from "@harness/core"
import { InMemoryRunStore, ScriptedModelGateway, textResponse } from "@harness/core/testing"
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

const idGen = createIdGenerator(systemIdSources)

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

  const runId = idGen.next("run_")
  const startTime = Date.now()
  const secrets = deps.secrets ?? (deps.config?.modelApiKey ? [deps.config.modelApiKey] : [])

  // If a mock or injected store / gateway is not provided, fallback to in-memory fake runner for dev/test mode
  const store = deps.store ?? new InMemoryRunStore({ clock: { nowMs: () => Date.now() } })
  const gateway =
    deps.gateway ??
    new ScriptedModelGateway([
      textResponse(`Response to: "${prompt.slice(0, 40)}"`, {
        usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40, costUsd: 0.0001 },
      }),
    ])

  const modelName = options.model ?? deps.config?.modelName ?? "mock-model"
  const timeoutMs = options.timeout ? Number(options.timeout) : (deps.config?.modelTimeoutMs ?? 30_000)

  try {
    const workerId = "cli-worker"

    // Seed run if supported by store
    if ("seedRun" in store && typeof store.seedRun === "function") {
      store.seedRun(runId, "queued")
    }

    const claimRes = await store.claim({ runId, workerId })
    const currentClaim =
      claimRes.kind === "claimed"
        ? claimRes.claim
        : { runId, claimToken: `claim:${runId}:1:${workerId}`, claimVersion: 1 }
    const stateVersion = claimRes.kind === "claimed" ? claimRes.stateVersion : 1

    if (claimRes.kind === "claimed") {
      const eventPayload = {
        prompt,
        model: modelName,
        timeoutMs,
      }
      await store.appendEvent({
        claim: currentClaim,
        expectedStateVersion: stateVersion,
        event: {
          eventId: idGen.next("evt_"),
          type: "run.queued",
          schemaVersion: 1,
          payload: eventPayload,
          payloadDigest: digestOf(eventPayload),
          occurredAt: new Date().toISOString(),
        },
      })
    }

    // 3. Invoke model attempt
    const response = await gateway.executeAttempt(
      {
        runId,
        stepIndex: 1,
        attemptIndex: 1,
        profileId: modelName,
        items: [
          {
            id: idGen.next("ctx_"),
            turn: 1,
            type: "candidate_finding",
            isPinned: true,
            content: prompt,
          },
        ],
      },
      AbortSignal.timeout(timeoutMs),
    )

    const latencyMs = Date.now() - startTime

    if (!response.error && response.content !== undefined) {
      const content = response.content
      const usage = response.usage

      // Update store
      if (claimRes.kind === "claimed") {
        await store.transition({
          claim: currentClaim,
          expectedState: claimRes.state,
          expectedStateVersion: stateVersion,
          nextState: "completed",
        })
      }
      const outputLines = [
        "========================================",
        "Run Execution Summary",
        "========================================",
        `Run ID:       ${runId}`,
        `State:        completed`,
        `Model:        ${modelName}`,
        `Latency:      ${latencyMs} ms`,
        `Tokens:       ${usage.totalTokens} (Prompt: ${usage.promptTokens}, Completion: ${usage.completionTokens})`,
        `Cost:         $${usage.costUsd.toFixed(6)} USD`,
        "----------------------------------------",
        "Model Output:",
        redactSecrets(content, secrets),
        "========================================",
      ]

      const executionResult: RunExecutionResult = {
        runId,
        state: "completed",
        content,
        usage,
        latencyMs,
      }

      return {
        exitCode: 0,
        result: executionResult,
        output: outputLines.join("\n"),
      }
    } else {
      // Model error
      const rawMsg = response.error?.message ?? "Unknown model execution error"
      const errorMsg = redactSecrets(rawMsg, secrets)
      const errorCategory = response.error?.category ?? "transport"

      if (claimRes.kind === "claimed") {
        await store.transition({
          claim: currentClaim,
          expectedState: claimRes.state,
          expectedStateVersion: stateVersion,
          nextState: "failed",
          terminalReason: "provider_permanent",
        })
      }
      const outputLines = [
        "========================================",
        "Run Execution Summary",
        "========================================",
        `Run ID:       ${runId}`,
        `State:        failed`,
        `Category:     ${errorCategory}`,
        `Latency:      ${latencyMs} ms`,
        "----------------------------------------",
        "Error Message:",
        errorMsg,
        "========================================",
      ]

      return {
        exitCode: 1,
        result: {
          runId,
          state: "failed",
          error: errorMsg,
          errorCategory,
          latencyMs,
        },
        output: outputLines.join("\n"),
      }
    }
  } catch (err) {
    const latencyMs = Date.now() - startTime
    const rawError = err instanceof Error ? err.message : String(err)
    const sanitizedError = redactSecrets(rawError, secrets)

    const outputLines = [
      "========================================",
      "Run Execution Summary",
      "========================================",
      `Run ID:       ${runId}`,
      `State:        failed`,
      `Category:     unhandled_error`,
      `Latency:      ${latencyMs} ms`,
      "----------------------------------------",
      "Error Message:",
      sanitizedError,
      "========================================",
    ]

    return {
      exitCode: 1,
      result: {
        runId,
        state: "failed",
        error: sanitizedError,
        errorCategory: "unhandled_error",
        latencyMs,
      },
      output: outputLines.join("\n"),
    }
  }
}
