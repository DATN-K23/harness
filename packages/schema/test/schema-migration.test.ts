import { describe, expect, test } from "bun:test"
import { getTableColumns } from "drizzle-orm"
import { modelAttempts, runs } from "../src/db/schema"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("Schema Definitions for Multi-turn Runner (Sprint 3)", () => {
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
  })
})
