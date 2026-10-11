import { describe, expect, test } from "bun:test"
import {
  ContextFlagNames,
  DefaultMaxProbeRuns,
  DefaultRetryConfig,
  ResolvedFlagNames,
  RunConfigSnapshotSchema,
  type ContextPolicy,
  type ResolvedFlagName,
  type ResolvedFlags,
  type RunConfigSnapshot,
} from "@harness/protocol"
import { buildRunConfigSnapshot, type RunConfigInput } from "../../src/runner/run-config"
import { digestOf, sha256Hex } from "../../src/util/digest"

const allOn = Object.fromEntries(ResolvedFlagNames.map((name) => [name, true])) as ResolvedFlags

const policyFor = (flags: ResolvedFlags): ContextPolicy => ({
  policyVersion: "v1",
  windowLimitTokens: 128_000,
  outputReserveTokens: 8_000,
  compactionThreshold: 0.8,
  recentWindowTokens: 20_000,
  toolOutputMaxTokens: 4_000,
  toolOutputMaxLines: 200,
  maxCompactions: 2,
  flags: Object.fromEntries(ContextFlagNames.map((name) => [name, flags[name]])) as ContextPolicy["flags"],
})

const inputWith = (flags: ResolvedFlags): RunConfigInput => ({
  flags,
  policy: policyFor(flags),
  retry: DefaultRetryConfig,
  limits: {
    wallClockTimeoutMs: 600_000,
    costCeilingUsd: 5,
    totalTokenBudget: 400_000,
    maxSteps: 25,
    noProgressMaxRepeats: 3,
  },
  systemPromptDigest: `sha256:${sha256Hex("system prompt")}`,
  verdictSchemaDigest: `sha256:${sha256Hex("verdict schema")}`,
})

const flipped = (name: ResolvedFlagName) => ({ ...allOn, [name]: !allOn[name] })

describe("buildRunConfigSnapshot", () => {
  test("returns a schema-valid snapshot and the digest of its canonical form", () => {
    const { snapshot, digest } = buildRunConfigSnapshot(inputWith(allOn))
    expect(RunConfigSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(digest).toBe(digestOf(snapshot))
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(snapshot.maxProbeRuns).toBe(DefaultMaxProbeRuns)
    expect(snapshot.contextPolicy).toEqual(inputWith(allOn).policy)
    expect(snapshot.budget).toEqual(inputWith(allOn).limits)
  })

  test("the digest is stable across calls", () => {
    expect(buildRunConfigSnapshot(inputWith(allOn)).digest).toBe(buildRunConfigSnapshot(inputWith(allOn)).digest)
  })

  test.each([...ResolvedFlagNames])("flipping %s changes the digest", (name) => {
    const before = buildRunConfigSnapshot(inputWith(allOn))
    const after = buildRunConfigSnapshot(inputWith(flipped(name)))
    expect(after.snapshot.flags[name]).toBe(!before.snapshot.flags[name])
    expect(after.digest).not.toBe(before.digest)
  })

  test("all eleven flags produce eleven distinct digests", () => {
    expect(ResolvedFlagNames).toHaveLength(11)
    const digests = ResolvedFlagNames.map((name) => buildRunConfigSnapshot(inputWith(flipped(name))).digest)
    expect(new Set([...digests, buildRunConfigSnapshot(inputWith(allOn)).digest]).size).toBe(12)
  })

  test("key order of the inputs does not change the digest", () => {
    const input = inputWith(allOn)
    const reversed: RunConfigInput = {
      verdictSchemaDigest: input.verdictSchemaDigest,
      systemPromptDigest: input.systemPromptDigest,
      limits: Object.fromEntries(Object.entries(input.limits).reverse()) as RunConfigInput["limits"],
      retry: Object.fromEntries(Object.entries(input.retry).reverse()) as RunConfigInput["retry"],
      policy: { ...Object.fromEntries(Object.entries(input.policy).reverse()) } as ContextPolicy,
      flags: Object.fromEntries(Object.entries(input.flags).reverse()) as ResolvedFlags,
    }
    expect(buildRunConfigSnapshot(reversed).digest).toBe(buildRunConfigSnapshot(input).digest)
  })

  test("policy, retry, budget, probe cap and the two digests are all covered", () => {
    const base = buildRunConfigSnapshot(inputWith(allOn)).digest
    const input = inputWith(allOn)
    const variants: RunConfigInput[] = [
      { ...input, policy: { ...input.policy, windowLimitTokens: 64_000 } },
      { ...input, retry: { ...input.retry, maxRetries: 1 } },
      { ...input, limits: { ...input.limits, maxSteps: 10 } },
      { ...input, maxProbeRuns: 5 },
      { ...input, systemPromptDigest: `sha256:${sha256Hex("other prompt")}` },
      { ...input, verdictSchemaDigest: `sha256:${sha256Hex("other schema")}` },
    ]
    variants.forEach((variant) => expect(buildRunConfigSnapshot(variant).digest).not.toBe(base))
  })

  test("context flags that disagree with the policy flags are refused", () => {
    const input = inputWith(allOn)
    const disagreeing: RunConfigInput = { ...input, policy: policyFor(flipped("enableSessionNote")) }
    expect(() => buildRunConfigSnapshot(disagreeing)).toThrow("enableSessionNote")
  })

  test("a malformed digest is refused", () => {
    expect(() => buildRunConfigSnapshot({ ...inputWith(allOn), systemPromptDigest: "not-a-digest" })).toThrow()
  })
})

describe("digestOf(RunConfigSnapshot)", () => {
  const snapshot: RunConfigSnapshot = buildRunConfigSnapshot(inputWith(allOn)).snapshot

  test.each([...ResolvedFlagNames])("flipping %s in a snapshot changes its digest", (name) => {
    const changed: RunConfigSnapshot = { ...snapshot, flags: { ...snapshot.flags, [name]: !snapshot.flags[name] } }
    expect(digestOf(changed)).not.toBe(digestOf(snapshot))
  })

  test("reordering keys at every level leaves the digest unchanged", () => {
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder)
      if (value === null || typeof value !== "object") return value
      return Object.fromEntries(
        Object.entries(value)
          .toReversed()
          .map(([key, inner]) => [key, reorder(inner)]),
      )
    }
    const reordered = reorder(snapshot)
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(snapshot))
    expect(digestOf(reordered)).toBe(digestOf(snapshot))
  })
})
