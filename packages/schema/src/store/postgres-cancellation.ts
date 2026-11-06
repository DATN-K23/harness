import type { CancellationPort } from "@harness/protocol"
import { digestOf } from "@harness/core"
import { eq, sql } from "drizzle-orm"
import type { DatabaseClient } from "../db/client"
import { events, runs } from "../db/schema"

export class PostgresCancellation implements CancellationPort {
  constructor(private readonly client: DatabaseClient) {}

  async request(runId: string, signal?: AbortSignal): Promise<{ kind: "requested" | "already_requested" | "terminal" | "not_found" }> {
    signal?.throwIfAborted()
    return await this.client.db.transaction(async (tx) => {
      const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update")
      if (!run) return { kind: "not_found" }
      if (["completed", "failed", "cancelled", "budget_exhausted"].includes(run.state)) return { kind: "terminal" }
      if (run.cancelRequestedAt) return { kind: "already_requested" }
      const now = new Date()
      if (run.state === "queued" || run.state === "accepted") {
        const stateVersion = run.stateVersion + 1
        await tx.update(runs).set({
          state: "cancelled",
          stateVersion,
          terminalReason: "cancelled_by_user",
          cancelRequestedAt: now,
          updatedAt: now,
        }).where(eq(runs.id, runId))
        const [last] = await tx.select({ maxSeq: sql<number>`coalesce(max(${events.sequence}), 0)` })
          .from(events)
          .where(eq(events.runId, runId))
        await tx.insert(events).values({
          id: `cancel:${runId}:${stateVersion}`,
          runId,
          sequence: Number(last?.maxSeq ?? 0) + 1,
          eventType: "run.cancelled",
          schemaVersion: 1,
          payload: { reason: "cancelled_by_user", boundary: "before_claim" },
          payloadDigest: digestOf({ reason: "cancelled_by_user", boundary: "before_claim" }),
          occurredAt: now,
        })
        return { kind: "requested" }
      }
      await tx.update(runs).set({ cancelRequestedAt: now, updatedAt: now }).where(eq(runs.id, runId))
      const [last] = await tx.select({ maxSeq: sql<number>`coalesce(max(${events.sequence}), 0)` })
        .from(events)
        .where(eq(events.runId, runId))
      await tx.insert(events).values({
        id: `cancel-request:${runId}:${run.stateVersion}`,
        runId,
        sequence: Number(last?.maxSeq ?? 0) + 1,
        eventType: "run.cancel_requested",
        schemaVersion: 1,
        payload: {},
        payloadDigest: digestOf({}),
        occurredAt: now,
      })
      return { kind: "requested" }
    })
  }

  async isRequested(runId: string, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    const [run] = await this.client.db.select({ requestedAt: runs.cancelRequestedAt }).from(runs).where(eq(runs.id, runId))
    return run?.requestedAt !== null && run?.requestedAt !== undefined
  }
}
