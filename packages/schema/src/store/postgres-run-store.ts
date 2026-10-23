import {
  TerminalRunStates,
  type AdmissionResult,
  type AppendResult,
  type ClaimResult,
  type ClockPort,
  type EventType,
  type NewTrajectoryEvent,
  type RunClaim,
  type RunRecord,
  type RunState,
  type RunStorePort,
  type TransitionResult,
  type TerminalCommitInput,
  type TerminalReason,
  type TrajectoryEvent,
} from "@harness/protocol"
import { digestOf } from "@harness/core"
import { and, asc, eq, gt, notInArray, sql } from "drizzle-orm"
import { createDatabaseClient, type DatabaseClient } from "../db/client"
import { events, idempotencyKeys, modelAttempts, outbox, runs } from "../db/schema"
import { redactSecrets, sanitizeSecrets } from "./redaction"

export const DefaultLeaseMs = 300_000

export interface PostgresRunStoreOptions {
  client?: DatabaseClient
  url?: string
  clock?: ClockPort
  leaseMs?: number
}

export class PostgresRunStore implements RunStorePort {
  readonly client: DatabaseClient
  private readonly clock: ClockPort
  private readonly leaseMs: number
  private readonly ownsClient: boolean

  constructor(options: PostgresRunStoreOptions = {}) {
    if (options.client) {
      this.client = options.client
      this.ownsClient = false
    } else {
      this.client = createDatabaseClient({ url: options.url })
      this.ownsClient = true
    }
    this.clock = options.clock ?? { nowMs: () => Date.now() }
    this.leaseMs = options.leaseMs ?? DefaultLeaseMs
  }

  async admit(input: Parameters<NonNullable<RunStorePort["admit"]>>[0]): Promise<AdmissionResult> {
    const now = new Date(this.clock.nowMs())
    try {
      return await this.client.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, input.idempotencyKey)).for("update")
        if (existing) {
          return existing.requestDigest === input.requestDigest
            ? { kind: "replayed", runId: existing.runId }
            : { kind: "conflict" }
        }

        await tx.insert(runs).values({
          id: input.runId,
          prompt: input.reportMarkdown,
          snapshotId: input.snapshotId,
          findingId: input.findingId,
          configSnapshot: input.config,
          state: "queued",
          stateVersion: 1,
          claimVersion: 0,
          createdAt: now,
          updatedAt: now,
        })
        await tx.insert(idempotencyKeys).values({
          key: input.idempotencyKey,
          requestDigest: input.requestDigest,
          runId: input.runId,
          createdAt: now,
        })
        await tx.insert(outbox).values({ runId: input.runId, status: "pending", createdAt: now })
        return { kind: "accepted", runId: input.runId }
      })
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error
      const [existing] = await this.client.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, input.idempotencyKey))
      if (!existing) throw error
      return existing.requestDigest === input.requestDigest
        ? { kind: "replayed", runId: existing.runId }
        : { kind: "conflict" }
    }
  }

  async loadPendingOutbox(limit = 100): Promise<string[]> {
    const rows = await this.client.db
      .select({ runId: outbox.runId })
      .from(outbox)
      .where(sql`(${outbox.status} = 'pending' or (${outbox.status} = 'claimed' and ${outbox.claimExpiresAt} <= to_timestamp(${this.clock.nowMs()} / 1000.0)))`)
      .orderBy(asc(outbox.createdAt))
      .limit(limit)
    return rows.map(({ runId }) => runId)
  }

  async claimOutbox(runId: string, leaseMs = DefaultLeaseMs): Promise<boolean> {
    const [row] = await this.client.db
      .update(outbox)
      .set({ status: "claimed", claimExpiresAt: new Date(this.clock.nowMs() + leaseMs) })
      .where(and(
        eq(outbox.runId, runId),
        sql`(${outbox.status} = 'pending' or (${outbox.status} = 'claimed' and ${outbox.claimExpiresAt} <= to_timestamp(${this.clock.nowMs()} / 1000.0)))`,
      ))
      .returning({ runId: outbox.runId })
    return row !== undefined
  }

  async markOutboxPublished(runId: string): Promise<boolean> {
    const [row] = await this.client.db
      .update(outbox)
      .set({ status: "published", publishedAt: new Date(this.clock.nowMs()) })
      .where(and(eq(outbox.runId, runId), eq(outbox.status, "claimed")))
      .returning({ runId: outbox.runId })
    return row !== undefined
  }

  async commitTerminal(input: TerminalCommitInput, signal?: AbortSignal): Promise<TransitionResult> {
    signal?.throwIfAborted()
    return await this.client.db.transaction(async (tx) => {
      const [run] = await tx.select().from(runs).where(eq(runs.id, input.claim.runId)).for("update")
      if (!run || run.claimToken !== input.claim.claimToken || run.claimVersion !== input.claim.claimVersion)
        return { kind: "stale", reason: "claim_lost" }
      if (
        TerminalRunStates.includes(run.state as (typeof TerminalRunStates)[number]) ||
        run.state !== input.expectedState || run.stateVersion !== input.expectedStateVersion
      ) return { kind: "stale", reason: "state_changed" }

      const [last] = await tx.select({ maxSeq: sql<number>`coalesce(max(${events.sequence}), 0)` })
        .from(events).where(eq(events.runId, run.id))
      const payload = sanitizeSecrets(input.event.payload) as Record<string, unknown>
      await tx.insert(events).values({
        id: input.event.eventId,
        runId: run.id,
        sequence: Number(last?.maxSeq ?? 0) + 1,
        eventType: input.event.type,
        schemaVersion: input.event.schemaVersion,
        payload,
        payloadDigest: input.event.payloadDigest,
        occurredAt: new Date(input.event.occurredAt),
      })

      const nextVersion = run.stateVersion + 1
      const unpricedAttempt = input.costUsd !== null
        ? await tx.select({ id: modelAttempts.id }).from(modelAttempts)
          .where(and(eq(modelAttempts.runId, run.id), eq(modelAttempts.pricing, "unpriced"))).limit(1)
        : []
      const costIsUnknown = input.costUsd === null || unpricedAttempt.length > 0
      await tx.update(runs).set({
        state: input.nextState,
        stateVersion: nextVersion,
        terminalReason: input.terminalReason ?? null,
        ...(input.resultContent === undefined ? {} : { resultContent: redactSecrets(input.resultContent) }),
        ...(input.errorMessage === undefined ? {} : { errorMessage: redactSecrets(input.errorMessage) }),
        ...(input.errorCategory === undefined ? {} : { errorCategory: input.errorCategory }),
        ...(input.promptTokens === undefined ? {} : { promptTokens: input.promptTokens }),
        ...(input.completionTokens === undefined ? {} : { completionTokens: input.completionTokens }),
        ...(input.costUsd === undefined ? {} : { costUsd: costIsUnknown ? null : String(input.costUsd) }),
        ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
        updatedAt: new Date(this.clock.nowMs()),
      }).where(eq(runs.id, run.id))
      return { kind: "transitioned", stateVersion: nextVersion }
    })
  }

  async claim(input: { runId: string; workerId: string }, signal?: AbortSignal): Promise<ClaimResult> {
    signal?.throwIfAborted()
    const now = this.clock.nowMs()
    const expiresAt = new Date(now + this.leaseMs)

    return await this.client.db.transaction(async (tx) => {
      const [run] = await tx.select().from(runs).where(eq(runs.id, input.runId)).for("update")
      if (!run) {
        return { kind: "unavailable", reason: "not_found" }
      }
      if (TerminalRunStates.some((terminal) => terminal === run.state)) {
        return { kind: "unavailable", reason: "terminal" }
      }
      if (run.cancelRequestedAt) {
        const stateVersion = run.stateVersion + 1
        await tx.update(runs).set({
          state: "cancelled",
          stateVersion,
          terminalReason: "cancelled_by_user",
          updatedAt: new Date(now),
        }).where(eq(runs.id, run.id))
        await tx.insert(events).values({
          id: `cancel:${run.id}:${stateVersion}`,
          runId: run.id,
          sequence: (await tx.select({ maxSeq: sql<number>`coalesce(max(${events.sequence}), 0)` }).from(events).where(eq(events.runId, run.id)))[0]!.maxSeq + 1,
          eventType: "run.cancelled",
          schemaVersion: 1,
          payload: { reason: "cancelled_by_user", boundary: "before_claim" },
          payloadDigest: digestOf({ reason: "cancelled_by_user", boundary: "before_claim" }),
          occurredAt: new Date(now),
        })
        return { kind: "unavailable", reason: "terminal" }
      }
      if (run.claimExpiresAt && now < run.claimExpiresAt.getTime()) {
        return { kind: "unavailable", reason: "already_claimed" }
      }

      const nextVersion = run.claimVersion + 1
      const token = `claim:${input.runId}:${nextVersion}:${input.workerId}`

      const [updated] = await tx
        .update(runs)
        .set({
          claimToken: token,
          claimVersion: nextVersion,
          claimExpiresAt: expiresAt,
          updatedAt: new Date(now),
        })
        .where(eq(runs.id, input.runId))
        .returning()

      return {
        kind: "claimed",
        claim: {
          runId: updated.id,
          claimToken: token,
          claimVersion: nextVersion,
        },
        state: updated.state as RunState,
        stateVersion: updated.stateVersion,
      }
    })
  }

  async requestCancellation(runId: string): Promise<{ kind: "cancelled" | "already_cancelled" | "terminal" | "not_found" }> {
    const now = this.clock.nowMs()
    return await this.client.db.transaction(async (tx) => {
      const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update")
      if (!run) return { kind: "not_found" }
      if (TerminalRunStates.some((terminal) => terminal === run.state)) return { kind: "terminal" }
      if (run.cancelRequestedAt) return { kind: "already_cancelled" }
      if (run.state === "queued" || run.state === "accepted") {
        const stateVersion = run.stateVersion + 1
        await tx.update(runs).set({
          state: "cancelled",
          stateVersion,
          terminalReason: "cancelled_by_user",
          cancelRequestedAt: new Date(now),
          updatedAt: new Date(now),
        }).where(eq(runs.id, runId))
        const [last] = await tx.select({ maxSeq: sql<number>`coalesce(max(${events.sequence}), 0)` }).from(events).where(eq(events.runId, runId))
        await tx.insert(events).values({
          id: `cancel:${runId}:${stateVersion}`,
          runId,
          sequence: Number(last?.maxSeq ?? 0) + 1,
          eventType: "run.cancelled",
          schemaVersion: 1,
          payload: { reason: "cancelled_by_user", boundary: "before_claim" },
          payloadDigest: digestOf({ reason: "cancelled_by_user", boundary: "before_claim" }),
          occurredAt: new Date(now),
        })
        return { kind: "cancelled" }
      }
      await tx.update(runs).set({ cancelRequestedAt: new Date(now), updatedAt: new Date(now) }).where(eq(runs.id, runId))
      return { kind: "cancelled" }
    })
  }

  async appendEvent(
    input: { claim: RunClaim; expectedStateVersion: number; event: NewTrajectoryEvent },
    signal?: AbortSignal,
  ): Promise<AppendResult> {
    signal?.throwIfAborted()

    return await this.client.db.transaction(async (tx) => {
      const [run] = await tx.select().from(runs).where(eq(runs.id, input.claim.runId)).for("update")
      if (!run || run.claimToken !== input.claim.claimToken || run.claimVersion !== input.claim.claimVersion) {
        return { kind: "stale", reason: "claim_lost" }
      }
      if (TerminalRunStates.some((terminal) => terminal === run.state) || run.stateVersion !== input.expectedStateVersion) {
        return { kind: "stale", reason: "state_changed" }
      }

      const [maxSeqResult] = await tx
        .select({ maxSeq: sql<number>`coalesce(max(${events.sequence}), 0)` })
        .from(events)
        .where(eq(events.runId, input.claim.runId))

      const nextSequence = Number(maxSeqResult?.maxSeq ?? 0) + 1
      const sanitizedPayload = sanitizeSecrets(input.event.payload) as Record<string, unknown>
      const occurredAt = new Date(input.event.occurredAt)

      await tx.insert(events).values({
        id: input.event.eventId,
        runId: input.claim.runId,
        sequence: nextSequence,
        eventType: input.event.type,
        schemaVersion: input.event.schemaVersion,
        payload: sanitizedPayload,
        payloadDigest: input.event.payloadDigest,
        occurredAt,
      })

      const storedEvent: TrajectoryEvent = {
        ...input.event,
        runId: input.claim.runId,
        sequence: nextSequence,
        payload: sanitizedPayload,
      }

      return {
        kind: "appended",
        event: storedEvent,
      }
    })
  }

  async transition(
    input: Parameters<RunStorePort["transition"]>[0],
    signal?: AbortSignal,
  ): Promise<TransitionResult> {
    signal?.throwIfAborted()

    return await this.client.db.transaction(async (tx) => {
      const [run] = await tx.select().from(runs).where(eq(runs.id, input.claim.runId)).for("update")
      if (!run || run.claimToken !== input.claim.claimToken || run.claimVersion !== input.claim.claimVersion) {
        return { kind: "stale", reason: "claim_lost" }
      }
      if (
        TerminalRunStates.some((terminal) => terminal === run.state) ||
        run.state !== input.expectedState ||
        run.stateVersion !== input.expectedStateVersion
      ) {
        return { kind: "stale", reason: "state_changed" }
      }

      const nextVersion = run.stateVersion + 1
      const terminal = TerminalRunStates.some((state) => state === input.nextState)
      const unpricedAttempts =
        terminal && input.pricing !== "unpriced" && input.costUsd !== null
          ? await tx
              .select({ id: modelAttempts.id })
              .from(modelAttempts)
              .where(and(eq(modelAttempts.runId, input.claim.runId), eq(modelAttempts.pricing, "unpriced")))
              .limit(1)
          : []
      const runIsUnpriced =
        input.pricing === "unpriced" || input.costUsd === null || unpricedAttempts.length > 0
      const updateData: Record<string, unknown> = {
        state: input.nextState,
        stateVersion: nextVersion,
        terminalReason: input.terminalReason ?? null,
        updatedAt: new Date(this.clock.nowMs()),
      }

      if (input.prompt !== undefined) {
        updateData.prompt = redactSecrets(input.prompt)
      }
      if (input.modelProfile !== undefined) {
        updateData.modelProfile = input.modelProfile
      }
      if (input.resultContent !== undefined) {
        updateData.resultContent = redactSecrets(input.resultContent)
      }
      if (input.errorMessage !== undefined) {
        updateData.errorMessage = redactSecrets(input.errorMessage)
      }
      if (input.promptTokens !== undefined) {
        updateData.promptTokens = input.promptTokens
      }
      if (input.completionTokens !== undefined) {
        updateData.completionTokens = input.completionTokens
      }
      if (input.costUsd !== undefined || (terminal && runIsUnpriced)) {
        updateData.costUsd = runIsUnpriced ? null : String(input.costUsd)
      }
      if (input.latencyMs !== undefined) {
        updateData.latencyMs = input.latencyMs
      }

      const [updated] = await tx
        .update(runs)
        .set(updateData)
        .where(eq(runs.id, input.claim.runId))
        .returning()

      return {
        kind: "transitioned",
        stateVersion: updated.stateVersion,
      }
    })
  }

  async loadRun(runId: string, signal?: AbortSignal): Promise<RunRecord | undefined> {
    signal?.throwIfAborted()
    const [run] = await this.client.db.select().from(runs).where(eq(runs.id, runId))
    if (!run) return undefined
    const totalTokens =
      run.promptTokens !== null && run.completionTokens !== null && run.promptTokens !== undefined && run.completionTokens !== undefined
        ? run.promptTokens + run.completionTokens
        : undefined

    return {
      runId: run.id,
      state: run.state as RunState,
      stateVersion: run.stateVersion,
      ...(run.terminalReason ? { terminalReason: run.terminalReason as TerminalReason } : {}),
      ...(run.prompt !== null && run.prompt !== undefined ? { prompt: run.prompt } : {}),
      ...(run.snapshotId !== null && run.snapshotId !== undefined ? { snapshotId: run.snapshotId } : {}),
      ...(run.findingId !== null && run.findingId !== undefined ? { findingId: run.findingId } : {}),
      ...(run.configSnapshot !== null && run.configSnapshot !== undefined ? { configSnapshot: run.configSnapshot } : {}),
      ...(run.modelProfile !== null && run.modelProfile !== undefined ? { modelProfile: run.modelProfile } : {}),
      ...(run.resultContent !== null && run.resultContent !== undefined ? { resultContent: run.resultContent } : {}),
      ...(run.errorMessage !== null && run.errorMessage !== undefined ? { errorMessage: run.errorMessage } : {}),
      ...(run.promptTokens !== null && run.promptTokens !== undefined ? { promptTokens: run.promptTokens } : {}),
      ...(run.completionTokens !== null && run.completionTokens !== undefined ? { completionTokens: run.completionTokens } : {}),
      ...(totalTokens !== undefined ? { totalTokens } : {}),
      ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
      ...(run.latencyMs !== null && run.latencyMs !== undefined ? { latencyMs: run.latencyMs } : {}),
    }
  }

  async findActiveRunsBySnapshot(snapshotId: string): Promise<string[]> {
    const matchingRuns = await this.client.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.snapshotId, snapshotId), notInArray(runs.state, [...TerminalRunStates])))
    return matchingRuns.map((run) => run.id)
  }

  async loadEvents(input: { runId: string; afterSequence?: number }, signal?: AbortSignal): Promise<TrajectoryEvent[]> {
    signal?.throwIfAborted()
    const after = input.afterSequence ?? 0
    const conditions = [eq(events.runId, input.runId)]
    if (after > 0) {
      conditions.push(gt(events.sequence, after))
    }

    const rows = await this.client.db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(asc(events.sequence))

    return rows.map((row) => ({
      eventId: row.id,
      runId: row.runId,
      sequence: row.sequence,
      type: row.eventType as EventType,
      schemaVersion: row.schemaVersion,
      payload: row.payload,
      payloadDigest: row.payloadDigest,
      occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : new Date(row.occurredAt).toISOString(),
    }))
  }

  async seedRun(runId: string, state: RunState = "queued", prompt = "", snapshotId?: string): Promise<void> {
    const existing = await this.loadRun(runId)
    if (existing) {
      throw new Error(`run ${runId} already exists`)
    }
    const now = new Date(this.clock.nowMs())
    await this.client.db.insert(runs).values({
      id: runId,
      state,
      stateVersion: 1,
      claimVersion: 0,
      prompt,
      snapshotId: snapshotId ?? null,
      createdAt: now,
      updatedAt: now,
    })
  }

  async expireLeases(): Promise<void> {
    const past = new Date(this.clock.nowMs() - 1000)
    await this.client.db.update(runs).set({
      claimExpiresAt: past,
    })
  }

  async clear(): Promise<void> {
    await this.client.db.delete(events)
    await this.client.db.delete(modelAttempts)
    await this.client.db.delete(runs)
  }

  async recordModelAttempt(attempt: {
    id: string
    runId: string
    stepIndex?: number
    attemptPurpose?: "reasoning" | "compaction"
    attemptNumber: number
    provider: string
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costUsd: string | number | null
    pricing?: "priced" | "unpriced"
    latencyMs: number
    finishReason?: string | null
    requestJson: Record<string, unknown>
    responseJson?: Record<string, unknown> | null
    errorMessage?: string | null
    errorCategory?: string | null
  }): Promise<void> {
    const purpose = attempt.attemptPurpose ?? "reasoning"
    if (purpose !== "reasoning" && purpose !== "compaction") {
      throw new Error(`Invalid attemptPurpose "${purpose}": must be one of "reasoning" | "compaction"`)
    }
    const stepIndex = attempt.stepIndex ?? 1
    const sanitizedRequest = sanitizeSecrets(attempt.requestJson) as Record<string, unknown>
    const sanitizedResponse = attempt.responseJson
      ? (sanitizeSecrets(attempt.responseJson) as Record<string, unknown>)
      : null
    const sanitizedError = attempt.errorMessage ? redactSecrets(attempt.errorMessage) : null

    await this.client.db
      .insert(modelAttempts)
      .values({
        id: attempt.id,
        runId: attempt.runId,
        stepIndex,
        attemptPurpose: purpose,
        attemptNumber: attempt.attemptNumber,
        provider: attempt.provider,
        model: attempt.model,
        promptTokens: attempt.promptTokens,
        completionTokens: attempt.completionTokens,
        totalTokens: attempt.totalTokens,
        costUsd: attempt.pricing === "unpriced" || attempt.costUsd === null ? null : String(attempt.costUsd),
        pricing: attempt.pricing ?? "priced",
        latencyMs: attempt.latencyMs,
        finishReason: attempt.finishReason ?? null,
        requestJson: sanitizedRequest,
        responseJson: sanitizedResponse,
        errorMessage: sanitizedError,
        errorCategory: attempt.errorCategory ?? null,
      })
      .onConflictDoNothing({
        target: [
          modelAttempts.runId,
          modelAttempts.stepIndex,
          modelAttempts.attemptPurpose,
          modelAttempts.attemptNumber,
        ],
      })
  }

  async loadModelAttempts(runId: string): Promise<Array<typeof modelAttempts.$inferSelect>> {
    return this.client.db
      .select()
      .from(modelAttempts)
      .where(eq(modelAttempts.runId, runId))
      .orderBy(asc(modelAttempts.stepIndex), asc(modelAttempts.attemptNumber))
  }

  async close(): Promise<void> {
    if (this.ownsClient) {
      await this.client.close()
    }
  }
}
