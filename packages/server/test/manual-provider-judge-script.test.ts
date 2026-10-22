import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

describe("manual provider-backed Judge test safeguards", () => {
  test("requires a separate named loopback disposable database and bounds provider spend", async () => {
    const script = await readFile(new URL("../scripts/manual-provider-judge.ts", import.meta.url), "utf8")
    expect(script).toContain("applyEnvFile(await Bun.file(rootEnv).text(), env)")
    expect(script).not.toContain("if (!env.DATABASE_URL && !env.MODEL_API_KEY)")
    expect(script).toContain("HARNESS_MANUAL_JUDGE_DATABASE_URL")
    expect(script).toContain("HARNESS_MANUAL_JUDGE_DEDICATED")
    expect(script).toContain("maxSteps: 2")
    expect(script).toContain("totalTokenBudget: 4096")
    expect(script).toContain("modelMaxOutputTokens: 512")
    expect(script).toContain("attempts.length > 0")
    expect(script).toContain("manualProviderResultSummary")
    expect(script).toContain('"observed"')
    expect(script).toContain('verificationStatus === "UNVERIFIED"')
    expect(script).not.toContain("console.log(error")
  })
})
