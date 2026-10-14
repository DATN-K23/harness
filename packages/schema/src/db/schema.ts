// Adapted from OpenCode packages/schema/src/index.ts @ 3f393d78bf (MIT License). See NOTICE.

import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core"

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    prompt: text("prompt").default(""),
    state: varchar("state", { length: 32 }).notNull().default("queued"),
    stateVersion: integer("state_version").notNull().default(1),
    claimToken: text("claim_token"),
    claimVersion: integer("claim_version").notNull().default(0),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    modelProfile: varchar("model_profile", { length: 64 }),
    resultContent: text("result_content"),
    errorMessage: text("error_message"),
    terminalReason: varchar("terminal_reason", { length: 64 }),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("runs_state_idx").on(table.state),
  ],
)

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadDigest: varchar("payload_digest", { length: 128 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("events_run_sequence_idx").on(table.runId, table.sequence),
    index("events_run_id_idx").on(table.runId),
  ],
)

export const modelAttempts = pgTable(
  "model_attempts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    model: varchar("model", { length: 64 }).notNull(),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    finishReason: varchar("finish_reason", { length: 32 }),
    requestJson: jsonb("request_json").$type<Record<string, unknown>>().notNull(),
    responseJson: jsonb("response_json").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    errorCategory: varchar("error_category", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("model_attempts_run_id_idx").on(table.runId),
  ],
)

export type Run = typeof runs.$inferSelect
export type NewRun = typeof runs.$inferInsert
export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type ModelAttempt = typeof modelAttempts.$inferSelect
export type NewModelAttempt = typeof modelAttempts.$inferInsert
