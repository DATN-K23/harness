import { describe, expect, test } from "bun:test"
import { eq, getTableColumns } from "drizzle-orm"
import { events, idempotencyKeys, modelAttempts, outbox, runs } from "../src/db/schema"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("Schema Definitions for Multi-turn Runner (Sprint 3)", () => {
  test("terminal transition winning a cancellation race remains immutable", async () => {
    const { createDatabaseClient, DEFAULT_DATABASE_URL } = await import("../src/db/client")
    const { PostgresRunStore } = await import("../src/store/postgres-run-store")
    const client = createDatabaseClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 2 })
    const store = new PostgresRunStore({ client })
    const runId = `cancel-complete-race-${Date.now()}`
    try {
      await store.seedRun(runId, "running")
      const claimed = await store.claim({ runId, workerId: "worker-race" })
      if (claimed.kind !== "claimed") throw new Error("expected run claim")
      await store.transition({
        claim: claimed.claim,
        expectedState: "running",
        expectedStateVersion: claimed.stateVersion,
        nextState: "completed",
        resultContent: "done",
      })
      expect(await store.requestCancellation(runId)).toEqual({ kind: "terminal" })
      expect((await store.loadRun(runId))?.state).toBe("completed")
      expect((await client.db.select().from(events).where(eq(events.runId, runId)))).toHaveLength(0)
    } finally {
      await client.db.delete(runs).where(eq(runs.id, runId))
      await client.close()
    }
  })

  test("PostgresCancellation request is visible to subsequent runner boundary polls", async () => {
    const { createDatabaseClient, DEFAULT_DATABASE_URL } = await import("../src/db/client")
    const { PostgresCancellation } = await import("../src/store/postgres-cancellation")
    const { PostgresRunStore } = await import("../src/store/postgres-run-store")
    const client = createDatabaseClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 1 })
    const store = new PostgresRunStore({ client })
    const cancellation = new PostgresCancellation(client)
    const runId = `cancel-signal-${Date.now()}`
    try {
      await store.seedRun(runId, "running")
      expect(await cancellation.isRequested(runId)).toBe(false)
      await cancellation.request(runId)
      expect(await cancellation.isRequested(runId)).toBe(true)
      await cancellation.request(runId)
      expect(await cancellation.isRequested(runId)).toBe(true)
      const requestedEvents = await client.db.select().from(events).where(eq(events.runId, runId))
      expect(requestedEvents.map(({ eventType }) => eventType)).toEqual(["run.cancel_requested"])
    } finally {
      await client.db.delete(runs).where(eq(runs.id, runId))
      await client.close()
    }
  })

  test("queued cancellation is durable, idempotent, and prevents run claim", async () => {
    const { createDatabaseClient, DEFAULT_DATABASE_URL } = await import("../src/db/client")
    const { PostgresRunStore } = await import("../src/store/postgres-run-store")
    const client = createDatabaseClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 2 })
    const store = new PostgresRunStore({ client })
    const runId = `cancel-queued-${Date.now()}`

    try {
      await store.admit({
        runId,
        findingId: "finding-cancel",
        reportMarkdown: "A report",
        snapshotId: "snapshot-1",
        config: {},
        idempotencyKey: `key-${runId}`,
        requestDigest: `sha256:${"6".repeat(64)}`,
      })
      expect(await store.requestCancellation(runId)).toEqual({ kind: "cancelled" })
      expect(await store.requestCancellation(runId)).toEqual({ kind: "terminal" })
      expect((await store.loadRun(runId))?.state).toBe("cancelled")
      expect(await store.claim({ runId, workerId: "worker-after-cancel" })).toEqual({ kind: "unavailable", reason: "terminal" })
      const eventRows = await client.db.select().from(events).where(eq(events.runId, runId))
      expect(eventRows.map(({ eventType }) => eventType)).toEqual(["run.cancelled"])
    } finally {
      await client.db.delete(runs).where(eq(runs.id, runId))
      await client.close()
    }
  })

  test("concurrent identical admissions converge on one run ID", async () => {
    const { createDatabaseClient, DEFAULT_DATABASE_URL } = await import("../src/db/client")
    const { PostgresRunStore } = await import("../src/store/postgres-run-store")
    const client = createDatabaseClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 4 })
    const store = new PostgresRunStore({ client })
    const base = `admission-race-${Date.now()}`
    const input = {
      findingId: "finding-race",
      reportMarkdown: "A report",
      snapshotId: "snapshot-1",
      config: {},
      idempotencyKey: `key-${base}`,
      requestDigest: `sha256:${"7".repeat(64)}`,
    }

    try {
      const result = await Promise.all([
        store.admit({ ...input, runId: `${base}-a` }),
        store.admit({ ...input, runId: `${base}-b` }),
      ])
      expect(result.every((item) => item.kind !== "conflict")).toBe(true)
      const [first, second] = result
      if (first.kind === "conflict" || second.kind === "conflict") throw new Error("identical concurrent requests must not conflict")
      expect([first.runId, second.runId]).toEqual([first.runId, first.runId])
      expect(await client.db.select().from(runs).where(eq(runs.id, first.runId))).toHaveLength(1)
      expect(await client.db.select().from(outbox).where(eq(outbox.runId, first.runId))).toHaveLength(1)
    } finally {
      await client.db.delete(runs).where(eq(runs.findingId, "finding-race"))
      await client.close()
    }
  })

  test("expired outbox claim can be reclaimed after publisher failure", async () => {
    const { createDatabaseClient, DEFAULT_DATABASE_URL } = await import("../src/db/client")
    const { PostgresRunStore } = await import("../src/store/postgres-run-store")
    const client = createDatabaseClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 1 })
    let now = Date.now()
    const store = new PostgresRunStore({ client, clock: { nowMs: () => now } })
    const runId = `outbox-lease-${Date.now()}`

    try {
      await store.admit({
        runId,
        findingId: "finding-1",
        reportMarkdown: "A report",
        snapshotId: "snapshot-1",
        config: {},
        idempotencyKey: `key-${runId}`,
        requestDigest: `sha256:${"8".repeat(64)}`,
      })
      expect(await store.claimOutbox(runId, 500)).toBe(true)
      expect(await store.claimOutbox(runId, 500)).toBe(false)
      now += 501
      expect(await store.claimOutbox(runId, 500)).toBe(true)
    } finally {
      await client.db.delete(runs).where(eq(runs.id, runId))
      await client.close()
    }
  })

  test("two outbox publishers cannot both claim the same pending item", async () => {
    const { createDatabaseClient, DEFAULT_DATABASE_URL } = await import("../src/db/client")
    const { PostgresRunStore } = await import("../src/store/postgres-run-store")
    const client = createDatabaseClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 2 })
    const firstStore = new PostgresRunStore({ client })
    const secondStore = new PostgresRunStore({ client })
    const runId = `outbox-race-${Date.now()}`

    try {
      await firstStore.admit({
        runId,
        findingId: "finding-1",
        reportMarkdown: "A report",
        snapshotId: "snapshot-1",
        config: {},
        idempotencyKey: `key-${runId}`,
        requestDigest: `sha256:${"9".repeat(64)}`,
      })
      const claimed = await Promise.all([firstStore.claimOutbox(runId), secondStore.claimOutbox(runId)])
      expect(claimed.filter(Boolean)).toHaveLength(1)
    } finally {
      await client.db.delete(runs).where(eq(runs.id, runId))
      await client.close()
    }
  })

  test("outbox exposes committed work until published, and publication is idempotent", async () => {
    const { createDatabaseClient, DEFAULT_DATABASE_URL } = await import("../src/db/client")
    const { PostgresRunStore } = await import("../src/store/postgres-run-store")
    const client = createDatabaseClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 1 })
    const store = new PostgresRunStore({ client })
    const runId = `outbox-publisher-${Date.now()}`

    try {
      await store.admit({
        runId,
        findingId: "finding-1",
        reportMarkdown: "A report",
        snapshotId: "snapshot-1",
        config: {},
        idempotencyKey: `key-${runId}`,
        requestDigest: `sha256:${"f".repeat(64)}`,
      })
      expect(await store.loadPendingOutbox()).toEqual([runId])
      expect(await store.claimOutbox(runId)).toBe(true)
      expect(await store.markOutboxPublished(runId)).toBe(true)
      expect(await store.markOutboxPublished(runId)).toBe(false)
      expect(await store.loadPendingOutbox()).toEqual([])
    } finally {
      await client.db.delete(runs).where(eq(runs.id, runId))
      await client.close()
    }
  })

  test("admit replays an identical idempotency key and conflicts on a different digest", async () => {
    const { createDatabaseClient, DEFAULT_DATABASE_URL } = await import("../src/db/client")
    const { PostgresRunStore } = await import("../src/store/postgres-run-store")
    const client = createDatabaseClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 1 })
    const store = new PostgresRunStore({ client })
    const firstRunId = `admission-idempotency-a-${Date.now()}`
    const secondRunId = `${firstRunId}-b`
    const idempotencyKey = `key-${firstRunId}`
    const requestDigest = `sha256:${"d".repeat(64)}`
    const admission = {
      findingId: "finding-1",
      reportMarkdown: "A report",
      snapshotId: "snapshot-1",
      config: {},
      idempotencyKey,
      requestDigest,
    }

    try {
      expect(await store.admit({ ...admission, runId: firstRunId })).toEqual({ kind: "accepted", runId: firstRunId })
      expect(await store.admit({ ...admission, runId: secondRunId })).toEqual({ kind: "replayed", runId: firstRunId })
      expect(await store.admit({
        ...admission,
        runId: `${secondRunId}-conflict`,
        requestDigest: `sha256:${"e".repeat(64)}`,
      })).toEqual({ kind: "conflict" })
      expect(await client.db.select().from(runs).where(eq(runs.id, secondRunId))).toHaveLength(0)
      expect(await client.db.select().from(outbox).where(eq(outbox.runId, firstRunId))).toHaveLength(1)
    } finally {
      await client.db.delete(runs).where(eq(runs.id, firstRunId))
      await client.close()
    }
  })

  test("admit persists finding identity and immutable run configuration", async () => {
    const { createDatabaseClient, DEFAULT_DATABASE_URL } = await import("../src/db/client")
    const { PostgresRunStore } = await import("../src/store/postgres-run-store")
    const client = createDatabaseClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 1 })
    const store = new PostgresRunStore({ client })
    const runId = `admission-config-${Date.now()}`
    const idempotencyKey = `key-${runId}`
    const config = { profileId: "research-default", maxSteps: 8 }

    try {
      await store.admit({
        runId,
        findingId: "finding-specific",
        reportMarkdown: "A report",
        snapshotId: "snapshot-1",
        config,
        idempotencyKey,
        requestDigest: `sha256:${"c".repeat(64)}`,
      })
      const [run] = await client.db.select().from(runs).where(eq(runs.id, runId))
      expect(run.findingId).toBe("finding-specific")
      expect(run.configSnapshot).toEqual(config)
      expect(await client.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, idempotencyKey))).toHaveLength(1)
      expect(await client.db.select().from(outbox).where(eq(outbox.runId, runId))).toHaveLength(1)
    } finally {
      await client.db.delete(runs).where(eq(runs.id, runId))
      await client.close()
    }
  })

  test("idempotency conflict creates no run or outbox and retains the original binding", async () => {
    const { createDatabaseClient, DEFAULT_DATABASE_URL } = await import("../src/db/client")
    const { PostgresRunStore } = await import("../src/store/postgres-run-store")
    const client = createDatabaseClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 1 })
    const store = new PostgresRunStore({ client })
    const existingRunId = `admission-existing-${Date.now()}`
    const runId = `admission-rollback-${Date.now()}`
    const idempotencyKey = `key-${existingRunId}`

    try {
      await store.seedRun(existingRunId)
      await client.db.insert(idempotencyKeys).values({
        key: idempotencyKey,
        requestDigest: `sha256:${"b".repeat(64)}`,
        runId: existingRunId,
      })
      expect(await store.admit({
          runId,
          findingId: "finding-1",
          reportMarkdown: "A report",
          snapshotId: "snapshot-1",
          config: {},
          idempotencyKey,
          requestDigest: `sha256:${"a".repeat(64)}`,
        })).toEqual({ kind: "conflict" })
      expect(await client.db.select().from(runs).where(eq(runs.id, runId))).toHaveLength(0)
      expect(await client.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, idempotencyKey))).toMatchObject([
        { runId: existingRunId },
      ])
      expect(await client.db.select().from(outbox).where(eq(outbox.runId, runId))).toHaveLength(0)
    } finally {
      await client.db.delete(runs).where(eq(runs.id, existingRunId))
      await client.db.delete(runs).where(eq(runs.id, runId))
      await client.close()
    }
  })

  test("admission tables persist idempotency bindings and durable work intent", () => {
    const idempotencyColumns = getTableColumns(idempotencyKeys)
    expect(idempotencyColumns.key.name).toBe("key")
    expect(idempotencyColumns.requestDigest.name).toBe("request_digest")
    expect(idempotencyColumns.runId.name).toBe("run_id")

    const outboxColumns = getTableColumns(outbox)
    expect(outboxColumns.runId.name).toBe("run_id")
    expect(outboxColumns.status.notNull).toBe(true)
    expect(outboxColumns.publishedAt.notNull).toBe(false)
  })

  test("runs table includes nullable snapshotId column", () => {
    const columns = getTableColumns(runs)
    expect(columns.snapshotId).toBeDefined()
    expect(columns.snapshotId.name).toBe("snapshot_id")
    expect(columns.snapshotId.notNull).toBe(false)
  })

  test("model_attempts includes stepIndex and attemptPurpose with default values", () => {
    const columns = getTableColumns(modelAttempts)
    expect(columns.stepIndex).toBeDefined()
    expect(columns.stepIndex.name).toBe("step_index")
    expect(columns.stepIndex.notNull).toBe(true)
    expect(columns.stepIndex.default).toBe(1)

    expect(columns.attemptPurpose).toBeDefined()
    expect(columns.attemptPurpose.name).toBe("attempt_purpose")
    expect(columns.attemptPurpose.notNull).toBe(true)
    expect(columns.attemptPurpose.default).toBe("reasoning")

    expect(columns.costUsd.notNull).toBe(false)
    expect(columns.pricing).toBeDefined()
    expect(columns.pricing.name).toBe("pricing")
    expect(columns.pricing.notNull).toBe(true)
    expect(columns.pricing.default).toBe("priced")
  })

  test("migration SQL file exists and contains valid additive statements", () => {
    const migrationPath = resolve(import.meta.dir, "../drizzle/0001_multi_turn_runner.sql")
    const sql = readFileSync(migrationPath, "utf-8")
    expect(sql).toContain('ALTER TABLE "runs" ADD COLUMN "snapshot_id" text')
    expect(sql).toContain('ALTER TABLE "model_attempts" ADD COLUMN "step_index" integer DEFAULT 1 NOT NULL')
    expect(sql).toContain('ALTER TABLE "model_attempts" ADD COLUMN "attempt_purpose" varchar(32) DEFAULT \'reasoning\' NOT NULL')
    expect(sql).toContain('CREATE UNIQUE INDEX "model_attempts_run_step_purpose_attempt_idx"')

    const pricingMigration = readFileSync(resolve(import.meta.dir, "../drizzle/0002_attempt_pricing.sql"), "utf-8")
    expect(pricingMigration).toContain('ALTER TABLE "model_attempts" ALTER COLUMN "cost_usd" DROP NOT NULL')
    expect(pricingMigration).toContain('ADD COLUMN "pricing" varchar(16) DEFAULT \'priced\' NOT NULL')
    expect(pricingMigration.match(/--> statement-breakpoint/g)).toHaveLength(2)

    const admissionMigration = readFileSync(resolve(import.meta.dir, "../drizzle/0003_lowly_gorilla_man.sql"), "utf-8")
    expect(admissionMigration).toContain('CREATE TABLE "idempotency_keys"')
    expect(admissionMigration).toContain('CREATE TABLE "outbox"')
    expect(admissionMigration).not.toContain('ADD COLUMN "step_index"')
    expect(admissionMigration).not.toContain('ADD COLUMN "snapshot_id"')
  })
})
