// Adapted from OpenCode packages/cli/test/cli-e2e-persistence.test.ts @ 3f393d78bf (MIT License). See NOTICE.
import { describe, expect, test } from "bun:test"
import postgres from "postgres"
import { DEFAULT_DATABASE_URL, PostgresRunStore, runMigrations } from "@harness/schema"
import { ScriptedModelGateway, textResponse } from "@harness/core/testing"
import { executeRunCommand } from "../src/commands/run"
import { executeViewCommand } from "../src/commands/view"

const testDatabaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL

const checkPostgresReachable = async (url: string): Promise<boolean> => {
  try {
    const sql = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} })
    await sql`SELECT 1`
    await sql.end({ timeout: 2 })
    return true
  } catch {
    return false
  }
}

const postgresAvailable = await checkPostgresReachable(testDatabaseUrl)

if (postgresAvailable) {
  // Ensure migrations are up to date before testing
  await runMigrations({ url: testDatabaseUrl })

  describe("CLI E2E Persistence Integration (PostgreSQL)", () => {
    test("persists run execution to Postgres and inspects it via fresh store instance across simulated restart", async () => {
      const store1 = new PostgresRunStore({ url: testDatabaseUrl })
      const mockModelOutput =
        "Reentrancy is a vulnerability where external calls can hijack control flow before state is updated."
      const gateway = new ScriptedModelGateway([
        textResponse(mockModelOutput, {
          usage: { promptTokens: 25, completionTokens: 50, totalTokens: 75, costUsd: 0.000375 },
        }),
      ])

      const promptText = "What are reentrancy attacks in smart contracts?"
      const runRes = await executeRunCommand(
        { prompt: promptText, model: "mock-model" },
        { store: store1, gateway },
      )

      expect(runRes.exitCode).toBe(0)
      expect(runRes.result).toBeDefined()
      expect(runRes.result?.state).toBe("completed")
      expect(runRes.result?.runId).toBeDefined()

      const runId = runRes.result!.runId
      await store1.close()

      // Simulate a separate CLI process after restart: create a BRAND NEW PostgresRunStore instance
      const store2 = new PostgresRunStore({ url: testDatabaseUrl })
      const viewRes = await executeViewCommand({ id: runId }, { store: store2 })

      expect(viewRes.exitCode).toBe(0)
      expect(viewRes.output).toContain(runId)
      expect(viewRes.output).toContain("completed")
      expect(viewRes.output).toContain(promptText)
      expect(viewRes.output).toContain(mockModelOutput)
      expect(viewRes.output).toContain("Latency:")
      expect(viewRes.output).toContain("Tokens:")
      expect(viewRes.output).toContain("Cost:")
      expect(viewRes.output).toContain("run.queued")
      expect(viewRes.output).toContain("run.started")
      expect(viewRes.output).toContain("provider.attempted")

      await store2.close()
    })
  })
} else {
  describe.skip("CLI E2E Persistence Integration (PostgreSQL unavailable)", () => {
    test("skipped because live PostgreSQL is not reachable at DATABASE_URL; in-memory fallback was verified in cli-run.test.ts and cli-view.test.ts", () => {})
  })
}
