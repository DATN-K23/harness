import { z } from "zod"

export const VerdictReasonCodes = [
  "VALID_REQUIRES_PASS",
  "VALID_REQUIRES_SEVERITY",
  "VALID_REQUIRES_EVIDENCE",
  "INVALID_REQUIRES_FAIL",
  "SCHEMA_VIOLATION",
  /** A cited evidence span that the source snapshot cannot resolve; set by the harness, never by the schema. */
  "EVIDENCE_UNRESOLVED",
] as const

export type VerdictReasonCode = (typeof VerdictReasonCodes)[number]

const EvidenceSchema = z
  .object({
    filePath: z.string(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    explanation: z.string(),
    snippet: z.string().optional(),
    contentDigest: z.string().optional(),
  })
  .refine((evidence) => evidence.endLine >= evidence.startLine, {
    path: ["endLine"],
    message: "endLine must be greater than or equal to startLine",
  })

export const JudgeVerdictShapeSchema = z.object({
  runId: z.string(),
  findingId: z.string(),
  validity: z.enum(["valid", "invalid", "unverified"]),
  verificationStatus: z.enum(["PASS", "FAIL", "UNVERIFIED"]),
  reasonCode: z.enum([
    "EXPLOIT_CONFIRMED",
    "MISSING_POC",
    "NON_FAITHFUL_OVERRIDE",
    "EXECUTION_FAILED",
    "BENIGN_MECHANICS",
    "NO_STATE_DELTA",
    "OUT_OF_SCOPE",
  ]),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "GAS"]).optional(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  summary: z.string().min(20),
  reasoning: z.string().min(50),
  citesEvidence: z.array(EvidenceSchema).default([]),
  traceDigest: z.string().optional(),
  classification: z
    .object({
      name: z.string(),
      standardId: z.string().optional(),
    })
    .optional(),
  report: z
    .object({
      executiveSummary: z.string(),
      rootCause: z.string(),
      attackPath: z.string(),
      impact: z.string(),
      remediation: z.string(),
    })
    .optional(),
})

const reportableSeverities: ReadonlyArray<string> = ["CRITICAL", "HIGH", "MEDIUM"]

export const JudgeVerdictSchema = JudgeVerdictShapeSchema.superRefine((verdict, ctx) => {
  const add = (reason: VerdictReasonCode, path: string[], message: string) =>
    ctx.addIssue({ code: "custom", path, message, params: { reason } })

  if (verdict.validity === "valid") {
    if (verdict.verificationStatus !== "PASS")
      add("VALID_REQUIRES_PASS", ["verificationStatus"], "validity valid requires verificationStatus PASS")
    if (!verdict.severity || !reportableSeverities.includes(verdict.severity))
      add("VALID_REQUIRES_SEVERITY", ["severity"], "validity valid requires severity CRITICAL, HIGH or MEDIUM")
    if (verdict.citesEvidence.length === 0)
      add("VALID_REQUIRES_EVIDENCE", ["citesEvidence"], "validity valid requires at least one evidence item")
    return
  }
  if (verdict.validity === "unverified") {
    if (verdict.verificationStatus !== "UNVERIFIED")
      add("INVALID_REQUIRES_FAIL", ["verificationStatus"], "validity unverified requires verificationStatus UNVERIFIED")
    return
  }
  if (verdict.verificationStatus !== "FAIL")
    add("INVALID_REQUIRES_FAIL", ["verificationStatus"], "validity invalid requires verificationStatus FAIL")
})

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>

export interface VerdictIssue {
  reason: VerdictReasonCode
  path: Array<string | number>
  message: string
}

export type VerdictValidation = { ok: true; verdict: JudgeVerdict } | { ok: false; issues: VerdictIssue[] }

const reasonOf = (params: unknown): VerdictReasonCode => {
  const reason = (params as { reason?: unknown } | undefined)?.reason
  return VerdictReasonCodes.find((code) => code === reason) ?? "SCHEMA_VIOLATION"
}

export const validateVerdict = (input: unknown): VerdictValidation => {
  const result = JudgeVerdictSchema.safeParse(input)
  if (result.success) return { ok: true, verdict: result.data }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      reason: issue.code === "custom" ? reasonOf(issue.params) : "SCHEMA_VIOLATION",
      path: issue.path.map((segment) => (typeof segment === "symbol" ? String(segment) : segment)),
      message: issue.message,
    })),
  }
}
