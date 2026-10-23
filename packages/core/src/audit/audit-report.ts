/** Severity classifications for identified vulnerabilities and audit issues. */
export type AuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO" | "GAS"

/** Model confidence level in the validity and exploitability of the finding. */
export type AuditConfidence = "HIGH" | "MEDIUM" | "LOW"

/** Evidence citation linking a finding to a concrete source code location. */
export interface AuditEvidence {
  readonly filePath: string
  readonly startLine: number
  readonly endLine: number
  readonly explanation: string
  readonly snippet?: string
  readonly contentDigest?: string
}

/** Structured representation of a discovered vulnerability or security issue. */
export interface AuditFinding {
  readonly findingId: string
  readonly title: string
  readonly severity: AuditSeverity
  readonly confidence: AuditConfidence
  readonly description: string
  readonly impact: string
  readonly remediation?: string
  readonly citesEvidence: readonly AuditEvidence[]
  readonly proofOfConcept?: string
  readonly classification?: {
    readonly name: string
    readonly standardId?: string
    readonly cweId?: string
  }
  readonly discoveredAt?: string
}

/** High-level metrics summarizing the results of an autonomous audit run. */
export interface AuditReportSummary {
  readonly totalFindings: number
  readonly severityCounts: Record<AuditSeverity, number>
  readonly durationMs: number
  readonly filesScanned: number
}

/** Complete structured audit report generated from an AuditRun. */
export interface AuditReport {
  readonly auditRunId: string
  readonly snapshotId: string
  readonly generatedAt: string
  readonly summary: AuditReportSummary
  readonly findings: readonly AuditFinding[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface CreateAuditReportInput {
  readonly auditRunId: string
  readonly snapshotId: string
  readonly findings: readonly AuditFinding[]
  readonly durationMs: number
  readonly filesScanned: number
  readonly generatedAt?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Synthesizes an AuditReport and computes its summary statistics. */
export const createAuditReport = (input: CreateAuditReportInput): AuditReport => {
  const severityCounts: Record<AuditSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
    GAS: 0,
  }

  for (const finding of input.findings) {
    severityCounts[finding.severity] = (severityCounts[finding.severity] ?? 0) + 1
  }

  return {
    auditRunId: input.auditRunId,
    snapshotId: input.snapshotId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    summary: {
      totalFindings: input.findings.length,
      severityCounts,
      durationMs: input.durationMs,
      filesScanned: input.filesScanned,
    },
    findings: input.findings,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  }
}
