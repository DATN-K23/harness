import { JudgeVerdictSchema, type JudgeVerdict } from "@harness/protocol"

/** The reason codes a harness-decided `unverified` verdict may carry. */
export type UnverifiedReason = "UNRESOLVED" | "EXECUTION_FAILED"

export interface VerdictIdentity {
  runId: string
  findingId: string
  traceDigest?: string
}

export interface VerdictWording {
  summary: string
  reasoning: string
}

/**
 * A verdict the harness commits without a model conclusion: the evidence could not settle the claim, so it is neither
 * valid nor invalid. Parsing here means a wording change can never commit a schema-invalid verdict.
 */
export const unverifiedVerdict = (
  identity: VerdictIdentity,
  reasonCode: UnverifiedReason,
  wording: VerdictWording,
): JudgeVerdict =>
  JudgeVerdictSchema.parse({
    runId: identity.runId,
    findingId: identity.findingId,
    validity: "unverified",
    verificationStatus: "UNVERIFIED",
    reasonCode,
    confidence: "LOW",
    ...wording,
    citesEvidence: [],
    ...(identity.traceDigest === undefined ? {} : { traceDigest: identity.traceDigest }),
  })

/**
 * Withholds a model verdict the harness cannot stand behind: it becomes `unverified`/`UNRESOLVED`. The resolved
 * citations stay as the model's evidence; the severity goes, because it grades a vulnerability nobody established.
 */
export const withheldVerdict = (verdict: JudgeVerdict, wording: VerdictWording): JudgeVerdict => {
  const { severity: _severity, ...rest } = verdict
  return JudgeVerdictSchema.parse({
    ...rest,
    validity: "unverified",
    verificationStatus: "UNVERIFIED",
    reasonCode: "UNRESOLVED",
    confidence: "LOW",
    ...wording,
  })
}

export const SandboxUnverified: VerdictWording = {
  summary: "Sandbox execution did not establish a result.",
  reasoning:
    "The sandbox did not report a validated test outcome; infrastructure, setup, timeout, or assertion status cannot be inferred from the process exit code.",
}
