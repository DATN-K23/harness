import { describe, expect, test } from "bun:test"
import { JudgeVerdictSchema, validateVerdict } from "../src/verdict"

const evidence = {
  filePath: "src/Vault.sol",
  startLine: 10,
  endLine: 20,
  explanation: "withdraw sends ether before updating the balance",
}

const reasoning = "The exploit drains the vault because the balance is updated after the external call."

const validVerdict = {
  runId: "run-1",
  findingId: "finding-1",
  validity: "valid",
  verificationStatus: "PASS",
  reasonCode: "EXPLOIT_CONFIRMED",
  severity: "HIGH",
  confidence: "HIGH",
  summary: "Reentrancy in withdraw drains the vault.",
  reasoning,
  citesEvidence: [evidence],
}

const invalidVerdict = {
  ...validVerdict,
  validity: "invalid",
  verificationStatus: "FAIL",
  reasonCode: "NO_STATE_DELTA",
  severity: undefined,
  citesEvidence: [],
}

const failure = (input: unknown) => {
  const result = validateVerdict(input)
  if (result.ok) throw new Error("expected validation to fail")
  return result.issues
}

describe("validateVerdict", () => {
  test("accepts a well-formed valid verdict", () => {
    const result = validateVerdict(validVerdict)
    expect(result.ok).toBe(true)
    expect(JudgeVerdictSchema.safeParse(validVerdict).success).toBe(true)
  })

  test("accepts a well-formed invalid verdict without evidence or severity", () => {
    expect(validateVerdict(invalidVerdict).ok).toBe(true)
  })

  test("defaults citesEvidence to an empty list", () => {
    const { citesEvidence: _omitted, ...rest } = invalidVerdict
    const result = validateVerdict(rest)
    expect(result.ok && result.verdict.citesEvidence).toEqual([])
  })

  test("rejects valid with FAIL and names the contradictory fields", () => {
    const issues = failure({ ...validVerdict, verificationStatus: "FAIL" })
    expect(issues.map((issue) => issue.reason)).toContain("VALID_REQUIRES_PASS")
    const issue = issues.find((entry) => entry.reason === "VALID_REQUIRES_PASS")
    expect(issue?.path).toEqual(["verificationStatus"])
  })

  test("rejects invalid with PASS", () => {
    const issues = failure({ ...invalidVerdict, verificationStatus: "PASS" })
    expect(issues.map((issue) => issue.reason)).toEqual(["INVALID_REQUIRES_FAIL"])
    expect(issues[0].path).toEqual(["verificationStatus"])
  })

  test("rejects UNVERIFIED for either validity", () => {
    expect(failure({ ...validVerdict, verificationStatus: "UNVERIFIED" }).map((issue) => issue.reason)).toContain(
      "VALID_REQUIRES_PASS",
    )
    expect(failure({ ...invalidVerdict, verificationStatus: "UNVERIFIED" }).map((issue) => issue.reason)).toContain(
      "INVALID_REQUIRES_FAIL",
    )
  })

  test("rejects a valid verdict with no evidence", () => {
    const issues = failure({ ...validVerdict, citesEvidence: [] })
    expect(issues.map((issue) => issue.reason)).toEqual(["VALID_REQUIRES_EVIDENCE"])
    expect(issues[0].path).toEqual(["citesEvidence"])
  })

  test("rejects a valid verdict whose evidence list is omitted", () => {
    const { citesEvidence: _omitted, ...rest } = validVerdict
    expect(failure(rest).map((issue) => issue.reason)).toEqual(["VALID_REQUIRES_EVIDENCE"])
  })

  test("rejects a valid verdict with a severity outside CRITICAL|HIGH|MEDIUM", () => {
    for (const severity of ["LOW", "INFO", "GAS", undefined]) {
      const issues = failure({ ...validVerdict, severity })
      expect(issues.map((issue) => issue.reason)).toEqual(["VALID_REQUIRES_SEVERITY"])
      expect(issues[0].path).toEqual(["severity"])
    }
    for (const severity of ["CRITICAL", "HIGH", "MEDIUM"]) {
      expect(validateVerdict({ ...validVerdict, severity }).ok).toBe(true)
    }
  })

  test("reports every cross-field violation together", () => {
    const issues = failure({ ...validVerdict, verificationStatus: "FAIL", severity: "LOW", citesEvidence: [] })
    expect(issues.map((issue) => issue.reason).sort()).toEqual([
      "VALID_REQUIRES_EVIDENCE",
      "VALID_REQUIRES_PASS",
      "VALID_REQUIRES_SEVERITY",
    ])
  })

  test("rejects reasoning shorter than 50 characters on the reasoning path", () => {
    const issues = failure({ ...validVerdict, reasoning: "too short" })
    const issue = issues.find((entry) => entry.path[0] === "reasoning")
    expect(issue?.reason).toBe("SCHEMA_VIOLATION")
    expect(validateVerdict({ ...validVerdict, reasoning: "x".repeat(49) }).ok).toBe(false)
    expect(validateVerdict({ ...validVerdict, reasoning: "x".repeat(50) }).ok).toBe(true)
  })

  test("rejects a summary shorter than 20 characters", () => {
    const issues = failure({ ...validVerdict, summary: "short" })
    expect(issues.some((issue) => issue.path[0] === "summary")).toBe(true)
  })

  test("rejects evidence line ranges out of bounds", () => {
    const withEvidence = (value: object) => ({ ...validVerdict, citesEvidence: [{ ...evidence, ...value }] })
    expect(failure(withEvidence({ startLine: 0 })).some((issue) => issue.path.join(".") === "citesEvidence.0.startLine")).toBe(
      true,
    )
    const reversed = failure(withEvidence({ startLine: 5, endLine: 4 }))
    expect(reversed.some((issue) => issue.path.join(".") === "citesEvidence.0.endLine")).toBe(true)
    expect(validateVerdict(withEvidence({ startLine: 1, endLine: 1 })).ok).toBe(true)
    expect(validateVerdict(withEvidence({ startLine: 1.5 })).ok).toBe(false)
  })

  test("accepts classification, report and evidence snippet and contentDigest", () => {
    const result = validateVerdict({
      ...validVerdict,
      classification: { name: "Reentrancy", standardId: "SWC-107" },
      report: {
        executiveSummary: "Vault can be drained.",
        rootCause: "State is updated after the external call.",
        attackPath: "Call withdraw from a contract whose fallback re-enters withdraw.",
        impact: "All ether in the vault is lost.",
        remediation: "Apply checks-effects-interactions or a reentrancy guard.",
      },
      citesEvidence: [{ ...evidence, snippet: "msg.sender.call{value: amount}(\"\")", contentDigest: "sha256:abc" }],
    })
    expect(result.ok).toBe(true)
    expect(validateVerdict({ ...validVerdict, classification: { name: "Reentrancy" } }).ok).toBe(true)
  })

  test("rejects a malformed classification or an incomplete report", () => {
    expect(validateVerdict({ ...validVerdict, classification: { standardId: "SWC-107" } }).ok).toBe(false)
    expect(validateVerdict({ ...validVerdict, report: { executiveSummary: "only this" } }).ok).toBe(false)
  })

  test("rejects an unknown reasonCode and non-object input without throwing", () => {
    expect(validateVerdict({ ...validVerdict, reasonCode: "MADE_UP" }).ok).toBe(false)
    expect(validateVerdict(null).ok).toBe(false)
    expect(validateVerdict("verdict").ok).toBe(false)
    expect(validateVerdict(undefined).ok).toBe(false)
  })
})
