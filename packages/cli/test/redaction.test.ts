import { describe, expect, test } from "bun:test"
import { RedactedPlaceholder, RedactedSecretPlaceholder, redactSecrets } from "../src/redaction"

describe("redactSecrets", () => {
  test("masks password and username in postgresql connection urls", () => {
    const raw = "Connecting to postgresql://admin:supersecret@localhost:5432/harness_db..."
    const redacted = redactSecrets(raw)
    expect(redacted).toBe(`Connecting to postgresql://${RedactedPlaceholder}:${RedactedPlaceholder}@localhost:5432/harness_db...`)
    expect(redacted).not.toContain("supersecret")
    expect(redacted).not.toContain("admin")
  })

  test("masks password in complex database urls with special characters", () => {
    const raw = "DATABASE_URL=postgres://user_123:p%40ssw0rd!@db.example.com:5432/prod"
    const redacted = redactSecrets(raw)
    expect(redacted).toBe(`DATABASE_URL=postgres://${RedactedPlaceholder}:${RedactedPlaceholder}@db.example.com:5432/prod`)
    expect(redacted).not.toContain("p%40ssw0rd!")
  })

  test("masks explicit secret strings provided in list", () => {
    const apiKey = "sk-custom-secret-key-99999"
    const raw = `Request failed: invalid key "${apiKey}". Please verify credentials.`
    const redacted = redactSecrets(raw, [apiKey])
    expect(redacted).toBe(`Request failed: invalid key "${RedactedSecretPlaceholder}". Please verify credentials.`)
    expect(redacted).not.toContain(apiKey)
  })

  test("masks standard OpenAI API key formats automatically", () => {
    const raw = "Using key sk-1234567890abcdef1234567890 to call models"
    const redacted = redactSecrets(raw)
    expect(redacted).toContain(RedactedSecretPlaceholder)
    expect(redacted).not.toContain("sk-1234567890abcdef1234567890")
  })

  test("handles empty or safe strings without modification", () => {
    expect(redactSecrets("")).toBe("")
    expect(redactSecrets("Safe log message without secrets")).toBe("Safe log message without secrets")
  })
})
