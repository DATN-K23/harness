// Adapted from OpenCode packages/core/src/session/runner/llm.ts @ 3f393d78bf (MIT License, Copyright (c) 2025 opencode). See NOTICE.
import type { ClockPort, EventType, ModelGatewayPort, RunClaim, RunStorePort, TerminalReason, TokenUsage } from "@harness/protocol"
import { digestOf } from "../util/digest"
import { createIdGenerator, systemIdSources, type IdGenerator } from "../util/id"
import { redactSecrets } from "../util/secrets"
import { createTimeoutSignal } from "../util/timeout-signal"

export interface SingleTurnRunInput {
  runId?: string
  prompt: string
  profileId?: string
  timeoutMs?: number
  maxOutputTokens?: number
  workerId?: string
  secrets?: string[]
  maxPromptLength?: number
}

export interface SingleTurnRunResult {
  runId: string
  state: "completed" | "failed"
  content?: string
  error?: string
  errorCategory?: string
  usage?: TokenUsage & { costUsd: number }
  latencyMs: number
  terminalReason?: string
}

export interface SingleTurnRunnerDeps {
  store: RunStorePort
  gateway: ModelGatewayPort
  clock?: ClockPort
  idGenerator?: IdGenerator
  secrets?: string[]
}
interface ModelAttemptRecorder {
  recordModelAttempt(input: Record<string, unknown>): Promise<void>
}

function hasModelAttemptRecorder(store: unknown): store is ModelAttemptRecorder {
  return (
    typeof store === "object" &&
    store !== null &&
    "recordModelAttempt" in store &&
    typeof (store as Record<string, unknown>).recordModelAttempt === "function"
  )
}

export type InputValidationResult =
  | { valid: true }
  | { valid: false; reason: string; errorCategory?: string }

export function validateSingleTurnInput(input: SingleTurnRunInput): InputValidationResult {
  if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
    return {
      valid: false,
      reason: "Prompt must not be empty or whitespace only",
      errorCategory: "invalid_request",
    }
  }

  const maxPromptLength = input.maxPromptLength ?? 65_536
  if (input.prompt.length > maxPromptLength) {
    return {
      valid: false,
      reason: "Prompt length exceeds maximum allowed characters",
      errorCategory: "invalid_request",
    }
  }

  if (input.timeoutMs !== undefined && input.timeoutMs <= 0) {
    return {
      valid: false,
      reason: "timeoutMs must be positive",
      errorCategory: "invalid_request",
    }
  }

  if (input.maxOutputTokens !== undefined && input.maxOutputTokens <= 0) {
    return {
      valid: false,
      reason: "maxOutputTokens must be positive",
      errorCategory: "invalid_request",
    }
  }

  return { valid: true }
}

export { redactSecrets }

function redactObject<T>(value: T, secrets: readonly string[]): T {
  if (typeof value === "string") {
    return redactSecrets(value, secrets) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item, secrets)) as unknown as T
  }
  if (value !== null && typeof value === "object") {
    const res: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      res[k] = redactObject(v, secrets)
    }
    return res as unknown as T
  }
  return value
}

export class SingleTurnRunner {
  constructor(private readonly deps: SingleTurnRunnerDeps) {}

  async execute(input: SingleTurnRunInput): Promise<SingleTurnRunResult> {
    const clock = this.deps.clock ?? { nowMs: () => Date.now() }
    const idGen = this.deps.idGenerator ?? createIdGenerator(systemIdSources)
    const startTime = clock.nowMs()
    const runId = input.runId ?? idGen.next("run_")
    const workerId = input.workerId ?? "single-turn-worker"
    const timeoutMs = input.timeoutMs ?? 30_000
    const profileId = input.profileId ?? "default"
    const secrets = [...(this.deps.secrets ?? []), ...(input.secrets ?? [])]

    // 1. Validation
    const validation = validateSingleTurnInput(input)
    if (!validation.valid) {
      return {
        runId,
        state: "failed",
        error: validation.reason,
        errorCategory: validation.errorCategory ?? "invalid_request",
        latencyMs: 0,
        terminalReason: "invalid_input",
      }
    }

    let claim: RunClaim | undefined
    let stateVersion = 1

    const appendEvent = async (type: EventType, payload: Record<string, unknown>) => {
      if (!claim) return
      const sanitizedPayload = redactObject(payload, secrets)
      await this.deps.store.appendEvent({
        claim,
        expectedStateVersion: stateVersion,
        event: {
          eventId: idGen.next("evt_"),
          type,
          schemaVersion: 1,
          payload: sanitizedPayload,
          payloadDigest: digestOf(sanitizedPayload),
          occurredAt: new Date(clock.nowMs()).toISOString(),
        },
      })
    }

    try {
      // 2. Register run if seedRun exists
      if ("seedRun" in this.deps.store && typeof this.deps.store.seedRun === "function") {
        await Promise.resolve(
          (this.deps.store as { seedRun: (id: string, state?: string, prompt?: string) => unknown }).seedRun(
            runId,
            "queued",
            input.prompt,
          ),
        )
      }

      // 3. Claim run
      const claimRes = await this.deps.store.claim({ runId, workerId })
      if (claimRes.kind !== "claimed") {
        return {
          runId,
          state: "failed",
          error: `Failed to claim run: ${claimRes.reason}`,
          errorCategory: "concurrency_error",
          latencyMs: clock.nowMs() - startTime,
          terminalReason: "work_handoff_failure",
        }
      }

      claim = claimRes.claim
      stateVersion = claimRes.stateVersion

      // 4. Record run.queued event
      await appendEvent("run.queued", {
        prompt: input.prompt,
        profileId,
        timeoutMs,
      })

      // 5. Transition to "running"
      const transitionRes = await this.deps.store.transition({
        claim,
        expectedState: "queued",
        expectedStateVersion: stateVersion,
        nextState: "running",
      })

      if (transitionRes.kind === "transitioned") {
        stateVersion = transitionRes.stateVersion
      }

      // 6. Record run.started event
      await appendEvent("run.started", {
        profileId,
        startedAt: new Date(startTime).toISOString(),
      })

      // 7. Dispatch attempt to gateway with timeout
      const attemptTimeout = createTimeoutSignal(timeoutMs)
      const response = await this.deps.gateway.executeAttempt(
        {
          runId,
          stepIndex: 1,
          attemptIndex: 1,
          profileId,
          items: [
            {
              id: idGen.next("ctx_"),
              turn: 1,
              type: "candidate_finding",
              isPinned: true,
              content: input.prompt,
            },
          ],
        },
        attemptTimeout.signal,
      ).finally(attemptTimeout.dispose)

      const latencyMs = clock.nowMs() - startTime

      // 8. Handle response
      if (!response.error && response.content !== undefined) {
        const redactedContent = redactSecrets(response.content, secrets)

        // Record provider completion/response event
        await appendEvent("provider.attempted", {
          profileId,
          finishReason: response.finishReason,
          usage: response.usage,
          latencyMs,
        })
        if (hasModelAttemptRecorder(this.deps.store)) {
          await this.deps.store.recordModelAttempt({
            id: idGen.next("att_"),
            runId,
            attemptNumber: 1,
            provider: profileId.includes("gemini") ? "google" : "openai",
            model: profileId,
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
            costUsd: response.usage.costUsd,
            latencyMs,
            finishReason: response.finishReason,
            requestJson: { prompt: input.prompt },
            responseJson: response.content ? { content: response.content } : null,
          })
        }

        // Transition store to "completed"
        const finalTransition = await this.deps.store.transition({
          claim,
          expectedState: "running",
          expectedStateVersion: stateVersion,
          nextState: "completed",
          prompt: input.prompt,
          modelProfile: profileId,
          resultContent: redactedContent,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          costUsd: response.usage.costUsd,
          latencyMs,
        })
        if (finalTransition.kind === "transitioned") {
          stateVersion = finalTransition.stateVersion
        }

        return {
          runId,
          state: "completed",
          content: redactedContent,
          usage: response.usage,
          latencyMs,
        }
      }

      // Handle provider error response
      const rawErrorMsg = response.error?.message ?? "Provider execution failed"
      const sanitizedMsg = redactSecrets(rawErrorMsg, secrets)
      const errorCategory = response.error?.category ?? "transport"
      const isTimeout = response.error?.isTimeout ?? false

      let terminalReason: TerminalReason = "provider_permanent"
      if (isTimeout) {
        terminalReason = "wall_clock"
      } else if (response.error?.category === "invalid_request") {
        terminalReason = "invalid_input"
      } else if (response.error?.isRetryable) {
        terminalReason = "provider_transient_primary"
      }

      await appendEvent("provider.failed", {
        error: sanitizedMsg,
        category: errorCategory,
        isTimeout,
      })

      await appendEvent("run.failed", {
        reason: terminalReason,
        message: sanitizedMsg,
      })
      if (hasModelAttemptRecorder(this.deps.store)) {
        await this.deps.store.recordModelAttempt({
          id: idGen.next("att_"),
          runId,
          attemptNumber: 1,
          provider: profileId.includes("gemini") ? "google" : "openai",
          model: profileId,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          latencyMs,
          finishReason: "error",
          requestJson: { prompt: input.prompt },
          errorMessage: sanitizedMsg,
          errorCategory,
        })
      }

      const finalTransition = await this.deps.store.transition({
        claim,
        expectedState: "running",
        expectedStateVersion: stateVersion,
        nextState: "failed",
        terminalReason,
        prompt: input.prompt,
        modelProfile: profileId,
        errorMessage: sanitizedMsg,
        errorCategory,
        latencyMs,
      })
      if (finalTransition.kind === "transitioned") {
        stateVersion = finalTransition.stateVersion
      }

      return {
        runId,
        state: "failed",
        error: sanitizedMsg,
        errorCategory,
        latencyMs,
        terminalReason,
      }
    } catch (err: unknown) {
      const latencyMs = clock.nowMs() - startTime
      const isTimeout =
        (err instanceof Error && (err.name === "TimeoutError" || err.message.toLowerCase().includes("timeout"))) ||
        false
      const rawMsg = err instanceof Error ? err.message : String(err)
      const sanitizedMsg = redactSecrets(rawMsg, secrets)

      const terminalReason: TerminalReason = isTimeout ? "wall_clock" : "attempt_outcome_unknown"
      const errorCategory = isTimeout ? "transport" : "internal_error"

      if (claim) {
        try {
          await appendEvent("run.failed", {
            reason: terminalReason,
            message: sanitizedMsg,
          })

          const runRecord = await this.deps.store.loadRun(runId)
          if (runRecord && runRecord.state !== "failed" && runRecord.state !== "completed") {
            await this.deps.store.transition({
              claim,
              expectedState: runRecord.state,
              expectedStateVersion: stateVersion,
              nextState: "failed",
              terminalReason,
              prompt: input.prompt,
              modelProfile: profileId,
              errorMessage: sanitizedMsg,
              errorCategory,
              latencyMs,
            })
          }
        } catch {
          // Store transition failure during catch should not throw
        }
      }

      return {
        runId,
        state: "failed",
        error: sanitizedMsg,
        errorCategory,
        latencyMs,
        terminalReason,
      }
    }
  }
}
