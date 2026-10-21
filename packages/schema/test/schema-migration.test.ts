import { describe, expect, test } from "bun:test"
import { eq, getTableColumns } from "drizzle-orm"
import { idempotencyKeys, modelAttempts, outbox, runs } from "../src/db/schema"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("Schema Definitions for Multi-turn Runner (Sprint 3)", () => {
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

  test("admission transaction rolls back run, idempotency key and outbox together", async () => {
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
      await expect(
        store.admit({
          runId,
          findingId: "finding-1",
          reportMarkdown: "A report",
          snapshotId: "snapshot-1",
          config: {},
          idempotencyKey,
          requestDigest: `sha256:${"a".repeat(64)}`,
        }),
      ).rejects.toThrow()
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
