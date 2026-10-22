import { describe, expect, test } from "bun:test"
import { StaticClaimPredicateSchema, StaticVerificationResultSchema } from "../src/ports"

const predicate = { kind: "unauthorized_state_write", contractName: "Vault", functionName: "withdraw", stateVariable: "balances" } as const
const evidence = [{ filePath: "src/Vault.sol", content: "balances[msg.sender] -= amount;", lineRange: [12, 12] }]

describe("static claim verification contracts", () => {
  test("accepts the one canonical predicate and verified result", () => {
    expect(StaticClaimPredicateSchema.parse(predicate)).toEqual(predicate)
    expect(StaticVerificationResultSchema.parse({
      kind: "verified", predicate, truth: "true", profileId: "solidity-unauthorized-state-write-v1", evidence,
    })).toMatchObject({ kind: "verified", predicate, truth: "true", evidence })
  })

  test("rejects extra keys and empty identities", () => {
    expect(StaticClaimPredicateSchema.safeParse({ ...predicate, extra: true }).success).toBe(false)
    expect(StaticClaimPredicateSchema.safeParse({ ...predicate, functionName: " " }).success).toBe(false)
  })

  test("rejects wrong profile, invalid evidence ranges, and unknown incomplete reasons", () => {
    expect(StaticVerificationResultSchema.safeParse({ kind: "verified", predicate, truth: "true", profileId: "other", evidence }).success).toBe(false)
    expect(StaticVerificationResultSchema.safeParse({ kind: "verified", predicate, truth: "true", profileId: "solidity-unauthorized-state-write-v1", evidence: [{ filePath: "../x", content: "x", lineRange: [0, 0] }] }).success).toBe(false)
    expect(StaticVerificationResultSchema.safeParse({ kind: "incomplete", reason: "model_disagrees" }).success).toBe(false)
  })
})
