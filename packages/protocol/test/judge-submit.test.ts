import { describe, expect, test } from "bun:test"
import { JudgeSubmitRequestSchema } from "../src/judge-submit"

describe("JudgeSubmitRequestSchema", () => {
  const valid = {
    finding: { findingId: "finding-1", reportMarkdown: "Possible reentrancy." },
    snapshotId: "snapshot-1",
  }

  test("accepts a bounded finding and opaque snapshot ID", () => {
    expect(JudgeSubmitRequestSchema.safeParse(valid).success).toBe(true)
  })

  test("rejects ground-truth, scoring and credential fields recursively", () => {
    const result = JudgeSubmitRequestSchema.safeParse({
      ...valid,
      metadata: [{ audit: { GroundTruthLabel: "valid" } }],
    })

    expect(result.success).toBe(false)
  })

  test("rejects empty, oversized, incorrectly typed and unknown fields", () => {
    expect(JudgeSubmitRequestSchema.safeParse({ ...valid, snapshotId: " " }).success).toBe(false)
    expect(
      JudgeSubmitRequestSchema.safeParse({
        ...valid,
        finding: { ...valid.finding, reportMarkdown: "x".repeat(100_001) },
      }).success,
    ).toBe(false)
    expect(JudgeSubmitRequestSchema.safeParse({ ...valid, finding: "report" }).success).toBe(false)
    expect(JudgeSubmitRequestSchema.safeParse({ ...valid, extra: true }).success).toBe(false)
  })
})
