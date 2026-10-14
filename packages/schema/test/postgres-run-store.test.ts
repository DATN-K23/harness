import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { EventSchemaVersion, type EventType, type NewTrajectoryEvent, type RunState } from "@harness/protocol"
import { runStoreContractTests, type RunStoreHarness } from "@harness/core/testing"
import { eq } from "drizzle-orm"
import postgres from "postgres"
import { createDatabaseClient, DEFAULT_DATABASE_URL } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"
import { events, modelAttempts, runs } from "../src/db/schema"
import { PostgresRunStore } from "../src/store/postgres-run-store"
import { redactSecrets, sanitizeSecrets } from "../src/store/redaction"

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

  describe("PostgresRunStore Conformance (PostgreSQL)", () => {
    const client = createDatabaseClient({ url: testDatabaseUrl, max: 5 })
    let store: PostgresRunStore

    beforeAll(async () => {
      store = new PostgresRunStore({ client })
      await store.clear()
    })

    afterAll(async () => {
      await store.clear()
      await client.close()
    })

    const makeHarness = async (): Promise<RunStoreHarness> => {
      await store.clear()
      return {
        store,
        seedRun: (runId: string, state?: RunState) => store.seedRun(runId, state),
        expireLeases: () => store.expireLeases(),
      }
    }

    runStoreContractTests(makeHarness)
  })
} else {
  describe.skip("PostgresRunStore Conformance (PostgreSQL unavailable)", () => {
    test("skipped because PostgreSQL is not reachable at DATABASE_URL", () => {})
  })
}

describe("Secret Sanitization", () => {
  test("redactSecrets redacts connection passwords and known secret patterns", () => {
    const textWithUrl = "Database connected at postgresql://admin:super_secret_pw@db.internal:5432/prod"
    expect(redactSecrets(textWithUrl)).toBe("Database connected at postgresql://***:***@db.internal:5432/prod")

    const textWithKey = "API key was sk-1234567890abcdef12345678 and failed"
    expect(redactSecrets(textWithKey)).toBe("API key was [REDACTED] and failed")

    const textWithBearer = "Authorization header: Bearer my-secret-jwt-token-value-here"
    expect(redactSecrets(textWithBearer)).toBe("Authorization header: Bearer [REDACTED]")
  })

  test("sanitizeSecrets deeply sanitizes sensitive object keys and values", () => {
    const payload = {
      label: "model-call",
      apiKey: "sk-test-secret-1234567890",
      nested: {
        password: "my-clear-password",
        databaseUrl: "postgresql://user:pass@host:5432/db",
        normal: "safe-value",
      },
      list: [{ secret: "token-value" }, "just a string with sk-abcdef1234567890123456"],
    }

    const sanitized = sanitizeSecrets(payload) as Record<string, unknown>
    expect(sanitized.apiKey).toBe("[REDACTED]")
    const nested = sanitized.nested as Record<string, unknown>
    expect(nested.password).toBe("[REDACTED]")
    expect(nested.databaseUrl).toBe("postgresql://***:***@host:5432/db")
    expect(nested.normal).toBe("safe-value")

    const list = sanitized.list as Array<Record<string, unknown> | string>
    expect((list[0] as Record<string, unknown>).secret).toBe("[REDACTED]")
    expect(list[1]).toBe("just a string with [REDACTED]")
  })

  if (postgresAvailable) {
    test("PostgresRunStore redacts secrets in appendEvent and recordModelAttempt", async () => {
      const client = createDatabaseClient({ url: testDatabaseUrl, max: 2 })
      const store = new PostgresRunStore({ client })
      await store.clear()

      try {
        await store.seedRun("run-secret-test", "queued")
        const claimResult = await store.claim({ runId: "run-secret-test", workerId: "worker-s" })
        if (claimResult.kind !== "claimed") throw new Error("claim failed")

        const eventWithSecret: NewTrajectoryEvent = {
          eventId: "evt-secret-1",
          type: "model.responded" as EventType,
          schemaVersion: EventSchemaVersion,
          payload: {
            apiKey: "sk-secret-key-1234567890",
            output: "hello world",
          },
          payloadDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          occurredAt: new Date().toISOString(),
        }

        const appendResult = await store.appendEvent({
          claim: claimResult.claim,
          expectedStateVersion: claimResult.stateVersion,
          event: eventWithSecret,
        })
        expect(appendResult.kind).toBe("appended")

        const loadedEvents = await store.loadEvents({ runId: "run-secret-test" })
        expect(loadedEvents).toHaveLength(1)
        expect(loadedEvents[0].payload.apiKey).toBe("[REDACTED]")
        expect(loadedEvents[0].payload.output).toBe("hello world")

        // Test model attempt sanitization directly against database row
        await store.recordModelAttempt({
          id: "attempt-1",
          runId: "run-secret-test",
          attemptNumber: 1,
          provider: "openai",
          model: "gpt-4o",
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          costUsd: "0.001",
          latencyMs: 150,
          requestJson: {
            headers: { authorization: "Bearer sk-secret-bearer-token" },
            prompt: "ping",
          },
          responseJson: {
            choices: [{ text: "pong" }],
            secretToken: "sk-nested-key-1234567890",
          },
          errorMessage: "Failed with sk-secret-in-error-1234567890",
        })

        const [attemptRow] = await client.db
          .select()
          .from(modelAttempts)
          .where(eq(modelAttempts.id, "attempt-1"))

        expect(attemptRow).toBeDefined()
        const reqJson = attemptRow.requestJson as { headers: { authorization: string } }
        expect(reqJson.headers.authorization).toBe("[REDACTED]")
        const resJson = attemptRow.responseJson as { secretToken: string }
        expect(resJson.secretToken).toBe("[REDACTED]")
        expect(attemptRow.errorMessage).toBe("Failed with [REDACTED]")
      } finally {
        await store.clear()
        await client.close()
      }
    })
  }
})
