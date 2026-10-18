import { describe, expect, test } from "bun:test"
import {
  canonicalize,
  DefaultMaxProbeRuns,
  DefaultRetryConfig,
  ResolvedFlagNames,
  RunConfigSnapshotSchema,
  Sha256DigestSchema,
  type RunConfigSnapshot,
} from "../src/run-config"
import { digest, snapshot } from "./fixtures"

const oracle = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([left], [right]) => (left < right ? -1 : 1)))
      : inner,
  )

const reversed = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reversed)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, inner]) => [key, reversed(inner)]),
  )
}

const withObsMasking = (base: RunConfigSnapshot, enabled: boolean): RunConfigSnapshot => ({
  ...base,
  flags: { ...base.flags, enableObsMasking: enabled },
  contextPolicy: { ...base.contextPolicy, flags: { ...base.contextPolicy.flags, enableObsMasking: enabled } },
})

describe("canonicalize", () => {
  test("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalize({ b: 1, a: { d: [3, 2, 1], c: "x" } })).toBe('{"a":{"c":"x","d":[3,2,1]},"b":1}')
  })

  test("omits undefined properties like JSON and escapes strings", () => {
    expect(canonicalize({ a: undefined, b: 'q"\n', c: null })).toBe('{"b":"q\\"\\n","c":null}')
  })

  test("agrees with an independent sorted-key JSON oracle", () => {
    const value = snapshot()
    expect(canonicalize(value)).toBe(oracle(value))
  })

  test("refuses values that have no stable JSON form", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError)
    expect(() => canonicalize({ a: Infinity })).toThrow(TypeError)
    expect(() => canonicalize({ a: () => 1 })).toThrow(TypeError)
    expect(() => canonicalize(undefined)).toThrow(TypeError)
    expect(() => canonicalize({ a: 10n })).toThrow(TypeError)
  })
})

describe("run configuration snapshot", () => {
  test("equal configuration in a different key order canonicalizes identically", () => {
    const base = snapshot()
    expect(canonicalize(reversed(base))).toBe(canonicalize(base))
    expect(Object.keys(reversed(base) as object)).not.toEqual(Object.keys(base))
  })

  test("a changed flag changes the canonical form", () => {
    const base = snapshot()
    expect(canonicalize(withObsMasking(base, false))).not.toBe(canonicalize(base))
  })

  test("a changed TV1-only flag changes the canonical form", () => {
    const base = snapshot()
    const changed = { ...base, flags: { ...base.flags, enableInfraRetry: false } }
    expect(canonicalize(changed)).not.toBe(canonicalize(base))
  })

  test("parses a complete snapshot", () => {
    expect(RunConfigSnapshotSchema.safeParse(snapshot()).success).toBe(true)
  })

  test("rejects a snapshot missing a required part", () => {
    const { retry: _omitted, ...rest } = snapshot()
    expect(RunConfigSnapshotSchema.safeParse(rest).success).toBe(false)
  })

  test("rejects flags that disagree with the context policy flags", () => {
    const base = snapshot()
    const result = RunConfigSnapshotSchema.safeParse({ ...base, flags: { ...base.flags, enableObsMasking: false } })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toEqual(["flags", "enableObsMasking"])
  })

  test("rejects malformed digests", () => {
    expect(RunConfigSnapshotSchema.safeParse({ ...snapshot(), systemPromptDigest: "abc" }).success).toBe(false)
    expect(Sha256DigestSchema.safeParse(digest("f")).success).toBe(true)
    expect(Sha256DigestSchema.safeParse(digest("F")).success).toBe(false)
  })
  test("snapshot without maxToolCalls produces identical canonical form to explicit undefined", () => {
    const base = snapshot()
    expect(base.budget.maxToolCalls).toBeUndefined()
    const canonicalBefore = canonicalize(base)
    const withExplicitUndefined = {
      ...base,
      budget: { ...base.budget, maxToolCalls: undefined },
    }
    expect(canonicalize(withExplicitUndefined)).toBe(canonicalBefore)

    // With explicit maxToolCalls, canonical form changes predictably
    const withCap = {
      ...base,
      budget: { ...base.budget, maxToolCalls: 20 },
    }
    expect(canonicalize(withCap)).not.toBe(canonicalBefore)
    expect(RunConfigSnapshotSchema.safeParse(withCap).success).toBe(true)
  })
})

describe("resolved flags and defaults", () => {
  test("lists the six TV2 flags and the five TV1 flags", () => {
    expect<string[]>([...ResolvedFlagNames].sort()).toEqual(
      [
        "enableToolTruncation",
        "enableObsMasking",
        "enableSupersedeReads",
        "enableDropEmpty",
        "enableLlmCompaction",
        "enableSessionNote",
        "enableSchemaRepair",
        "enableMaxStepsForcing",
        "enableNoProgressDetection",
        "enableInfraRetry",
        "enableParallelToolDispatch",
      ].sort(),
    )
    expect(Object.keys(snapshot().flags).sort()).toEqual([...ResolvedFlagNames].sort())
  })

  test("retry defaults follow the design document", () => {
    expect(DefaultRetryConfig).toEqual({
      maxRetries: 5,
      maxTimeoutRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 10000,
      jitterMs: 1000,
      retryableStatuses: [429, 500, 503],
    })
    expect(DefaultMaxProbeRuns).toBe(2)
  })
})
