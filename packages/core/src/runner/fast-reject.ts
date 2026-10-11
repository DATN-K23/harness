import { JudgeVerdictSchema, type AntiCheatFinding, type JudgeVerdict } from "@harness/protocol"

/** A stage 1-3 reject: the run completes with an `invalid`/`FAIL` verdict and no model call (design D12). */
export type FastReject =
  | { reasonCode: "MISSING_POC" }
  | { reasonCode: "NON_FAITHFUL_OVERRIDE"; findings: readonly AntiCheatFinding[] }
  | { reasonCode: "EXECUTION_FAILED"; exitCode: number; traceDigest: string }

export type FastRejectReason = FastReject["reasonCode"]

const MaxListedRules = 10

const NotRepaired = "The PoC is judged exactly as submitted and is never repaired or completed by the harness."

const flaggedRules = (findings: readonly AntiCheatFinding[]) => {
  const rules = [...new Set(findings.map((finding) => finding.ruleId))]
  if (rules.length === 0) return "no rule id was reported"
  const listed = rules.slice(0, MaxListedRules).join(", ")
  return rules.length > MaxListedRules ? `rules ${listed} and ${rules.length - MaxListedRules} more` : `rules ${listed}`
}

const wording = (reject: FastReject) => {
  if (reject.reasonCode === "MISSING_POC")
    return {
      summary: "Rejected at ingestion: the report has no executable proof of concept.",
      reasoning: `Judge mode requires the submitter to provide an executable PoC test. The ingestion stage found no PoC test code in the candidate finding, so the claim cannot be verified and the finding is invalid without any model reasoning. ${NotRepaired}`,
    }
  if (reject.reasonCode === "NON_FAITHFUL_OVERRIDE")
    return {
      summary: "Rejected by the sanitizer: the PoC does not faithfully exercise the target.",
      reasoning: `The pre-execution anti-cheat filter flagged the submitted PoC (${flaggedRules(reject.findings)}). A PoC that overrides target logic, mocks internal state or reaches outside the sandbox does not demonstrate the reported vulnerability, so the finding is invalid. ${NotRepaired}`,
    }
  return {
    summary: "Rejected by the sandbox: the PoC did not run successfully.",
    reasoning: `The submitted PoC exited with code ${reject.exitCode} in the isolated sandbox, so it does not compile or the exploit reverts. Only a PoC that runs successfully can demonstrate the vulnerability, so the finding is invalid. ${NotRepaired}`,
  }
}

/** A schema-valid fast-reject verdict; parsing it here means a wording change can never commit an invalid verdict. */
export const fastRejectVerdict = (identity: { runId: string; findingId: string }, reject: FastReject): JudgeVerdict =>
  JudgeVerdictSchema.parse({
    runId: identity.runId,
    findingId: identity.findingId,
    validity: "invalid",
    verificationStatus: "FAIL",
    reasonCode: reject.reasonCode,
    confidence: "HIGH",
    ...wording(reject),
    citesEvidence: [],
    ...(reject.reasonCode === "EXECUTION_FAILED" ? { traceDigest: reject.traceDigest } : {}),
  })
